import { describe, expect, test } from "vitest";
import { parseDeclaredDate, parseFrenchDayMonth, parseOfxDate } from "../src/dates.ts";
import { calendarDate, isCalendarDate } from "../src/types.ts";

describe("isCalendarDate", () => {
  test("accepts real dates and rejects shaped-but-impossible ones", () => {
    expect(isCalendarDate("2026-01-05")).toBe(true);
    expect(isCalendarDate("2024-02-29")).toBe(true); // leap year
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("2100-02-29")).toBe(false); // century, not a leap year
    expect(isCalendarDate("2000-02-29")).toBe(true); // divisible by 400
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("2026-00-10")).toBe(false);
    expect(isCalendarDate("2026-04-31")).toBe(false);
    expect(isCalendarDate("2026-1-5")).toBe(false);
    expect(isCalendarDate("01/02/2026")).toBe(false);
  });
});

describe("parseDeclaredDate", () => {
  test("reads only the declared format", () => {
    expect(parseDeclaredDate("2026-01-05", "YYYY-MM-DD")).toBe(calendarDate("2026-01-05"));
    expect(parseDeclaredDate("20260105", "YYYYMMDD")).toBe(calendarDate("2026-01-05"));
    // A DD/MM value offered to a YYYY-MM-DD column is a rejection, not a conversion.
    expect(parseDeclaredDate("01/02/2026", "YYYY-MM-DD")).toBeNull();
    expect(parseDeclaredDate("2026-01-05", "DD/MM/YYYY")).toBeNull();
  });

  /**
   * The ambiguity AGENTS.md names. The same eight characters are two different days,
   * and only the layout knows which. Nothing here inspects the value to decide.
   */
  test("DD/MM and MM/DD are distinguished by declaration, not by inspection", () => {
    expect(parseDeclaredDate("01/02/2026", "DD/MM/YYYY")).toBe(calendarDate("2026-02-01"));
    expect(parseDeclaredDate("01/02/2026", "MM/DD/YYYY")).toBe(calendarDate("2026-01-02"));
  });

  test("impossible dates are rejected after the shape matches", () => {
    expect(parseDeclaredDate("2026-02-30", "YYYY-MM-DD")).toBeNull();
    expect(parseDeclaredDate("2026-13-01", "YYYY-MM-DD")).toBeNull();
    expect(parseDeclaredDate("31/02/2026", "DD/MM/YYYY")).toBeNull();
  });
});

describe("parseOfxDate", () => {
  test("bare YYYYMMDD", () => {
    expect(parseOfxDate("20260108")).toBe(calendarDate("2026-01-08"));
  });

  /**
   * The tax-year test. `20251231230000[-5:EST]` is 2026-01-01T04:00Z as an instant, so
   * anything that normalises through UTC moves this transaction into the following tax
   * year. It happened on 31 December 2025 and it stays there.
   */
  test("a timezone suffix cannot move a transaction across a year boundary", () => {
    expect(parseOfxDate("20251231230000[-5:EST]")).toBe(calendarDate("2025-12-31"));
    expect(parseOfxDate("20260101000000[-5:EST]")).toBe(calendarDate("2026-01-01"));
    expect(parseOfxDate("20260105120000[-5:EST]")).toBe(calendarDate("2026-01-05"));
    expect(parseOfxDate("20251231235959.000[-5:EST]")).toBe(calendarDate("2025-12-31"));

    // Stated explicitly, because it is the whole point: reading the same value as an
    // instant lands on a different calendar day, and therefore a different tax year.
    expect(new Date("2025-12-31T23:00:00-05:00").toISOString().slice(0, 10)).toBe("2026-01-01");
  });

  test("rejects short and unreadable values", () => {
    expect(parseOfxDate("2026")).toBeNull();
    expect(parseOfxDate("")).toBeNull();
    expect(parseOfxDate("20260230")).toBeNull();
  });
});

/**
 * WP-3: the Desjardins PDF grammar's row date, `D MON`. Only `JAN` is confirmed
 * against a real statement (`docs/statements/NOTES.md` S4); the rest of the table
 * is the standard Québec 3-letter scheme and pinned here so a future real sample
 * either confirms or corrects it.
 */
describe("parseFrenchDayMonth", () => {
  test("reads every month abbreviation", () => {
    expect(parseFrenchDayMonth("1 JAN", 2026)).toBe(calendarDate("2026-01-01"));
    expect(parseFrenchDayMonth("1 FÉV", 2026)).toBe(calendarDate("2026-02-01"));
    expect(parseFrenchDayMonth("1 MAR", 2026)).toBe(calendarDate("2026-03-01"));
    expect(parseFrenchDayMonth("1 AVR", 2026)).toBe(calendarDate("2026-04-01"));
    expect(parseFrenchDayMonth("1 MAI", 2026)).toBe(calendarDate("2026-05-01"));
    expect(parseFrenchDayMonth("1 JUN", 2026)).toBe(calendarDate("2026-06-01"));
    expect(parseFrenchDayMonth("1 JUL", 2026)).toBe(calendarDate("2026-07-01"));
    expect(parseFrenchDayMonth("1 AOU", 2026)).toBe(calendarDate("2026-08-01"));
    expect(parseFrenchDayMonth("1 AOÛT", 2026)).toBe(calendarDate("2026-08-01"));
    expect(parseFrenchDayMonth("1 SEP", 2026)).toBe(calendarDate("2026-09-01"));
    expect(parseFrenchDayMonth("1 OCT", 2026)).toBe(calendarDate("2026-10-01"));
    expect(parseFrenchDayMonth("1 NOV", 2026)).toBe(calendarDate("2026-11-01"));
    expect(parseFrenchDayMonth("1 DEC", 2026)).toBe(calendarDate("2026-12-01"));
    expect(parseFrenchDayMonth("1 DÉC", 2026)).toBe(calendarDate("2026-12-01"));
  });

  test("reads a real-sample-shaped single-digit day and is case-insensitive on input", () => {
    expect(parseFrenchDayMonth("1 JAN", 2026)).toBe(calendarDate("2026-01-01"));
    expect(parseFrenchDayMonth("1 jan", 2026)).toBe(calendarDate("2026-01-01"));
    expect(parseFrenchDayMonth("15 JAN", 2026)).toBe(calendarDate("2026-01-15"));
  });

  test("rejects an unknown month, wrong shape, and an impossible day", () => {
    expect(parseFrenchDayMonth("1 XYZ", 2026)).toBeNull();
    expect(parseFrenchDayMonth("JAN 1", 2026)).toBeNull();
    expect(parseFrenchDayMonth("2026-01-01", 2026)).toBeNull();
    expect(parseFrenchDayMonth("32 JAN", 2026)).toBeNull();
    expect(parseFrenchDayMonth("30 FÉV", 2026)).toBeNull();
  });

  test("never constructs a Date object's worth of timezone risk — pure string arithmetic", () => {
    // 29 February only exists in a leap year; this is the same "computed, not guessed"
    // rule `isCalendarDate` already enforces, exercised through the French path too.
    expect(parseFrenchDayMonth("29 FÉV", 2024)).toBe(calendarDate("2024-02-29"));
    expect(parseFrenchDayMonth("29 FÉV", 2026)).toBeNull();
  });
});
