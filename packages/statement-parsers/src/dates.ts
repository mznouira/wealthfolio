/**
 * Bank date text -> `CalendarDate`.
 *
 * Two rules, both from AGENTS.md "Money and dates", and both load-bearing:
 *
 * 1. **No `Date` object is ever constructed here.** `new Date("2026-01-05")` is an
 *    instant at UTC midnight, which in America/Montreal is 2026-01-04T19:00. Round-trip
 *    a January 1st through a `Date` and it becomes December 31st of the previous tax
 *    year. Everything below is string arithmetic on digits.
 *
 * 2. **The format is declared by the layout, never inferred from the value.** `01/02/2026`
 *    is 1 February in DD/MM and 2 January in MM/DD, and no amount of cleverness can tell
 *    them apart. An importer that guesses is right about 70% of the rows in a year and
 *    silently wrong about the rest. Ambiguity is a rejection.
 */

import { isCalendarDate, type CalendarDate } from "./types.ts";

/**
 * The date shapes v0.1 actually reads. Extend deliberately, alongside the layout that
 * needs the new one and a fixture row that proves it.
 *
 * Not implemented, on purpose: French month names (`05 janv. 2026`). AGENTS.md lists
 * them as a trap that bites, but neither Desjardins format uses them, so building the
 * parser now would ship untested code against an invented shape. Noted in the session
 * log as not built rather than half-built.
 */
export type DateFormat = "YYYY-MM-DD" | "YYYY/MM/DD" | "YYYYMMDD" | "DD/MM/YYYY" | "MM/DD/YYYY";

export function parseDeclaredDate(raw: string, format: DateFormat): CalendarDate | null {
  const text = raw.trim();
  let iso: string;

  switch (format) {
    case "YYYY-MM-DD": {
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) return null;
      iso = text;
      break;
    }
    case "YYYY/MM/DD": {
      // What Desjardins AccèsD actually emits, confirmed against a real July 2026
      // export. Slashes only: a value arriving with dashes means the export format
      // changed, and that should surface as a rejected row rather than be absorbed.
      const m = /^(\d{4})\/(\d{2})\/(\d{2})$/u.exec(text);
      if (m === null) return null;
      iso = `${m[1]}-${m[2]}-${m[3]}`;
      break;
    }
    case "YYYYMMDD": {
      if (!/^\d{8}$/u.test(text)) return null;
      iso = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
      break;
    }
    case "DD/MM/YYYY": {
      const m = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(text);
      if (m === null) return null;
      iso = `${m[3]}-${m[2]}-${m[1]}`;
      break;
    }
    case "MM/DD/YYYY": {
      const m = /^(\d{2})\/(\d{2})\/(\d{4})$/u.exec(text);
      if (m === null) return null;
      iso = `${m[3]}-${m[1]}-${m[2]}`;
      break;
    }
  }

  // The shape matched; `isCalendarDate` is what rejects 2026-02-30 and 2026-13-01,
  // which are shaped correctly and do not exist.
  return isCalendarDate(iso) ? iso : null;
}

/**
 * OFX `DTPOSTED` -> `CalendarDate`.
 *
 * OFX dates are `YYYYMMDD` optionally followed by `HHMMSS` and a bracketed UTC offset:
 * `20251231230000[-5:EST]`. **Only the first eight characters are read.** The rest is
 * discarded without being interpreted.
 *
 * That is the whole point. As an instant, `20251231230000[-5:EST]` is 2026-01-01T04:00Z.
 * A parser that normalises to UTC — which is what any date library does by default —
 * moves this transaction from the 2025 tax year into 2026. The bank posted it on
 * 31 December; the statement says 31 December; the calendar date is 2025-12-31, and no
 * timezone is permitted an opinion about that.
 * `tests/fixtures/desjardins/eop-clean.ofx` carries exactly this row.
 */
export function parseOfxDate(raw: string): CalendarDate | null {
  const text = raw.trim();
  if (text.length < 8) return null;
  return parseDeclaredDate(text.slice(0, 8), "YYYYMMDD");
}

// ---------------------------------------------------------------------------
// French dates (WP-3: Desjardins PDF statements)
// ---------------------------------------------------------------------------

/**
 * `D MON` row dates, e.g. `1 JAN`, `15 FÉV` — confirmed against a real Desjardins
 * PDF statement for January only (`docs/statements/NOTES.md` S4). The other eleven
 * abbreviations are the standard Québec 3-letter scheme and are UNVERIFIED against
 * a real statement; flagged in `docs/factory/NEEDS-HUMAN.md`. Extend deliberately,
 * the same discipline `DateFormat` above already follows.
 */
export const FRENCH_MONTH_ABBREVIATIONS: Readonly<Record<string, number>> = {
  JAN: 1,
  FÉV: 2,
  MAR: 3,
  AVR: 4,
  MAI: 5,
  JUN: 6,
  JUL: 7,
  AOU: 8,
  AOÛT: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
  DÉC: 12,
};

/**
 * Full French month names, as they appear in a Desjardins statement's period line
 * ("Pour la période du 1er janvier au 31 janvier 2026" — S4). Real, low-risk: full
 * names don't vary by regional abbreviation convention the way `JAN`/`JANV`/`JANV.`
 * would.
 */
export const FRENCH_MONTH_NAMES: Readonly<Record<string, number>> = {
  janvier: 1,
  février: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  août: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  décembre: 12,
};

/**
 * `D MON` -> `CalendarDate`, given the year. Pure and year-agnostic, matching
 * `parseDeclaredDate`'s split of concerns: this function only knows the shape of
 * one date; which calendar year a `D MON` value belongs to is business logic that
 * belongs to the statement source that owns the period line (a Desjardins PDF names
 * no year on the row itself — see `desjardins-pdf.ts`).
 */
export function parseFrenchDayMonth(raw: string, year: number): CalendarDate | null {
  const text = raw.trim().toUpperCase();
  const m = /^(\d{1,2})\s+(\p{Lu}+)$/u.exec(text);
  if (m === null) return null;

  const day = m[1]!;
  const month = FRENCH_MONTH_ABBREVIATIONS[m[2]!];
  if (month === undefined) return null;

  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${day.padStart(2, "0")}`;
  return isCalendarDate(iso) ? iso : null;
}
