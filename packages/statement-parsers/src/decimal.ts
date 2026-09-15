/**
 * Decimal text -> integer minor units. No floats, at any step.
 *
 * AGENTS.md: "Parse '1 234,56' to 123456, never via parseFloat." `parseFloat` is not
 * merely discouraged here; it is incapable of being correct. `parseFloat("0.29") * 100`
 * is `28.999999999999996`, and every rounding fix for that is a place where a cent goes
 * missing on some other input. The only exact route is: split the digit string on the
 * declared decimal separator, pad the fraction to the currency's exponent, concatenate,
 * and parse the result once as an integer.
 */

/**
 * Group separators seen in Canadian bank exports.
 *
 * fr-CA uses a space; Desjardins emits U+00A0 (non-breaking) rather than U+0020, and
 * newer fr-CA formatting emits U+202F (narrow no-break). Apostrophe grouping shows up in
 * exports that passed through a Swiss-locale spreadsheet. All are stripped before any
 * separator analysis, so they can never be confused with a decimal mark.
 */
const GROUP_CHARS = /[ \u00A0\u202F\u2009']/gu;

/** Currency symbols and codes a bank sometimes glues onto the amount. */
const CURRENCY_NOISE = /[$]|\b(?:CAD|USD|CDN)\b/giu;

export type DecimalSeparator = "," | ".";

/**
 * Parse a bank-formatted amount to signed minor units.
 *
 * Returns `null` — never a guess and never a rounded value — for anything it cannot
 * read exactly. The caller turns that into an `invalid_amount` problem attached to a
 * line number, which is why this function does not throw: one bad amount must not
 * abandon the other 499 rows.
 *
 * `declaredDecimal` comes from the institution's layout, not from inspection of the
 * value. See the `1,234` case below for why inference is not acceptable here.
 *
 * @param exponent the currency's minor-unit exponent (2 for CAD/USD), from the
 *                 `currency` table. Never assumed to be 2.
 */
export function parseDecimalToMinor(
  raw: string,
  declaredDecimal: DecimalSeparator,
  exponent: number,
): number | null {
  let text = raw.trim();
  if (text === "") return null;

  // ---- sign -------------------------------------------------------------
  // Accounting notation: (1 234,56) is negative. Desjardins writes a reversed
  // deposit this way, in the deposit column, and reading it as positive would flip
  // the sign of a real refund.
  let negative = false;
  if (text.startsWith("(") && text.endsWith(")")) {
    negative = true;
    text = text.slice(1, -1).trim();
  }
  text = text.replace(CURRENCY_NOISE, "").trim();
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1).trim();
  } else if (text.startsWith("+")) {
    text = text.slice(1).trim();
  }
  // Trailing sign, as some ledger exports write it: 1 234,56-
  if (text.endsWith("-")) {
    negative = !negative;
    text = text.slice(0, -1).trim();
  }

  text = text.replace(GROUP_CHARS, "");
  if (text === "") return null;
  if (!/^[0-9.,]+$/u.test(text)) return null;

  // ---- locate the decimal separator -------------------------------------
  const commas = countOf(text, ",");
  const dots = countOf(text, ".");

  let decimal: DecimalSeparator | null;
  if (commas > 0 && dots > 0) {
    // Both present: the rightmost is the decimal mark, the other is grouping.
    // "1,234.56" and "1.234,56" are both unambiguous.
    decimal = text.lastIndexOf(",") > text.lastIndexOf(".") ? "," : ".";
  } else if (commas === 0 && dots === 0) {
    decimal = null;
  } else {
    const sep: DecimalSeparator = commas > 0 ? "," : ".";
    const count = commas > 0 ? commas : dots;
    const after = text.length - text.lastIndexOf(sep) - 1;
    if (count > 1) {
      // "1,234,567" — repeated, so it groups. A number has one decimal mark.
      decimal = null;
    } else if (after === 3) {
      // "1,234" is genuinely ambiguous: 1234 in en-CA, 1.234 in fr-CA. This is the
      // one case where the value cannot tell us, so the *layout* decides. Inferring
      // here would make the answer depend on the amount, which is how an importer
      // ends up off by a factor of a thousand on exactly the large transactions.
      decimal = sep === declaredDecimal ? sep : null;
    } else {
      decimal = sep;
    }
  }

  // ---- split and validate the digit groups -------------------------------
  let intDigits: string;
  let fracDigits: string;
  if (decimal === null) {
    intDigits = text.replace(/[.,]/gu, "");
    fracDigits = "";
    // Every remaining separator had to be a valid thousands group.
    if (!groupsWellFormed(text, commas > 0 ? "," : ".", false)) return null;
  } else {
    const idx = text.lastIndexOf(decimal);
    const head = text.slice(0, idx);
    fracDigits = text.slice(idx + 1);
    intDigits = head.replace(/[.,]/gu, "");
    if (!groupsWellFormed(head, decimal === "," ? "." : ",", true)) return null;
  }

  if (!/^[0-9]*$/u.test(intDigits) || !/^[0-9]*$/u.test(fracDigits)) return null;
  if (intDigits === "" && fracDigits === "") return null;

  // More precision than the currency has is an import bug, not something to round
  // away silently. AGENTS.md: rounding is explicit and stated at the call site;
  // there is no call site here, so there is no rounding.
  if (fracDigits.length > exponent) return null;

  const scaled = (intDigits === "" ? "0" : intDigits) + fracDigits.padEnd(exponent, "0");
  // One integer parse of a pure digit string. Never a float, never a multiplication.
  const minor = Number(scaled);
  if (!Number.isSafeInteger(minor)) return null;

  return negative ? -minor : minor;
}

function countOf(text: string, ch: string): number {
  let n = 0;
  for (const c of text) if (c === ch) n += 1;
  return n;
}

/**
 * A thousands separator must sit between groups of exactly three digits, with one to
 * three leading digits. "1,23,456" is not a number in any locale this repo reads, and
 * accepting it would mean accepting a misaligned column map as valid data.
 */
function groupsWellFormed(part: string, groupChar: string, allowEmpty: boolean): boolean {
  if (!part.includes(groupChar)) return allowEmpty || /^[0-9]*$/u.test(part);
  const segments = part.split(groupChar);
  const [first, ...rest] = segments;
  if (first === undefined || !/^[0-9]{1,3}$/u.test(first)) return false;
  return rest.every((s) => /^[0-9]{3}$/u.test(s));
}
