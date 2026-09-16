/**
 * Currency-code validation, kept dependency-free so it can be unit-tested
 * without installing anything.
 *
 * This exists because of a specific failure mode: `format.currency` is stored
 * in a widget's config and handed to `Intl.NumberFormat`, which throws a
 * RangeError on a code it does not recognize. An unchecked value there is not
 * a cosmetic bug — it takes out the widget, and on a published page it takes
 * out the page, for every visitor, until someone edits the config.
 */

/**
 * Whether `Intl` will accept this as a currency. Asks `Intl` rather than
 * matching a regex, because `Intl` is what will consume it: a well-formed
 * three-letter code that this runtime happens not to support must still be
 * rejected here rather than at render time.
 */
export function isSupportedCurrency(code: string): boolean {
  if (typeof code !== "string" || code.length !== 3) return false;
  try {
    new Intl.NumberFormat(undefined, { style: "currency", currency: code }).format(1);
    return true;
  } catch {
    return false;
  }
}

export const DEFAULT_CURRENCY = "USD";

/** Falls back to USD, so a stored config can never reach `Intl` unchecked. */
export function safeCurrency(code: string | undefined): string {
  if (code && isSupportedCurrency(code)) return code.toUpperCase();
  return DEFAULT_CURRENCY;
}
