import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkReadOnlySelect,
  splitStatements,
  stripLiteralsAndComments,
  stripTrailingSemicolon,
  wrapWithRowLimit,
  type GuardFailureCode,
  type SqlDialect,
} from "./guard.ts";

function expectOk(sql: string, dialect: SqlDialect = "postgres") {
  const result = checkReadOnlySelect(sql, dialect);
  assert.equal(result.ok, true, `expected to allow: ${sql}\ngot: ${JSON.stringify(result)}`);
}

function expectRejected(sql: string, code: GuardFailureCode, dialect: SqlDialect = "postgres") {
  const result = checkReadOnlySelect(sql, dialect);
  assert.equal(result.ok, false, `expected to reject: ${sql}`);
  if (result.ok) return;
  assert.equal(result.code, code, `wrong rejection code for: ${sql} -> ${result.reason}`);
}

describe("checkReadOnlySelect: legitimate queries", () => {
  it("allows a plain select", () => {
    expectOk("SELECT 1");
    expectOk("select id, name from accounts where plan = 'growth'");
  });

  it("allows a trailing semicolon", () => {
    expectOk("SELECT 1;");
    expectOk("SELECT 1;  \n ");
  });

  it("allows CTEs and parenthesised selects", () => {
    expectOk("WITH recent AS (SELECT * FROM invoices) SELECT count(*) FROM recent");
    expectOk("(SELECT 1)");
    expectOk("((SELECT 1))");
  });

  it("allows TABLE and VALUES as read-only statement forms", () => {
    expectOk("TABLE accounts");
    expectOk("VALUES (1), (2)");
  });

  it("does not mistake OFFSET for SET", () => {
    expectOk("SELECT * FROM accounts ORDER BY id LIMIT 10 OFFSET 20");
  });

  it("does not mistake GROUPING SETS for SET", () => {
    expectOk("SELECT a, b FROM t GROUP BY GROUPING SETS ((a), (b))");
  });

  it("does not mistake identifiers containing keywords for keywords", () => {
    expectOk("SELECT updated_at, created_at, insert_count FROM t");
    expectOk("SELECT dropped_at FROM t WHERE deleted_flag IS NULL");
  });

  it("allows REPLACE() and TRUNCATE() as functions", () => {
    // Blocking these outright would break common string/number formatting.
    expectOk("SELECT REPLACE(name, 'a', 'b') FROM accounts");
    expectOk("SELECT TRUNCATE(1.559, 2) AS t", "mysql");
  });

  it("treats dangerous text inside string literals as data", () => {
    expectOk("SELECT '; DROP TABLE users; --' AS payload");
    expectOk("SELECT * FROM accounts WHERE name = 'Robert''); DROP TABLE t;--'");
  });

  it("treats dangerous text inside quoted identifiers as data", () => {
    expectOk('SELECT "drop" FROM t');
    expectOk('SELECT * FROM "users; DROP TABLE t"');
    expectOk("SELECT `drop` FROM t", "mysql");
  });

  it("allows dollar-quoted strings (Postgres)", () => {
    expectOk("SELECT $$; DROP TABLE t; $$ AS payload");
    expectOk("SELECT $tag$ DROP TABLE t $tag$ AS payload");
  });

  it("treats $1 as a bind parameter, not a dollar quote", () => {
    expectOk("SELECT * FROM accounts WHERE id = $1");
  });

  it("allows comments", () => {
    expectOk("-- a comment\nSELECT 1");
    expectOk("/* block */ SELECT 1");
    expectOk("SELECT 1 /* nested /* deeper */ still a comment */");
    expectOk("SELECT 1 -- DROP TABLE users");
    expectOk("SELECT 1 # DROP TABLE users", "mysql");
  });
});

describe("checkReadOnlySelect: writes and statement smuggling", () => {
  it("rejects statements that do not start with a read-only keyword", () => {
    expectRejected("INSERT INTO t VALUES (1)", "not_a_select");
    expectRejected("DROP TABLE users", "not_a_select");
    expectRejected("EXPLAIN ANALYZE SELECT 1", "not_a_select");
    expectRejected("SHOW TABLES", "not_a_select", "mysql");
  });

  it("rejects a second statement", () => {
    expectRejected("SELECT 1; DROP TABLE users", "multiple_statements");
    expectRejected("SELECT 1; SELECT 2", "multiple_statements");
  });

  it("rejects data-modifying CTEs, which a leading-SELECT check would miss", () => {
    expectRejected(
      "WITH x AS (DELETE FROM users RETURNING *) SELECT * FROM x",
      "forbidden_keyword",
    );
    expectRejected(
      "WITH x AS (INSERT INTO t VALUES (1) RETURNING *) SELECT * FROM x",
      "forbidden_keyword",
    );
    expectRejected(
      "WITH x AS (UPDATE users SET name = 'x' RETURNING *) SELECT * FROM x",
      "forbidden_keyword",
    );
  });

  it("rejects writes hidden behind comments that split keywords", () => {
    // A comment inside a keyword does not join it, so this is not SELECT.
    expectRejected("SEL/**/ECT 1", "not_a_select");
  });

  it("rejects SELECT INTO and INTO OUTFILE", () => {
    expectRejected("SELECT * INTO backup FROM users", "forbidden_keyword");
    expectRejected("SELECT * FROM users INTO OUTFILE '/tmp/x'", "forbidden_keyword", "mysql");
  });

  it("rejects TRUNCATE TABLE and REPLACE INTO phrases", () => {
    expectRejected("WITH x AS (SELECT 1) TRUNCATE TABLE users", "forbidden_keyword");
    expectRejected("WITH x AS (SELECT 1) REPLACE INTO t VALUES (1)", "forbidden_keyword", "mysql");
  });

  it("rejects transaction and session control", () => {
    expectRejected("SELECT 1 FROM t WHERE x = (SET foo)", "forbidden_keyword");
    expectRejected("WITH x AS (SELECT 1) COMMIT", "forbidden_keyword");
  });

  it("rejects MySQL executable comments, which the server runs", () => {
    expectRejected("SELECT 1 /*!50000 DROP TABLE t */", "executable_comment", "mysql");
    expectRejected("SELECT /*+ MAX_EXECUTION_TIME(1) */ 1", "executable_comment", "mysql");
  });

  it("does not treat --x as a comment in MySQL, where the server does not", () => {
    // MySQL needs whitespace after `--`. Stripping it as a comment would hide
    // the DROP from this check while the server still parsed it.
    expectRejected("SELECT 1 --DROP TABLE users", "forbidden_keyword", "mysql");
    // Postgres does treat it as a comment, so the same text is safe there.
    expectOk("SELECT 1 --DROP TABLE users", "postgres");
  });

  it("rejects unterminated literals instead of guessing", () => {
    expectRejected("SELECT 'abc", "unterminated_literal");
    expectRejected('SELECT "abc', "unterminated_literal");
    expectRejected("SELECT `abc", "unterminated_literal", "mysql");
    expectRejected("SELECT 1 /* unterminated", "unterminated_literal");
    expectRejected("SELECT $$ unterminated", "unterminated_literal");
  });

  it("rejects empty and comment-only input", () => {
    expectRejected("", "empty");
    expectRejected("   \n  ", "empty");
    expectRejected("-- just a comment", "empty");
    expectRejected(";", "empty");
  });
});

describe("checkReadOnlySelect: resource abuse", () => {
  it("rejects filesystem and server-control functions", () => {
    expectRejected("SELECT pg_read_file('/etc/passwd')", "forbidden_function");
    expectRejected("SELECT pg_ls_dir('/')", "forbidden_function");
    expectRejected("SELECT lo_import('/etc/passwd')", "forbidden_function");
    expectRejected("SELECT set_config('log_statement', 'none', false)", "forbidden_function");
    expectRejected("SELECT load_file('/etc/passwd')", "forbidden_function", "mysql");
  });

  it("rejects sleep and benchmark functions", () => {
    expectRejected("SELECT pg_sleep(60)", "forbidden_function");
    expectRejected("SELECT sleep(60)", "forbidden_function", "mysql");
    expectRejected("SELECT benchmark(100000000, md5('x'))", "forbidden_function", "mysql");
  });

  it("rejects advisory locks", () => {
    expectRejected("SELECT pg_advisory_lock(1)", "forbidden_function");
  });

  it("rejects row-locking clauses with an accurate message", () => {
    const result = checkReadOnlySelect("SELECT * FROM accounts FOR UPDATE", "postgres");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "locking_clause");
    expectRejected("SELECT * FROM accounts FOR SHARE", "locking_clause");
    expectRejected("SELECT * FROM accounts LOCK IN SHARE MODE", "locking_clause", "mysql");
  });

  it("does not flag a function whose name merely starts with a blocked one", () => {
    expectOk("SELECT pg_sleep_remaining_seconds FROM t");
  });
});

describe("stripLiteralsAndComments", () => {
  it("blanks literal contents but keeps structure", () => {
    const result = stripLiteralsAndComments("SELECT 'a;b' FROM t -- x\n", "postgres");
    assert.ok(!("ok" in result));
    if ("ok" in result) return;
    assert.ok(!result.skeleton.includes("a;b"));
    assert.ok(result.skeleton.includes("SELECT"));
    assert.ok(result.skeleton.includes("FROM t"));
  });

  it("collapses a comment to whitespace rather than nothing", () => {
    const result = stripLiteralsAndComments("SEL/**/ECT", "postgres");
    assert.ok(!("ok" in result));
    if ("ok" in result) return;
    assert.equal(result.skeleton, "SEL ECT");
  });
});

describe("splitStatements", () => {
  it("ignores empty trailing statements", () => {
    assert.deepEqual(splitStatements("SELECT 1;"), ["SELECT 1"]);
    assert.deepEqual(splitStatements("SELECT 1;;  "), ["SELECT 1"]);
    assert.deepEqual(splitStatements("SELECT 1; SELECT 2"), ["SELECT 1", "SELECT 2"]);
  });
});

describe("wrapWithRowLimit", () => {
  it("asks for one row more than the cap so truncation is detectable", () => {
    const wrapped = wrapWithRowLimit("SELECT * FROM t", 100);
    assert.match(wrapped, /LIMIT 101$/);
    assert.ok(wrapped.includes("SELECT * FROM t"));
  });

  it("strips a trailing semicolon so the query nests as a subquery", () => {
    const wrapped = wrapWithRowLimit("SELECT 1;", 10);
    assert.ok(!wrapped.includes(";"), `semicolon survived: ${wrapped}`);
  });

  it("keeps a trailing line comment from swallowing the closing paren", () => {
    const wrapped = wrapWithRowLimit("SELECT 1 -- note", 10);
    // The newline we insert before `)` is what makes this safe.
    assert.match(wrapped, /-- note\n\) AS _sb_wrapped/);
  });

  it("rejects a nonsensical cap", () => {
    assert.throws(() => wrapWithRowLimit("SELECT 1", 0), RangeError);
    assert.throws(() => wrapWithRowLimit("SELECT 1", -5), RangeError);
    assert.throws(() => wrapWithRowLimit("SELECT 1", 1.5), RangeError);
  });
});

describe("stripTrailingSemicolon", () => {
  it("removes only a trailing semicolon", () => {
    assert.equal(stripTrailingSemicolon("SELECT 1;"), "SELECT 1");
    assert.equal(stripTrailingSemicolon("SELECT 1 ;  \n"), "SELECT 1 ");
    assert.equal(stripTrailingSemicolon("SELECT ';'"), "SELECT ';'");
  });
});
