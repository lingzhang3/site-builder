/**
 * URL slugs for organizations and dashboards.
 *
 * Kept dependency-free and pure so the rules are unit-testable: slugs end up
 * in paths like `/acme/dashboards/q3-revenue` and in public share URLs, so a
 * slug that can contain `/`, `..` or a leading `-` is a routing bug waiting to
 * happen.
 */

/** Words that would collide with the app's own routes. */
const RESERVED_SLUGS = new Set([
  "api",
  "p",
  "login",
  "signup",
  "logout",
  "settings",
  "admin",
  "new",
  "static",
  "_next",
  "favicon.ico",
  "connections",
  "datasets",
  "dashboards",
]);

export function slugify(input: string): string {
  const slug = input
    .normalize("NFKD")
    // Drop combining marks so "Café" becomes "cafe" rather than "caf".
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    // Trimming to length can leave a trailing hyphen behind.
    .replace(/-+$/g, "");

  return slug;
}

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}

/**
 * Produces a slug that is safe to route on, falling back to a random suffix
 * when the input slugifies to nothing (a name written entirely in a script we
 * strip, for instance) or collides with a reserved word.
 */
export function toSafeSlug(input: string, randomSuffix: () => string = defaultSuffix): string {
  const base = slugify(input);
  if (base.length === 0) return `org-${randomSuffix()}`;
  if (isReservedSlug(base)) return `${base}-${randomSuffix()}`;
  return base;
}

function defaultSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

/** Appends `-2`, `-3`, … until the slug is not in `taken`. */
export function dedupeSlug(slug: string, taken: Set<string> | ReadonlySet<string>): string {
  if (!taken.has(slug)) return slug;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${slug}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${slug}-${Date.now()}`;
}
