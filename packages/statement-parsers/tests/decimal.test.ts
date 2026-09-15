import { describe, expect, test } from "vitest";
import { parseDecimalToMinor } from "../src/decimal.ts";

/** Every case here asserts an exact integer. A float anywhere would fail these. */
describe("parseDecimalToMinor", () => {
  test("fr-CA amounts with space and NBSP thousands separators", () => {
    expect(parseDecimalToMinor("84,20", ",", 2)).toBe(8420);
    expect(parseDecimalToMinor("1 234,56", ",", 2)).toBe(123456);
    expect(parseDecimalToMinor("1\u00A0987,65", ",", 2)).toBe(198765); // non-breaking space
    expect(parseDecimalToMinor("1\u202F987,65", ",", 2)).toBe(198765); // narrow no-break space
    expect(parseDecimalToMinor("2 145,00", ",", 2)).toBe(214500);
  });

  test("en-CA amounts", () => {
    expect(parseDecimalToMinor("84.20", ".", 2)).toBe(8420);
    expect(parseDecimalToMinor("1,234.56", ".", 2)).toBe(123456);
    expect(parseDecimalToMinor("-1234.56", ".", 2)).toBe(-123456);
  });

  test("negatives written in accounting parentheses", () => {
    expect(parseDecimalToMinor("(1 234,56)", ",", 2)).toBe(-123456);
    expect(parseDecimalToMinor("(84,20)", ",", 2)).toBe(-8420);
    // Parentheses and a minus cancel, as they do on a statement.
    expect(parseDecimalToMinor("(-84,20)", ",", 2)).toBe(8420);
  });

  test("trailing sign", () => {
    expect(parseDecimalToMinor("84,20-", ",", 2)).toBe(-8420);
  });

  /**
   * The case that motivates a declared separator instead of inference. Inferring here
   * would make the result depend on the size of the amount, which is how an importer
   * goes wrong by a factor of a thousand on exactly the large transactions.
   */
  test("'1,234' is resolved by the declared separator, never guessed", () => {
    // fr-CA: the comma is the decimal mark, so this is 1.234 — three decimals, which
    // CAD does not have. Rejected, not rounded.
    expect(parseDecimalToMinor("1,234", ",", 2)).toBeNull();
    // en-CA: the comma groups, so this is one thousand two hundred thirty-four dollars.
    expect(parseDecimalToMinor("1,234", ".", 2)).toBe(123400);
  });

  test("both separators present are unambiguous regardless of declaration", () => {
    expect(parseDecimalToMinor("1,234.56", ",", 2)).toBe(123456);
    expect(parseDecimalToMinor("1.234,56", ".", 2)).toBe(123456);
  });

  test("more precision than the currency has is rejected, never rounded", () => {
    expect(parseDecimalToMinor("84,205", ",", 2)).toBeNull();
    expect(parseDecimalToMinor("0,001", ",", 2)).toBeNull();
    // With a 3-exponent currency the same digits are exact.
    expect(parseDecimalToMinor("84,205", ",", 3)).toBe(84205);
  });

  test("the exponent is never assumed to be 2", () => {
    expect(parseDecimalToMinor("1234", ".", 0)).toBe(1234);
    expect(parseDecimalToMinor("12,3456", ",", 4)).toBe(123456);
  });

  test("malformed thousands groups are rejected", () => {
    expect(parseDecimalToMinor("1,23,456", ".", 2)).toBeNull();
    expect(parseDecimalToMinor("12,3456.78", ".", 2)).toBeNull();
  });

  test("non-numeric and empty input", () => {
    expect(parseDecimalToMinor("ABC", ",", 2)).toBeNull();
    expect(parseDecimalToMinor("", ",", 2)).toBeNull();
    expect(parseDecimalToMinor("   ", ",", 2)).toBeNull();
    expect(parseDecimalToMinor("12.34.56", ".", 2)).toBeNull();
  });

  test("zero parses to zero rather than failing; the caller rejects it", () => {
    expect(parseDecimalToMinor("0,00", ",", 2)).toBe(0);
    expect(parseDecimalToMinor("(0,00)", ",", 2)).toBe(-0);
  });

  test("currency noise is stripped", () => {
    expect(parseDecimalToMinor("$84,20", ",", 2)).toBe(8420);
    expect(parseDecimalToMinor("84.20 CAD", ".", 2)).toBe(8420);
  });

  /**
   * The specific failure `parseFloat` produces. 0.29 has no exact binary
   * representation, so `parseFloat("0.29") * 100` is 28.999999999999996 and every
   * fix for that is a place a cent can vanish.
   */
  test("cents that a float round-trip would corrupt", () => {
    for (const [text, expected] of [
      ["0,29", 29],
      ["1,15", 115],
      ["8,07", 807],
      ["1 000 000,01", 100000001],
      ["4 294 967,29", 429496729],
    ] as const) {
      expect(parseDecimalToMinor(text, ",", 2)).toBe(expected);
    }
  });
});
