/**
 * Plumbing shared by every `StatementSource` implementation.
 *
 * Extracted when the OFX reader stopped being a Desjardins concern: Desjardins offers
 * no OFX at all, so the two live in separate modules and both need the same currency
 * table, the same one-problem-per-row discipline, and the same request filtering.
 *
 * Nothing here parses a format. Format-specific code belongs in the source that owns it.
 */

import { collapseWhitespace } from "./text.ts";
import type {
  CurrencyCode,
  FetchRequest,
  ImportBatch,
  ImportProblem,
  ImportProblemCode,
  RawTransaction,
  SourceFormat,
  SourceLocation,
} from "./types.ts";

/**
 * Minor-unit exponents, mirroring the `currency` table seeded by
 * `0001_initial_schema.sql`. Duplicated rather than read from the database because an
 * importer does not open a connection. The type is exhaustive over `CurrencyCode`, so
 * widening one without the other fails to compile.
 */
export const MINOR_UNIT_EXPONENT: Record<CurrencyCode, number> = { CAD: 2, USD: 2 };

const KNOWN_CURRENCIES = new Set<string>(Object.keys(MINOR_UNIT_EXPONENT));

export function asCurrencyCode(raw: string): CurrencyCode | null {
  const code = raw.trim().toUpperCase();
  return KNOWN_CURRENCIES.has(code) ? (code as CurrencyCode) : null;
}

/**
 * One problem per rejected row, not a list.
 *
 * A row with a bad date and a bad amount is one unreadable row; reporting it twice makes
 * `problems.length` stop meaning "rows I could not read", which is the number the caller
 * actually needs — and the number the statement-total reconciliation in `PARKING-LOT.md`
 * will need.
 */
export type RowOutcome =
  | { readonly ok: true; readonly txn: RawTransaction }
  | { readonly ok: false; readonly code: ImportProblemCode; readonly message: string };

export function fail(code: ImportProblemCode, message: string): RowOutcome {
  return { ok: false, code, message };
}

export interface LocatedOutcome {
  readonly at: SourceLocation;
  readonly outcome: RowOutcome;
}

/** Short, quoted, and length-capped: these strings end up in logs. */
export function quote(value: string): string {
  const clipped = value.length > 40 ? `${value.slice(0, 40)}…` : value;
  return `"${collapseWhitespace(clipped)}"`;
}

export function basename(path: string): string {
  const parts = path.split(/[/\\]/u);
  return parts[parts.length - 1] ?? path;
}

function matches(txn: RawTransaction, request: FetchRequest): boolean {
  if (request.accountRef !== undefined && txn.accountRef !== request.accountRef) return false;
  // String comparison on YYYY-MM-DD is chronological comparison. No Date is built.
  if (request.since !== undefined && txn.occurredOn < request.since) return false;
  if (request.until !== undefined && txn.occurredOn > request.until) return false;
  return true;
}

/**
 * Assemble a batch, applying the request's filters to transactions only.
 *
 * A rejected row has no readable date or account to filter on, so it is always
 * reported: silently dropping it because it *might* fall outside the window is how an
 * import loses a line.
 */
export function assembleBatch(
  sourceId: string,
  format: SourceFormat,
  outcomes: readonly LocatedOutcome[],
  request: FetchRequest,
): ImportBatch {
  const transactions: RawTransaction[] = [];
  const problems: ImportProblem[] = [];

  for (const { at, outcome } of outcomes) {
    if (!outcome.ok) {
      problems.push({ at, code: outcome.code, message: outcome.message });
      continue;
    }
    if (!matches(outcome.txn, request)) continue;
    transactions.push(outcome.txn);
  }

  return { sourceId, format, transactions, problems };
}
