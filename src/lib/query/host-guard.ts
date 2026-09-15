/**
 * Guards which network addresses a tenant may point a database connection at.
 *
 * Without this, "add a data source" is an SSRF primitive: a tenant could aim a
 * connection at 127.0.0.1, at our own app database, at a service inside the
 * private network, or at the cloud metadata endpoint (169.254.169.254), and
 * read back whatever a Postgres/MySQL handshake reveals.
 *
 * Known limitation: we resolve the hostname and check the answers, but the
 * driver resolves it again when it connects, so a DNS entry that changes
 * between the two (DNS rebinding) is not fully closed off here. Closing it
 * properly requires pinning the checked IP and dialing that address directly.
 * That is tracked as follow-up work; for now the blast radius is bounded by
 * the connection being read-only and to a Postgres/MySQL port.
 */

import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

export class BlockedHostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedHostError";
  }
}

/** Parses an IPv4 dotted quad into its four octets, or null. */
function parseIpv4(address: string): [number, number, number, number] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return NaN;
    return Number(part);
  });
  if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) return null;
  return octets as [number, number, number, number];
}

/**
 * True for any address that is not a normal public internet host: loopback,
 * RFC1918 private space, link-local (including the cloud metadata address),
 * carrier NAT, multicast, and the IPv6 equivalents.
 */
export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 0) return false; // not an IP at all; caller resolves first

  if (version === 4) {
    const octets = parseIpv4(address);
    if (!octets) return true;
    const [a, b] = octets;
    if (a === 0) return true; // "this network"
    if (a === 10) return true; // RFC1918
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local + metadata endpoint
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
    if (a === 192 && b === 168) return true; // RFC1918
    if (a === 100 && b >= 64 && b <= 127) return true; // RFC6598 carrier NAT
    if (a >= 224) return true; // multicast and reserved
    return false;
  }

  const lower = address.toLowerCase();
  // Strip a zone index (fe80::1%eth0) before comparing.
  const bare = lower.split("%")[0] ?? lower;
  if (bare === "::" || bare === "::1") return true; // unspecified, loopback
  if (bare.startsWith("fe8") || bare.startsWith("fe9") || bare.startsWith("fea") || bare.startsWith("feb")) {
    return true; // fe80::/10 link-local
  }
  if (/^f[cd]/.test(bare)) return true; // fc00::/7 unique local
  if (bare.startsWith("ff")) return true; // multicast
  // IPv4-mapped (::ffff:10.0.0.1) and IPv4-compatible forms.
  const mapped = /^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(bare);
  if (mapped?.[1]) return isBlockedAddress(mapped[1]);
  return false;
}

function privateHostsAllowed(): boolean {
  return process.env.ALLOW_PRIVATE_DB_HOSTS === "true";
}

/**
 * Throws unless `host` resolves only to public addresses. Set
 * ALLOW_PRIVATE_DB_HOSTS=true to bypass for local development, where the demo
 * database is on localhost.
 */
export async function assertHostAllowed(host: string): Promise<void> {
  const trimmed = host.trim();
  if (trimmed.length === 0) {
    throw new BlockedHostError("Host is empty.");
  }
  if (privateHostsAllowed()) return;

  const bare = trimmed.replace(/^\[|\]$/g, "");

  if (isIP(bare) !== 0) {
    if (isBlockedAddress(bare)) {
      throw new BlockedHostError(
        `${host} is a private or reserved address. Database connections must point at a public host. ` +
          "For local development set ALLOW_PRIVATE_DB_HOSTS=true.",
      );
    }
    return;
  }

  if (/^localhost$/i.test(bare) || /\.localhost$/i.test(bare) || /\.local$/i.test(bare)) {
    throw new BlockedHostError(
      `${host} resolves to this machine. For local development set ALLOW_PRIVATE_DB_HOSTS=true.`,
    );
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(bare, { all: true });
  } catch {
    throw new BlockedHostError(`Could not resolve host ${host}.`);
  }

  // Every answer must be public: a name that resolves to both a public and a
  // private address is still a way into the private network.
  const blocked = addresses.filter((entry) => isBlockedAddress(entry.address));
  if (blocked.length > 0) {
    throw new BlockedHostError(
      `${host} resolves to a private or reserved address (${blocked[0]!.address}). ` +
        "For local development set ALLOW_PRIVATE_DB_HOSTS=true.",
    );
  }
}
