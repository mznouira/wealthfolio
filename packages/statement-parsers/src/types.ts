/**
 * SCOPE item 2: the `StatementSource` seam and the value type its implementations
 * produce.
 *
 * The boundary of item 2 is deliberate and narrow: an implementation reads bytes and
 * produces *validated* `RawTransaction` values. It does not hash, does not classify,
 * and does not touch the database. Specifically NOT here, and NOT half-implemented:
 *
 *   * `import_hash`  — SCOPE item 3. The schema already carries a UNIQUE column for it.
 *   * `type_code`    — mapping a statement line to purchase/refund/fee/interest is
 *                      classification, and every guess made here would be a guess the
 *                      ledger then has to trust. Left to the write path.
 *   * `category_id`  — SCOPE item 6.
 *   * `account_id`   — a file names an account in the institution's own terms, not the
 *                      ledger's. Resolving `accountRef` to an `account.id` row is the
 *                      write path's job.
 *
 * ---------------------------------------------------------------------------
 * Two deviations from the interface sketched in AGENTS.md, both forced by rules
 * stated in that same file. Recorded here rather than silently applied.
 * ---------------------------------------------------------------------------
 *
 * 1. The sketch is `fetch(account: Account, since: Date)`. `Date` is an instant, and
 *    AGENTS.md ("Money and dates") forbids a timezone-shiftable value anywhere a
 *    calendar date is meant — a `Date` for "since 2026-01-01" is 2025-12-31T19:00 in
 *    America/Montreal and silently changes which tax year a boundary transaction
 *    lands in. `since`/`until` are `CalendarDate` strings.
 *
 * 2. The sketch takes an `Account` domain object. No domain types exist yet, and a
 *    single Desjardins export legitimately contains rows for several accounts. Coupling
 *    the importer to the ledger's `account` row before item 3 needs it would invert the
 *    dependency. The request carries the *file's own* account key instead.
 */

// ---------------------------------------------------------------------------
// Calendar dates
// ---------------------------------------------------------------------------

declare const calendarDateBrand: unique symbol;

/**
 * A calendar date as `YYYY-MM-DD`, matching the schema's `*_on` columns and their
 * GLOB CHECKs. Branded so an arbitrary string cannot be passed where a validated
 * date is required — the compiler enforces that every one went through
 * `isCalendarDate`.
 *
 * Never a `Date`. Never an instant. See the header note.
 */
export type CalendarDate = string & { readonly [calendarDateBrand]: true };

/**
 * True only for a real calendar date in `YYYY-MM-DD`. Rejects `2026-02-30` and
 * `2026-13-01`, which a regex alone accepts and which a bank export occasionally
 * contains when a column map is off by one.
 */
export function isCalendarDate(value: string): value is CalendarDate {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m === null) return false;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return false;

  // Days in month, leap year included. Computed rather than table-lookup so there is
  // no second place for February to be wrong.
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= lengths[month - 1]!;
}

/**
 * Assert a literal is a calendar date. Throws rather than returning null: this is for
 * values written in source — a query bound, a test expectation — where being wrong is a
 * bug to fix, not input to reject. Parsed values go through `parseDeclaredDate`, which
 * returns null so that one bad row does not abandon the file.
 */
export function calendarDate(value: string): CalendarDate {
  if (!isCalendarDate(value)) throw new RangeError(`not a calendar date: ${value}`);
  return value;
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * ISO-4217. Narrow on purpose: these are the codes seeded in `currency` by
 * 0001_initial_schema.sql, and an amount in a code the ledger does not know about is
 * a foreign-key violation waiting to happen at import time rather than a surprise at
 * write time. Widen this and the seed together.
 */
export type CurrencyCode = "CAD" | "USD";

/**
 * An amount as a signed count of the currency's minor unit, per AGENTS.md. There is
 * no float here and none in any intermediate: "1 234,56" is parsed digit-wise to
 * 123456, never through `parseFloat`.
 *
 * `minor` is signed from the owning account's perspective, matching the SIGN rule in
 * 0001_initial_schema.sql: negative = balance goes down. This holds for credit cards
 * too, so a card purchase is negative and a card payment is positive.
 *
 * There is no default currency anywhere in this type or in anything that builds it.
 */
export interface Money {
  readonly minor: number;
  readonly currency: CurrencyCode;
}

/**
 * The schema's money columns are 64-bit. A JS `number` is exact only to 2^53, which is
 * ~$90 trillion in cents — far past any personal ledger, but the assertion is here so
 * the failure is loud rather than a silently rounded amount.
 */
export function money(minor: number, currency: CurrencyCode): Money {
  if (!Number.isSafeInteger(minor)) {
    throw new RangeError(`money() requires an exact integer minor amount, got ${minor}`);
  }
  return { minor, currency };
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/**
 * Where a row came from, so a rejected line can be pointed at.
 *
 * `file` is a basename, never a full path: a path leaks a home directory, and these
 * strings end up in logs and in test output in a repo that goes public.
 */
export interface SourceLocation {
  readonly file: string;
  /** 1-indexed. Physical line for CSV; `<STMTTRN>` ordinal for OFX. */
  readonly line: number;
}

// ---------------------------------------------------------------------------
// The value item 2 produces
// ---------------------------------------------------------------------------

export interface RawTransaction {
  /** The `StatementSource.id` that produced this row; becomes `txn.source_id`. */
  readonly sourceId: string;

  /**
   * The account as the *institution* names it, already masked by the parser to the
   * last four digits. Never a full account number — this value can reach the database
   * (`account.external_ref`) and the repo goes public. Null when the format does not
   * name an account.
   */
  readonly accountRef: string | null;

  /** The date the transaction happened. Tax-relevant; becomes `txn.occurred_on`. */
  readonly occurredOn: CalendarDate;

  /** The date the institution posted it. Bookkeeping only; becomes `txn.posted_on`. */
  readonly postedOn: CalendarDate | null;

  /** Signed, account perspective. Becomes `txn.amount_minor` + `txn.currency`. */
  readonly amount: Money;

  /** Non-empty; the schema CHECKs it. Whitespace-collapsed, never truncated. */
  readonly description: string;

  /**
   * The institution's own reference for this line: OFX `<FITID>`, or the sequence
   * number in a Desjardins CSV. Becomes `txn.institution_ref`, and is one of the six
   * inputs to item 3's hash — which is why it is carried now and not invented later.
   */
  readonly institutionRef: string | null;

  readonly at: SourceLocation;
}

// ---------------------------------------------------------------------------
// Problems
// ---------------------------------------------------------------------------

/**
 * A line that could not be turned into a `RawTransaction`.
 *
 * These are returned, not thrown and not logged-and-skipped. A bank export with one
 * unreadable line among five hundred good ones must neither lose the line silently nor
 * abandon the other 499: the caller decides. PRIOR-ART.md records that reconciling a
 * statement against its own printed total is what caught real errors — that check is
 * only possible if rejects are counted rather than dropped.
 */
export type ImportProblemCode =
  | "malformed_record" // wrong field count, unterminated quote, unclosed tag
  | "invalid_date" // not a real YYYY-MM-DD after mapping
  | "invalid_amount" // unparseable, or both debit and credit populated
  | "zero_amount" // schema CHECK (amount_minor <> 0): always an import bug
  | "missing_description" // schema CHECK (description <> '')
  | "unsupported_currency" // a code not seeded in `currency`
  // The file states a currency that is not the one the account is denominated in:
  // an OFX `<CURDEF>` or per-transaction `<CURRENCY>` disagreeing with the account.
  // Importing these anyway would put a USD amount in a CAD account, and the schema
  // cannot catch it because `USD` is a valid currency code. Rejected, never converted:
  // an ad-hoc conversion here would bypass `fx_rate` entirely (AGENTS.md).
  | "currency_mismatch";

export interface ImportProblem {
  readonly at: SourceLocation;
  readonly code: ImportProblemCode;
  /** Human-readable. Must never quote a full account number or a raw amount+merchant pair. */
  readonly message: string;
}

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

export type SourceFormat = "csv" | "ofx";

export interface FetchRequest {
  /** Restrict to one account within a multi-account export. Masked form, as parsed. */
  readonly accountRef?: string | undefined;
  /** Inclusive lower bound on `occurredOn`. */
  readonly since?: CalendarDate | undefined;
  /** Inclusive upper bound on `occurredOn`. */
  readonly until?: CalendarDate | undefined;
}

export interface ImportBatch {
  readonly sourceId: string;
  /** Which of the two sanctioned text formats this batch was actually read from. */
  readonly format: SourceFormat;
  readonly transactions: readonly RawTransaction[];
  readonly problems: readonly ImportProblem[];
}

/**
 * The integration seam from AGENTS.md. v0.1 ships exactly one implementation — a file
 * importer for one institution. An aggregator adapter and, eventually, an accredited
 * open-banking adapter are later implementations of this same interface; both are in
 * PARKING-LOT.md and neither is built here.
 *
 * `fetch` is async because every non-file implementation will be, and because a file
 * source reads from disk. It returns a batch rather than a bare array so that rejected
 * lines survive the call — see `ImportProblem`.
 */
export interface StatementSource {
  readonly id: string;
  fetch(request?: FetchRequest): Promise<ImportBatch>;
}
