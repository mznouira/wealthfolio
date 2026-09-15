/**
 * WP-3: Desjardins deposit-statement **PDF** source, built on the WP-2 `./pdf`
 * layer. See `docs/specs/wp3-desjardins-pdf-parser.md` for the design decisions
 * (W3-D1..D12) this file implements; the numbered comments below point back to it.
 *
 * This module is the ONLY place that depends on both `./pdf` (pdfjs-backed) and
 * Desjardins grammar. It is not re-exported from the package's main `"."` entry
 * (which stays zero-dep for CSV-only consumers) and `src/pdf/` stays generic
 * (W3-D1) — this file has its own subpath export, `./desjardins-pdf`.
 *
 * The boundary from `types.ts` still holds: this produces validated
 * `RawTransaction` values (plus `ImportProblem`s) and stops. No hash, no
 * `account_id`, no database.
 */

import {
  MINOR_UNIT_EXPONENT,
  assembleBatch,
  basename,
  fail,
  quote,
  type LocatedOutcome,
} from "./common.ts";
import { FRENCH_MONTH_ABBREVIATIONS, FRENCH_MONTH_NAMES, parseFrenchDayMonth } from "./dates.ts";
import { parseDecimalToMinor } from "./decimal.ts";
import { extractPageLines, type PageCell, type PageLine } from "./pdf/index.ts";
import { collapseWhitespace, maskAccountRef } from "./text.ts";
import {
  money,
  type CalendarDate,
  type CurrencyCode,
  type FetchRequest,
  type ImportBatch,
  type ImportProblemCode,
  type Money,
  type SourceLocation,
  type StatementSource,
} from "./types.ts";

/** The stable identifier written to `txn.sourceId`. Distinct from the CSV source's
 * `desjardins.accesd` (`src/desjardins.ts`) — same institution, different format,
 * per W3-D1: the two are independent `StatementSource` implementations. */
export const DESJARDINS_PDF_SOURCE_ID = "desjardins.accesd.pdf";

// ---------------------------------------------------------------------------
// The grammar (PLAN §5 WP-3; NOTES §S4)
// ---------------------------------------------------------------------------

/** Recognized product/section codes. Each carries its own balance chain (CONTEXT.md). */
const PRODUCT_CODES = ["EOP", "ET", "CS", "ES"] as const;
type ProductCode = (typeof PRODUCT_CODES)[number];

const HEADER_LABELS = [
  "Date",
  "Code",
  "Description",
  "Frais",
  "Retrait",
  "Dépôt",
  "Solde",
] as const;

type ColumnBucket = "date" | "code" | "description" | "frais" | "retrait" | "depot" | "solde";

/** `HEADER_LABELS` index order == `ColumnBucket` order — both are the grammar's column order. */
const BUCKET_ORDER: readonly ColumnBucket[] = [
  "date",
  "code",
  "description",
  "frais",
  "retrait",
  "depot",
  "solde",
];

const MONEY_BUCKETS: ReadonlySet<ColumnBucket> = new Set(["frais", "retrait", "depot", "solde"]);
const LEAD_BUCKETS: ReadonlySet<ColumnBucket> = new Set(["date", "code", "description"]);

const MONTH_ABBREV_PATTERN = Object.keys(FRENCH_MONTH_ABBREVIATIONS)
  .sort((a, b) => b.length - a.length)
  .join("|");

/**
 * W3-D4: split the leading Date/Code/Description text by content, not by which
 * `PageLine` cells it happened to land in — S4 found Date+Code always merge, and
 * Description merges in too whenever Code is 3 letters.
 */
// The final separator is `\s*`, not `\s+`: a merged cell's join always inserts a
// real space between day/month/code, but a genuinely empty description (a
// `missing_description` row) leaves nothing after the code to require one of.
const TRANSACTION_REGEX = new RegExp(
  `^(\\d{1,2})\\s+(${MONTH_ABBREV_PATTERN})\\s+([A-Z]{2,4})\\s*(.*)$`,
  "u",
);

const MONTH_NAME_PATTERN = Object.keys(FRENCH_MONTH_NAMES)
  .sort((a, b) => b.length - a.length)
  .join("|");

/** "Pour la période du 1er janvier au 31 janvier 2026" (NOTES §S4). */
const PERIOD_REGEX = new RegExp(
  `p[ée]riode\\s+du\\s+\\S+\\s+(${MONTH_NAME_PATTERN})\\s+au\\s+\\S+\\s+(${MONTH_NAME_PATTERN})\\s+(\\d{4})`,
  "iu",
);

/**
 * W3-D9: the whole matched reference is masked, not decomposed — S4 observed the
 * shape `SJ ###-#####-#` but not which part is "the folio" versus a check digit.
 * UNVERIFIED wording; see `docs/factory/NEEDS-HUMAN.md`.
 */
const ACCOUNT_REF_REGEX = /\bSJ\s*\d{3}-\d{5}-\d\b/u;

const PRODUCT_MARKER_REGEX = /^(EOP|ET|CS|ES)\b/u;

// ---------------------------------------------------------------------------
// Header-derived column geometry (W3-D3)
// ---------------------------------------------------------------------------

interface Geometry {
  /** 6 midpoints between the 7 header cells' own x positions, ascending. */
  readonly boundaries: readonly number[];
}

function isHeaderLine(line: PageLine): boolean {
  if (line.cells.length !== HEADER_LABELS.length) return false;
  return HEADER_LABELS.every((label, i) => line.cells[i]?.text === label);
}

function buildGeometry(line: PageLine): Geometry | null {
  if (!isHeaderLine(line)) return null;
  const boundaries: number[] = [];
  for (let i = 0; i < line.cells.length - 1; i++) {
    const a = line.cells[i];
    const b = line.cells[i + 1];
    if (a === undefined || b === undefined) return null;
    boundaries.push((a.x + b.x) / 2);
  }
  return { boundaries };
}

function classify(geometry: Geometry, x: number): ColumnBucket {
  let index = 0;
  for (const boundary of geometry.boundaries) {
    if (x < boundary) break;
    index++;
  }
  return BUCKET_ORDER[index] ?? "solde";
}

function classifyCells(
  geometry: Geometry,
  cells: readonly PageCell[],
): { readonly cell: PageCell; readonly bucket: ColumnBucket }[] {
  return cells.map((cell) => ({ cell, bucket: classify(geometry, cell.x) }));
}

function joinCellText(cells: readonly PageCell[]): string {
  return collapseWhitespace(cells.map((cell) => cell.text).join(" "));
}

function matchProductMarker(line: PageLine): ProductCode | null {
  const text = joinCellText(line.cells);
  const m = PRODUCT_MARKER_REGEX.exec(text);
  if (m === null) return null;
  const token = m[1];
  return PRODUCT_CODES.find((code) => code === token) ?? null;
}

/**
 * Fold like `hash.ts`'s `normaliseForHash` (NFD + strip diacritics), but
 * lowercase and local to this comparison — this is a wording match, not a hash
 * input, so it doesn't need that module's stability guarantees.
 */
function foldForCompare(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase();
}

function isOpeningLine(leadText: string): boolean {
  return foldForCompare(leadText).startsWith("solde report");
}

// ---------------------------------------------------------------------------
// Period line -> year source (W3-D10)
// ---------------------------------------------------------------------------

interface PeriodInfo {
  readonly startMonth: number;
  readonly endMonth: number;
  readonly year: number;
}

function findPeriod(lines: readonly PageLine[]): PeriodInfo | null {
  for (const line of lines) {
    const m = PERIOD_REGEX.exec(joinCellText(line.cells));
    if (m === null) continue;
    const [, startName, endName, yearText] = m;
    if (startName === undefined || endName === undefined || yearText === undefined) continue;
    const startMonth = FRENCH_MONTH_NAMES[startName.toLowerCase()];
    const endMonth = FRENCH_MONTH_NAMES[endName.toLowerCase()];
    if (startMonth === undefined || endMonth === undefined) continue;
    return { startMonth, endMonth, year: Number(yearText) };
  }
  return null;
}

function findAccountRef(lines: readonly PageLine[]): string | null {
  for (const line of lines) {
    const m = ACCOUNT_REF_REGEX.exec(joinCellText(line.cells));
    if (m !== null) return m[0];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

/** Mutable during accumulation; structurally a `RawTransaction` once frozen (W3-D5
 * needs to append to `description` as wrapped continuation lines arrive). */
interface WorkingTransaction {
  sourceId: string;
  accountRef: string | null;
  occurredOn: CalendarDate;
  postedOn: CalendarDate | null;
  amount: Money;
  description: string;
  institutionRef: string | null;
  at: SourceLocation;
}

interface PendingOutcome {
  readonly at: SourceLocation;
  readonly outcome:
    | { readonly ok: true; readonly txn: WorkingTransaction }
    | { readonly ok: false; readonly code: ImportProblemCode; readonly message: string };
}

interface ProductState {
  readonly code: ProductCode;
  readonly headerLine: number;
  readonly accountRef: string | null;
  awaitingOpening: boolean;
  openingMinor: number | null;
  lastPrintedSolde: number | null;
  sumMinor: number;
  readonly rowOutcomes: PendingOutcome[];
}

function accountRefFor(maskedRef: string | null, code: ProductCode): string | null {
  return maskedRef === null ? code : `${maskedRef}-${code}`;
}

function formatMinor(minor: number): string {
  return (minor / 100).toFixed(2);
}

/**
 * Pure: `PageLine[]` (already extracted by `./pdf`) -> validated `RawTransaction[]`
 * + `ImportProblem[]`, one balance chain per product. No pdfjs in this function's
 * own graph — it's a plain array in, `ImportBatch` out, exactly like WP-2's
 * `buildPageLines`, so unit tests can hand-build `PageLine[]` directly.
 */
export function parseDesjardinsPdfLines(
  lines: readonly PageLine[],
  file: string,
  currency: CurrencyCode,
  request: FetchRequest = {},
): ImportBatch {
  const exponent = MINOR_UNIT_EXPONENT[currency];
  const period = findPeriod(lines);
  const maskedRef = maskAccountRef(findAccountRef(lines) ?? "");

  const outcomes: LocatedOutcome[] = [];
  let geometry: Geometry | null = null;
  let pendingMarker: ProductCode | null = null;
  let currentProduct: ProductState | null = null;
  let previousTxn: WorkingTransaction | null = null;

  function pushFail(
    target: ProductState,
    line: number,
    code: ImportProblemCode,
    message: string,
  ): void {
    target.rowOutcomes.push({ at: { file, line }, outcome: fail(code, message) });
  }

  function finalizeProduct(): void {
    if (currentProduct === null) return;
    const p = currentProduct;
    const reconciles =
      p.openingMinor !== null &&
      p.lastPrintedSolde !== null &&
      p.openingMinor + p.sumMinor === p.lastPrintedSolde;

    if (reconciles) {
      for (const { at, outcome } of p.rowOutcomes) {
        outcomes.push({ at, outcome: outcome.ok ? { ok: true, txn: outcome.txn } : outcome });
      }
    } else {
      for (const { at, outcome } of p.rowOutcomes) {
        if (!outcome.ok) outcomes.push({ at, outcome });
      }
      const closingText =
        p.lastPrintedSolde === null
          ? "no closing balance was printed for this product"
          : `closing ${formatMinor(p.lastPrintedSolde)} != opening ${p.openingMinor === null ? "unknown" : formatMinor(p.openingMinor)} + lines ${formatMinor(p.sumMinor)}`;
      outcomes.push({
        at: { file, line: p.headerLine },
        outcome: {
          ok: false,
          code: "reconciliation_failed",
          message: `product ${p.code}: ${closingText}`,
        },
      });
    }
    currentProduct = null;
  }

  let lineNumber = 0;
  for (const line of lines) {
    lineNumber++;

    if (isHeaderLine(line)) {
      const newGeometry = buildGeometry(line);
      if (newGeometry !== null) geometry = newGeometry;
      if (pendingMarker !== null) {
        finalizeProduct();
        currentProduct = {
          code: pendingMarker,
          headerLine: lineNumber,
          accountRef: accountRefFor(maskedRef, pendingMarker),
          awaitingOpening: true,
          openingMinor: null,
          lastPrintedSolde: null,
          sumMinor: 0,
          rowOutcomes: [],
        };
        pendingMarker = null;
      } else if (currentProduct !== null) {
        // Repeated header (e.g. a page break) — same product, chain continues.
        currentProduct.awaitingOpening = false;
      }
      previousTxn = null;
      continue;
    }

    if (geometry === null || currentProduct === null) {
      // Letterhead, not yet in a table: only a product marker is meaningful here.
      const marker = matchProductMarker(line);
      if (marker !== null) pendingMarker = marker;
      continue;
    }

    const classified = classifyCells(geometry, line.cells);
    const leadCells = classified.filter((c) => LEAD_BUCKETS.has(c.bucket)).map((c) => c.cell);
    const moneyClassified = classified.filter((c) => MONEY_BUCKETS.has(c.bucket));
    const leadText = joinCellText(leadCells);

    if (currentProduct.awaitingOpening) {
      const soldeCell = moneyClassified.find((c) => c.bucket === "solde")?.cell;
      if (isOpeningLine(leadText) && soldeCell !== undefined) {
        const openingMinor = parseDecimalToMinor(soldeCell.text, ".", exponent);
        if (openingMinor !== null) {
          currentProduct.openingMinor = openingMinor;
          currentProduct.lastPrintedSolde = openingMinor;
        }
      }
      if (currentProduct.openingMinor === null) {
        pushFail(
          currentProduct,
          lineNumber,
          "malformed_record",
          `no opening balance line found for product ${currentProduct.code}`,
        );
      }
      currentProduct.awaitingOpening = false;
      previousTxn = null;
      continue;
    }

    // W3-D5: a continuation is every cell on the line landing in the description
    // bucket alone (a footer at the page margin lands in the date bucket instead).
    if (
      moneyClassified.length === 0 &&
      leadCells.length > 0 &&
      classified.every((c) => c.bucket === "description") &&
      previousTxn !== null
    ) {
      previousTxn.description = collapseWhitespace(`${previousTxn.description} ${leadText}`);
      continue;
    }

    const match = TRANSACTION_REGEX.exec(leadText);
    if (match === null) {
      const marker = matchProductMarker(line);
      if (marker !== null) {
        pendingMarker = marker;
        previousTxn = null;
        continue;
      }
      if (moneyClassified.length > 0) {
        pushFail(
          currentProduct,
          lineNumber,
          "malformed_record",
          `unrecognised row: ${quote(leadText)}`,
        );
      }
      // Otherwise: letterhead/footer noise between rows — silently skipped.
      continue;
    }

    const [, dayText, monthText, code, descriptionRest] = match;
    if (
      dayText === undefined ||
      monthText === undefined ||
      code === undefined ||
      descriptionRest === undefined
    ) {
      continue;
    }

    const moneyByBucket = new Map<ColumnBucket, PageCell>();
    let duplicateBucket = false;
    for (const { cell, bucket } of moneyClassified) {
      if (moneyByBucket.has(bucket)) duplicateBucket = true;
      else moneyByBucket.set(bucket, cell);
    }
    if (duplicateBucket) {
      pushFail(
        currentProduct,
        lineNumber,
        "invalid_amount",
        "two cells landed in the same money column",
      );
      previousTxn = null;
      continue;
    }

    const fraisCell = moneyByBucket.get("frais");
    const retraitCell = moneyByBucket.get("retrait");
    const depotCell = moneyByBucket.get("depot");
    const soldeCell = moneyByBucket.get("solde");

    if (retraitCell !== undefined && depotCell !== undefined) {
      pushFail(
        currentProduct,
        lineNumber,
        "invalid_amount",
        "both the retrait and dépôt columns are populated",
      );
      previousTxn = null;
      continue;
    }
    if (fraisCell === undefined && retraitCell === undefined && depotCell === undefined) {
      pushFail(currentProduct, lineNumber, "zero_amount", "no money column is populated");
      previousTxn = null;
      continue;
    }

    const fraisMinor =
      fraisCell === undefined ? 0 : parseDecimalToMinor(fraisCell.text, ".", exponent);
    if (fraisCell !== undefined && fraisMinor === null) {
      pushFail(
        currentProduct,
        lineNumber,
        "invalid_amount",
        `unreadable frais ${quote(fraisCell.text)}`,
      );
      previousTxn = null;
      continue;
    }
    const retraitMinor =
      retraitCell === undefined ? 0 : parseDecimalToMinor(retraitCell.text, ".", exponent);
    if (retraitCell !== undefined && retraitMinor === null) {
      pushFail(
        currentProduct,
        lineNumber,
        "invalid_amount",
        `unreadable retrait ${quote(retraitCell.text)}`,
      );
      previousTxn = null;
      continue;
    }
    const depotMinor =
      depotCell === undefined ? 0 : parseDecimalToMinor(depotCell.text, ".", exponent);
    if (depotCell !== undefined && depotMinor === null) {
      pushFail(
        currentProduct,
        lineNumber,
        "invalid_amount",
        `unreadable dépôt ${quote(depotCell.text)}`,
      );
      previousTxn = null;
      continue;
    }

    // W3-D8: one row, one net-effect transaction. Retrait/frais always reduce the
    // balance regardless of the printed sign (mirrors the CSV source's withdrawal
    // handling); dépôt's sign is preserved (a reversed deposit is genuinely negative).
    const netMinor =
      (depotCell === undefined ? 0 : (depotMinor ?? 0)) -
      (retraitCell === undefined ? 0 : Math.abs(retraitMinor ?? 0)) -
      (fraisCell === undefined ? 0 : Math.abs(fraisMinor ?? 0));

    if (netMinor === 0) {
      pushFail(currentProduct, lineNumber, "zero_amount", "net amount is zero");
      previousTxn = null;
      continue;
    }

    const description = collapseWhitespace(descriptionRest);
    if (description === "") {
      pushFail(currentProduct, lineNumber, "missing_description", "description is empty");
      previousTxn = null;
      continue;
    }

    // The amount is trustworthy from here — it counts toward reconciliation even if
    // the date below turns out to be unreadable (W3-D7).
    currentProduct.sumMinor += netMinor;
    if (soldeCell !== undefined) {
      const soldeMinor = parseDecimalToMinor(soldeCell.text, ".", exponent);
      if (soldeMinor !== null) currentProduct.lastPrintedSolde = soldeMinor;
    }

    const monthNumber = FRENCH_MONTH_ABBREVIATIONS[monthText];
    const occurredOn =
      period === null || monthNumber === undefined
        ? null
        : parseFrenchDayMonth(
            `${dayText} ${monthText}`,
            monthNumber > period.endMonth ? period.year - 1 : period.year,
          );

    if (occurredOn === null) {
      pushFail(
        currentProduct,
        lineNumber,
        "invalid_date",
        `expected D MON (French), got ${quote(`${dayText} ${monthText}`)}`,
      );
      previousTxn = null;
      continue;
    }

    const txn: WorkingTransaction = {
      sourceId: DESJARDINS_PDF_SOURCE_ID,
      accountRef: currentProduct.accountRef,
      occurredOn,
      postedOn: null,
      amount: money(netMinor, currency),
      description,
      institutionRef: code,
      at: { file, line: lineNumber },
    };
    currentProduct.rowOutcomes.push({ at: txn.at, outcome: { ok: true, txn } });
    previousTxn = txn;
  }

  finalizeProduct();

  return assembleBatch(DESJARDINS_PDF_SOURCE_ID, "pdf", outcomes, request);
}

// ---------------------------------------------------------------------------
// The source
// ---------------------------------------------------------------------------

export interface DesjardinsPdfSourceOptions {
  /** The raw PDF bytes. The source never reads from disk — see `desjardins.ts`. */
  readonly bytes: Uint8Array | ArrayBuffer;
  /** Only the basename is stored, per `SourceLocation.file`. */
  readonly name: string;
  /** No default anywhere, per AGENTS.md — the PDF names no currency. */
  readonly currency: CurrencyCode;
}

export class DesjardinsPdfSource implements StatementSource {
  readonly id = DESJARDINS_PDF_SOURCE_ID;

  readonly #options: DesjardinsPdfSourceOptions;

  constructor(options: DesjardinsPdfSourceOptions) {
    this.#options = options;
  }

  async fetch(request: FetchRequest = {}): Promise<ImportBatch> {
    const { bytes, currency, name } = this.#options;
    const file = basename(name);
    const raw = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const lines = await extractPageLines(raw);
    return parseDesjardinsPdfLines(lines, file, currency, request);
  }
}
