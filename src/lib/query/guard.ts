/**
 * Application-level validation of customer-authored SQL.
 *
 * This is the FIRST of two layers. It is a parser-shaped check on the SQL text,
 * and text checks on SQL can always be argued with. The layer that actually
 * guarantees safety is in `execute.ts`: every statement runs inside a
 * `READ ONLY` transaction with a statement timeout, using credentials that
 * should themselves be read-only. Never remove that layer on the grounds that
 * this one exists.
 *
 * What this layer buys us is a clear, early error message ("you wrote DELETE")
 * instead of a confusing driver-level failure, and it closes off the
 * data-modifying-CTE trick that a naive "starts with SELECT" check misses:
 *
 *   WITH x AS (DELETE FROM users RETURNING *) SELECT * FROM x
 *
 * Deliberately dependency-free so it can be unit-tested with `node --test`.
 */

export type SqlDialect = "postgres" | "mysql";

export type GuardFailureCode =
  | "empty"
  | "unterminated_literal"
  | "executable_comment"
  | "multiple_statements"
  | "not_a_select"
  | "forbidden_keyword"
  | "forbidden_function"
  | "locking_clause";

export interface GuardOk {
  ok: true;
  /** SQL with comments and literals blanked out; useful for diagnostics. */
  skeleton: string;
}

export interface GuardFailure {
  ok: false;
  code: GuardFailureCode;
  /** Message intended to be shown to the person who wrote the query. */
  reason: string;
}

export type GuardResult = GuardOk | GuardFailure;

export class SqlGuardError extends Error {
  readonly code: GuardFailureCode;
  constructor(failure: GuardFailure) {
    super(failure.reason);
    this.name = "SqlGuardError";
    this.code = failure.code;
  }
}

/* -------------------------------------------------------------------------- */
/* Tokenizer                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Replaces every comment, string literal and quoted identifier with
 * same-length-ish filler, leaving a "skeleton" of SQL structure that keyword
 * scanning can be run against without a literal like `'-- drop table'`
 * producing a false positive, or `'; DROP TABLE t; --'` hiding a real one.
 *
 * Comments collapse to a single space because that is how both engines treat
 * them: a comment placed in the middle of a keyword splits it into two
 * tokens rather than joining them. Blanking comments to nothing
 * would invent keywords that the database would never see.
 */
export function stripLiteralsAndComments(
  sql: string,
  dialect: SqlDialect,
): { skeleton: string } | GuardFailure {
  let out = "";
  let i = 0;
  const n = sql.length;
  // MySQL treats "..." as a string literal by default; Postgres treats it as a
  // quoted identifier. Either way we blank the contents.
  const doubleQuoteIsString = dialect === "mysql";

  while (i < n) {
    const ch = sql[i]!;
    const next = i + 1 < n ? sql[i + 1] : "";

    /* --- line comments --- */
    if (ch === "-" && next === "-") {
      // MySQL requires whitespace after `--`; `--x` is two minus operators.
      // Treating it as a comment anyway would blank out text the server
      // executes, so honour the dialect here.
      const isComment =
        dialect === "postgres" || i + 2 >= n || /[\s]/.test(sql[i + 2]!);
      if (isComment) {
        while (i < n && sql[i] !== "\n") i++;
        out += " ";
        continue;
      }
    }
    if (dialect === "mysql" && ch === "#") {
      while (i < n && sql[i] !== "\n") i++;
      out += " ";
      continue;
    }

    /* --- block comments --- */
    if (ch === "/" && next === "*") {
      // MySQL's `/*! ... */` and `/*+ ... */` are executed, not ignored. A
      // blanket "strip comments" would let `/*!50000 DROP TABLE t */` through
      // invisibly, so refuse them outright rather than guess.
      const marker = sql[i + 2];
      if (dialect === "mysql" && (marker === "!" || marker === "+")) {
        return {
          ok: false,
          code: "executable_comment",
          reason:
            "MySQL executable comments (/*! ... */ and /*+ ... */) are not allowed, " +
            "because the server runs their contents.",
        };
      }

      // Postgres nests block comments; MySQL does not.
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (dialect === "postgres" && sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      if (depth > 0) {
        return {
          ok: false,
          code: "unterminated_literal",
          reason: "Unterminated block comment.",
        };
      }
      out += " ";
      continue;
    }

    /* --- dollar-quoted strings (Postgres) --- */
    if (dialect === "postgres" && ch === "$") {
      // A tag is $$ or $ident$. `$1` is a bind parameter, not a quote.
      const tagMatch = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (tagMatch) {
        const tag = tagMatch[0];
        const end = sql.indexOf(tag, i + tag.length);
        if (end === -1) {
          return {
            ok: false,
            code: "unterminated_literal",
            reason: `Unterminated dollar-quoted string starting with ${tag}.`,
          };
        }
        i = end + tag.length;
        out += "''";
        continue;
      }
    }

    /* --- single-quoted strings --- */
    if (ch === "'") {
      // Backslash escapes apply in MySQL always, and in Postgres only for
      // E'...' strings.
      const backslashEscapes =
        dialect === "mysql" || (i > 0 && /[Ee]/.test(sql[i - 1]!) && !/[A-Za-z0-9_]/.test(sql[i - 2] ?? " "));
      i++;
      let closed = false;
      while (i < n) {
        if (backslashEscapes && sql[i] === "\\") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2; // doubled quote is an escaped quote
            continue;
          }
          i++;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) {
        return {
          ok: false,
          code: "unterminated_literal",
          reason: "Unterminated string literal.",
        };
      }
      out += "''";
      continue;
    }

    /* --- double-quoted identifiers / strings --- */
    if (ch === '"') {
      const backslashEscapes = doubleQuoteIsString;
      i++;
      let closed = false;
      while (i < n) {
        if (backslashEscapes && sql[i] === "\\") {
          i += 2;
          continue;
        }
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) {
        return {
          ok: false,
          code: "unterminated_literal",
          reason: 'Unterminated double-quoted identifier or string (").',
        };
      }
      // Blank, but keep it a distinct token so `"select"` is not read as the
      // keyword and a quoted identifier still separates surrounding tokens.
      out += '"x"';
      continue;
    }

    /* --- backtick identifiers (MySQL) --- */
    if (ch === "`") {
      i++;
      let closed = false;
      while (i < n) {
        if (sql[i] === "`") {
          if (sql[i + 1] === "`") {
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        i++;
      }
      if (!closed) {
        return {
          ok: false,
          code: "unterminated_literal",
          reason: "Unterminated backtick identifier (`).",
        };
      }
      out += "`x`";
      continue;
    }

    out += ch;
    i++;
  }

  return { skeleton: out };
}

/* -------------------------------------------------------------------------- */
/* Rules                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Bare keywords that never legitimately appear in a read-only query.
 *
 * A few of these are also function names in one engine or another — MySQL has
 * `INSERT(str,pos,len,new)` and `TRUNCATE(n,d)`, for instance. We block them
 * anyway and say so in the error: refusing a rare string function is a much
 * cheaper mistake than admitting a data-modifying CTE. `TRUNCATE` and
 * `REPLACE` are the exceptions, handled as phrases below, because their
 * function forms are common enough to matter.
 */
const FORBIDDEN_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "CREATE",
  "RENAME",
  "GRANT",
  "REVOKE",
  "COPY",
  "MERGE",
  "CALL",
  "DO",
  "VACUUM",
  "ANALYZE",
  "REINDEX",
  "CLUSTER",
  "LOCK",
  "UNLOCK",
  "SET",
  "RESET",
  "DISCARD",
  "BEGIN",
  "START",
  "COMMIT",
  "ROLLBACK",
  "SAVEPOINT",
  "PREPARE",
  "EXECUTE",
  "DEALLOCATE",
  "LISTEN",
  "UNLISTEN",
  "NOTIFY",
  "REFRESH",
  "COMMENT",
  "IMPORT",
  "LOAD",
  "HANDLER",
  "INSTALL",
  "UNINSTALL",
  "SHUTDOWN",
  "KILL",
  "FLUSH",
  "OPTIMIZE",
  "REPAIR",
  "CHECKSUM",
  "INTO", // SELECT ... INTO, INTO OUTFILE, INTO DUMPFILE
] as const;

/** Phrase-shaped rules, so the function forms stay usable. */
const FORBIDDEN_PHRASES: { pattern: RegExp; label: string }[] = [
  { pattern: /\bTRUNCATE\s+TABLE\b/i, label: "TRUNCATE TABLE" },
  { pattern: /\bREPLACE\s+INTO\b/i, label: "REPLACE INTO" },
  { pattern: /\bSELECT\s+.*\bINTO\s+OUTFILE\b/i, label: "INTO OUTFILE" },
];

/**
 * Functions that read the filesystem, run code, hold locks, or burn server
 * time. Matched with word boundaries, so `pg_sleep` does not also match a
 * column called `pg_sleep_ms`.
 */
const FORBIDDEN_FUNCTIONS = [
  // Postgres: filesystem and server control
  "pg_read_file",
  "pg_read_binary_file",
  "pg_ls_dir",
  "pg_stat_file",
  "pg_reload_conf",
  "pg_rotate_logfile",
  "pg_terminate_backend",
  "pg_cancel_backend",
  "pg_logical_emit_message",
  "lo_import",
  "lo_export",
  "set_config",
  "dblink",
  "dblink_exec",
  "query_to_xml",
  // Denial of service
  "pg_sleep",
  "pg_sleep_for",
  "pg_sleep_until",
  "pg_advisory_lock",
  "pg_advisory_xact_lock",
  "sleep",
  "benchmark",
  // MySQL: filesystem and server control
  "load_file",
  "sys_exec",
  "sys_eval",
  "master_pos_wait",
] as const;

const LOCKING_CLAUSES: RegExp[] = [
  /\bFOR\s+UPDATE\b/i,
  /\bFOR\s+NO\s+KEY\s+UPDATE\b/i,
  /\bFOR\s+SHARE\b/i,
  /\bFOR\s+KEY\s+SHARE\b/i,
  /\bLOCK\s+IN\s+SHARE\s+MODE\b/i,
];

/**
 * Splits a skeleton into statements. Because literals and comments are already
 * blanked, every remaining `;` is a real statement separator.
 */
export function splitStatements(skeleton: string): string[] {
  return skeleton
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Validates that `sql` is a single, read-only SELECT. */
export function checkReadOnlySelect(sql: string, dialect: SqlDialect): GuardResult {
  if (!sql || sql.trim().length === 0) {
    return { ok: false, code: "empty", reason: "The query is empty." };
  }

  const stripped = stripLiteralsAndComments(sql, dialect);
  if ("ok" in stripped) return stripped;
  const { skeleton } = stripped;

  const statements = splitStatements(skeleton);
  if (statements.length === 0) {
    return {
      ok: false,
      code: "empty",
      reason: "The query contains no statement (only comments or whitespace).",
    };
  }
  if (statements.length > 1) {
    return {
      ok: false,
      code: "multiple_statements",
      reason: `Only one statement is allowed; found ${statements.length}. Remove the extra ";".`,
    };
  }

  const statement = statements[0]!;

  // Leading keyword. `(SELECT ...)` and `((SELECT ...))` are legitimate.
  const firstWord = /^[(\s]*([A-Za-z_][A-Za-z0-9_]*)/.exec(statement)?.[1]?.toUpperCase();
  if (firstWord !== "SELECT" && firstWord !== "WITH" && firstWord !== "TABLE" && firstWord !== "VALUES") {
    return {
      ok: false,
      code: "not_a_select",
      reason: `A dataset must be a read-only query starting with SELECT or WITH; this starts with ${
        firstWord ?? "an unrecognized token"
      }.`,
    };
  }

  for (const phrase of FORBIDDEN_PHRASES) {
    if (phrase.pattern.test(statement)) {
      return {
        ok: false,
        code: "forbidden_keyword",
        reason: `${phrase.label} is not allowed: datasets must be read-only.`,
      };
    }
  }

  for (const clause of LOCKING_CLAUSES) {
    if (clause.test(statement)) {
      return {
        ok: false,
        code: "locking_clause",
        reason:
          "Row-locking clauses (FOR UPDATE / FOR SHARE / LOCK IN SHARE MODE) are not allowed: " +
          "they would take locks on the customer's database.",
      };
    }
  }

  for (const keyword of FORBIDDEN_KEYWORDS) {
    if (new RegExp(`\\b${keyword}\\b`, "i").test(statement)) {
      return {
        ok: false,
        code: "forbidden_keyword",
        reason:
          `${keyword} is not allowed: datasets must be read-only. ` +
          "(If you meant the function of the same name, alias the expression in a view instead.)",
      };
    }
  }

  for (const fn of FORBIDDEN_FUNCTIONS) {
    if (new RegExp(`\\b${fn}\\b`, "i").test(statement)) {
      return {
        ok: false,
        code: "forbidden_function",
        reason: `The function ${fn}() is not allowed: it can read the server's filesystem, change server state, or stall the connection.`,
      };
    }
  }

  return { ok: true, skeleton };
}

/** Throwing form, for call sites that treat a bad query as an error path. */
export function assertReadOnlySelect(sql: string, dialect: SqlDialect): void {
  const result = checkReadOnlySelect(sql, dialect);
  if (!result.ok) throw new SqlGuardError(result);
}

/* -------------------------------------------------------------------------- */
/* Row cap                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Wraps a validated query so the engine itself enforces the row cap. Without
 * this a single `SELECT * FROM events` on a large table would stream hundreds
 * of megabytes into the Node process and take the app down.
 *
 * We ask for `limit + 1` rows: getting that many back is how the caller knows
 * the result was truncated rather than exactly `limit` rows long.
 */
export function wrapWithRowLimit(sql: string, rowLimit: number): string {
  if (!Number.isInteger(rowLimit) || rowLimit <= 0) {
    throw new RangeError(`rowLimit must be a positive integer, got ${rowLimit}`);
  }
  return `SELECT * FROM (\n${stripTrailingSemicolon(sql)}\n) AS _sb_wrapped LIMIT ${rowLimit + 1}`;
}

/**
 * Removes a trailing `;` (and any trailing whitespace) so the statement can be
 * used as a subquery. Trailing comments are left alone: they are inside the
 * parenthesised subquery, where a newline before the closing paren keeps them
 * from swallowing it.
 */
export function stripTrailingSemicolon(sql: string): string {
  return sql.replace(/;\s*$/, "");
}
