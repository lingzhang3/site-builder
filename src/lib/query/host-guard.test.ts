import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BlockedHostError, assertHostAllowed, isBlockedAddress } from "./host-guard";

describe("isBlockedAddress", () => {
  it("blocks loopback", () => {
    assert.equal(isBlockedAddress("127.0.0.1"), true);
    assert.equal(isBlockedAddress("127.1.2.3"), true);
    assert.equal(isBlockedAddress("::1"), true);
  });

  it("blocks the cloud metadata endpoint", () => {
    assert.equal(isBlockedAddress("169.254.169.254"), true);
  });

  it("blocks RFC1918 private ranges", () => {
    for (const address of ["10.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.1"]) {
      assert.equal(isBlockedAddress(address), true, address);
    }
  });

  it("allows public addresses just outside the private ranges", () => {
    for (const address of ["172.15.0.1", "172.32.0.1", "192.167.1.1", "11.0.0.1", "8.8.8.8"]) {
      assert.equal(isBlockedAddress(address), false, address);
    }
  });

  it("blocks carrier NAT, multicast and unspecified", () => {
    assert.equal(isBlockedAddress("100.64.0.1"), true);
    assert.equal(isBlockedAddress("224.0.0.1"), true);
    assert.equal(isBlockedAddress("0.0.0.0"), true);
  });

  it("blocks IPv6 link-local, unique-local and multicast", () => {
    for (const address of ["fe80::1", "fe80::1%eth0", "fc00::1", "fd12:3456::1", "ff02::1", "::"]) {
      assert.equal(isBlockedAddress(address), true, address);
    }
  });

  it("sees through IPv4-mapped IPv6 addresses", () => {
    assert.equal(isBlockedAddress("::ffff:127.0.0.1"), true);
    assert.equal(isBlockedAddress("::ffff:10.0.0.1"), true);
    assert.equal(isBlockedAddress("::ffff:8.8.8.8"), false);
  });

  it("allows ordinary public IPv6", () => {
    assert.equal(isBlockedAddress("2606:4700:4700::1111"), false);
  });

  it("reports non-IP input as not-an-address, leaving resolution to the caller", () => {
    assert.equal(isBlockedAddress("db.customer.example"), false);
  });
});

describe("assertHostAllowed", () => {
  const original = process.env.ALLOW_PRIVATE_DB_HOSTS;

  function withPrivateHosts(value: string | undefined, fn: () => Promise<void>) {
    if (value === undefined) delete process.env.ALLOW_PRIVATE_DB_HOSTS;
    else process.env.ALLOW_PRIVATE_DB_HOSTS = value;
    return fn().finally(() => {
      if (original === undefined) delete process.env.ALLOW_PRIVATE_DB_HOSTS;
      else process.env.ALLOW_PRIVATE_DB_HOSTS = original;
    });
  }

  it("rejects private literals and localhost by default", async () => {
    await withPrivateHosts(undefined, async () => {
      for (const host of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "localhost", "db.local", "[::1]"]) {
        await assert.rejects(() => assertHostAllowed(host), BlockedHostError, host);
      }
    });
  });

  it("rejects an empty host", async () => {
    await assert.rejects(() => assertHostAllowed("   "), BlockedHostError);
  });

  it("allows anything once the development escape hatch is set", async () => {
    await withPrivateHosts("true", async () => {
      await assertHostAllowed("127.0.0.1");
      await assertHostAllowed("localhost");
    });
  });

  it("allows a public IP literal without needing DNS", async () => {
    await withPrivateHosts(undefined, async () => {
      await assertHostAllowed("8.8.8.8");
    });
  });
});
