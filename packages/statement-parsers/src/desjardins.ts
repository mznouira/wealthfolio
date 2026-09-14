/**
 * SCOPE item 2's one implementation: a file importer for Desjardins (AccèsD).
 *
 * **CSV only.** AGENTS.md sanctions CSV and OFX/QFX. It does not, for any account type.
 * Pointing this source at an OFX file is an error, not a supported path.
 *
 * Deposit accounts export CSV in two charset variants (CP1252 and accent-folded ASCII).
 * Both are the same layout and both are read; encoding detection is per-file.
 *
 * Credit cards export **PDF only**, which this does not read, here or anywhere. The
 * procedure and the ranked options are in `PARKING-LOT.md`.
 *
 * The boundary holds: this file produces validated `RawTransaction` values and stops.
 * No hash, no `type_code`, no database. See `types.ts`.
 */

import {
  MINOR_UNIT_EXPONENT,
  assembleBatch,
  basename,
  fail,
  quote,
  type LocatedOutcome,
  type RowOutcome,
} from "./common.ts";
import { parseCsv } from "./csv.ts";
import { parseDeclaredDate, type DateFormat } from "./dates.ts";
import { parseDecimalToMinor, type DecimalSeparator } from "./decimal.ts";
import { collapseWhitespace, decodeBytes, detectFormat, maskAccountRef } from "./text.ts";
import {
  money,
  type CurrencyCode,
  type FetchRequest,
  type ImportBatch,
  type SourceLocation,
  type StatementSource,
} from "./types.ts";

/** The stable identifier written to `txn.source_id`. */
export const DESJARDINS_SOURCE_ID = "desjardins.accesd";

// ---------------------------------------------------------------------------
// The layout
// ---------------------------------------------------------------------------

export interface CsvLayout {
  readonly fieldCount: number;
  readonly delimiter: string;
  readonly dateFormat: DateFormat;
  readonly decimalSeparator: DecimalSeparator;
  readonly columns: {
    /**
     * The account number, as the institution prints it. Desjardins calls this the
     * folio. Masked to its last four digits before it leaves the parser.
     */
    readonly folio: number;
    /**
     * Product code distinguishing several accounts on one folio. Null for a layout
     * where the folio alone identifies the account.
     */
    readonly product: number | null;
    readonly date: number;
    readonly sequence: number;
    readonly description: number;
    readonly withdrawal: number;
    readonly deposit: number;
  };
}

/**
 * **VERIFIED 2026-08-31** against a real AccèsD "opérations" export (one month, 40
 * records, two products on one folio). The earlier version of this literal was inferred
 * and was wrong in five ways; all five are recorded in
 * `tests/fixtures/desjardins/README.md` so the next person can see what a guess costs.
 *
 * The file has fourteen fields, no header row, and opens with a blank line. Columns 6
 * and 9–12 were empty in every record of the sample, so their meaning is unknown and
 * nothing reads them.
 *
 * Verification that the map is right, rather than merely plausible: chaining
 * `previous_balance - withdrawal + deposit` across the sample reproduces column 13
 * exactly for all 38 consecutive same-product pairs, and the single discontinuity falls
 * precisely where the product code changes. A column map that is off by one does not
 * balance.
 */
export const DESJARDINS_EOP_LAYOUT: CsvLayout = {
  fieldCount: 14,
  delimiter: ",",
  // Slashes, not dashes. This is the correction that matters most: the inferred
  // "YYYY-MM-DD" would have rejected every row of a real export.
  dateFormat: "YYYY/MM/DD",
  // The export is dot-decimal with no thousands separator at all, despite being a
  // fr-CA file in every other respect — the only non-digit character anywhere in the
  // withdrawal, deposit and balance columns of the sample is ".".
  decimalSeparator: ".",
  columns: {
    // The account number. Not a transit and not a caisse id: it is the folio — the
    // last of the three `institution-transit-folio` coordinates printed on the
    // statement, and the one that identifies the account itself.
    folio: 1,
    // A folio is not the whole story. "EOP" (épargne avec opérations) and "ES1" both
    // appear on the same folio in the sample, each with its own independent balance
    // chain. Without this the two accounts collapse into one and their balances
    // interleave into nonsense.
    product: 2,
    date: 3,
    sequence: 4,
    description: 5,
    withdrawal: 7,
    deposit: 8,
  },
};

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

/**
 * The account key, masked.
 *
 * Column 1 is the **account number** — Desjardins calls it the folio, and it is the
 * third component of the account coordinates printed on the statement
 * (`institution-transit-folio`). It is a real account number, so it is masked to its
 * last four digits here at the parser boundary, per the schema's note on
 * `account.external_ref`: masked only, never the full number, because this repo goes
 * public.
 *
 * The product code is appended because one folio carries several products — `EOP` and
 * `ES1` both appear on one folio in the verified sample, each with its own independent
 * balance chain. Masking the folio alone would collapse two accounts into one.
 */
function accountRefOf(folio: string, product: string): string | null {
  const masked = maskAccountRef(folio);
  const code = product.trim();
  if (masked === null) return code === "" ? null : code;
  return code === "" ? masked : `${masked}-${code}`;
}

function mapCsvRow(
  fields: readonly string[],
  layout: CsvLayout,
  currency: CurrencyCode,
  at: SourceLocation,
): RowOutcome {
  const col = layout.columns;
  const get = (index: number): string => fields[index] ?? "";

  const occurredOn = parseDeclaredDate(get(col.date), layout.dateFormat);
  if (occurredOn === null) {
    return fail("invalid_date", `expected ${layout.dateFormat}, got ${quote(get(col.date))}`);
  }

  const exponent = MINOR_UNIT_EXPONENT[currency];
  const withdrawalText = get(col.withdrawal).trim();
  const depositText = get(col.deposit).trim();

  if (withdrawalText !== "" && depositText !== "") {
    // Exactly one side is populated on a real statement line. Both populated means the
    // column map is off, or the row is not a transaction — either way, guessing which
    // one to believe would invent an amount.
    return fail("invalid_amount", "both the withdrawal and deposit columns are populated");
  }

  let minor: number;
  if (withdrawalText !== "") {
    const parsed = parseDecimalToMinor(withdrawalText, layout.decimalSeparator, exponent);
    if (parsed === null)
      return fail("invalid_amount", `unreadable withdrawal ${quote(withdrawalText)}`);
    // A withdrawal moves the balance down, per the SIGN rule in 0001_initial_schema.sql.
    // `Math.abs` first so that an already-negative "(84,20)" in this column does not
    // double-negate into a deposit.
    minor = -Math.abs(parsed);
  } else if (depositText !== "") {
    const parsed = parseDecimalToMinor(depositText, layout.decimalSeparator, exponent);
    if (parsed === null) return fail("invalid_amount", `unreadable deposit ${quote(depositText)}`);
    // Sign preserved here, unlike the withdrawal column: "(1 234,56)" in the deposit
    // column is a *reversed* deposit and is genuinely negative.
    minor = parsed;
  } else {
    return fail("zero_amount", "neither the withdrawal nor the deposit column is populated");
  }

  if (minor === 0) {
    // schema: CHECK (amount_minor <> 0). Always an import bug, never a statement line.
    return fail("zero_amount", "amount is zero");
  }

  const description = collapseWhitespace(get(col.description));
  if (description === "") return fail("missing_description", "description column is empty");

  const sequence = get(col.sequence).trim();

  return {
    ok: true,
    txn: {
      sourceId: DESJARDINS_SOURCE_ID,
      accountRef: accountRefOf(get(col.folio), col.product === null ? "" : get(col.product)),
      occurredOn,
      // The EOP layout has one date column. `posted_on` stays null rather than being
      // set equal to `occurred_on`: a duplicated value would read as evidence the bank
      // supplied a posting date when it did not.
      postedOn: null,
      amount: money(minor, currency),
      description,
      institutionRef: sequence === "" ? null : sequence,
      at,
    },
  };
}

// ---------------------------------------------------------------------------
// The source
// ---------------------------------------------------------------------------

export interface DesjardinsFileSourceOptions {
  /**
   * The raw export bytes. The source never reads from disk: the caller provides the
   * bytes (from a File, from drag-and-drop, from a sandboxed filesystem API, etc).
   */
  readonly bytes: Uint8Array | ArrayBuffer;
  /**
   * The file name used for `SourceLocation.file` and error messages. Only the basename
   * is stored; a full path would leak the user's home directory into logs and tests.
   */
  readonly name: string;
  /**
   * The currency the account is denominated in. Required, with no default anywhere: the
   * CSV export has no currency column, and AGENTS.md forbids a default currency in the
   * domain layer.
   */
  readonly currency: CurrencyCode;
  readonly layout?: CsvLayout | undefined;
}

export class DesjardinsFileSource implements StatementSource {
  readonly id = DESJARDINS_SOURCE_ID;

  readonly #options: DesjardinsFileSourceOptions;

  constructor(options: DesjardinsFileSourceOptions) {
    this.#options = options;
  }

  async fetch(request: FetchRequest = {}): Promise<ImportBatch> {
    const { bytes, currency, name } = this.#options;
    const file = basename(name);
    const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

    // Desjardins publishes no OFX, so an OFX file here is a caller mistake — most
    // likely a different institution's export. Thrown rather than collected as row
    // problems: every line would come back `malformed_record` and bury the real cause.
    if (detectFormat(raw) === "ofx") {
      throw new TypeError(`${file} is an OFX document; Desjardins publishes CSV only.`);
    }

    const layout = this.#options.layout ?? DESJARDINS_EOP_LAYOUT;
    return assembleBatch(this.id, "csv", readCsv(raw, file, currency, layout), request);
  }
}

function readCsv(
  bytes: Uint8Array,
  file: string,
  currency: CurrencyCode,
  layout: CsvLayout,
): LocatedOutcome[] {
  const text = decodeBytes(bytes);
  return parseCsv(text, layout.delimiter).map((record) => {
    const at: SourceLocation = { file, line: record.line };
    if (record.malformed) {
      return {
        at,
        outcome: fail(
          "malformed_record",
          "unterminated quoted field; the rest of the file was consumed",
        ),
      };
    }
    // Short is fatal — the indices would be reading the wrong columns. Long is
    // tolerated: a bank appending a column does not move the ones before it.
    if (record.fields.length < layout.fieldCount) {
      return {
        at,
        outcome: fail(
          "malformed_record",
          `expected at least ${layout.fieldCount} fields, got ${record.fields.length}`,
        ),
      };
    }
    return { at, outcome: mapCsvRow(record.fields, layout, currency, at) };
  });
}
