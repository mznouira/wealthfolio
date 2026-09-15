/**
 * SCOPE item 3: the deterministic import hash.
 *
 * AGENTS.md ("Idempotent imports"): re-importing the same file must not create
 * duplicates, statements overlap in date range, and the user will import the same
 * statement five times. The hash is what makes that true; `txn.import_hash` is UNIQUE,
 * so the database enforces it even if this file has a bug.
 *
 * No dependency. SHA-256 is the pure-TS `sha256.ts`, synchronous.
 *
 * ---------------------------------------------------------------------------
 * THE GOVERNING PRINCIPLE
 * ---------------------------------------------------------------------------
 *
 *   A hash input must be a property of the TRANSACTION, never a property of the FILE
 *   or the REQUEST that carried it.
 *
 * Everything below follows from that one sentence: it is why `institution_ref` is out,
 * why `source_id` is out, and why the description is folded before it is hashed. Two
 * downloads of the same month describe the same event; anything that varies between
 * those two downloads is a property of the download and must not reach the digest.
 *
 * ---------------------------------------------------------------------------
 * DECISION 1 — THE CHARSET PROBLEM (PARKING-LOT.md, 2026-08-31, accent folding)
 * ---------------------------------------------------------------------------
 *
 * Verified against two real AccèsD downloads of the same month: the export is offered
 * in CP1252 (`Épicerie`, `Prêt`, `Intérêt`) and in accent-folded ASCII (`Epicerie`,
 * `Pret`, `Interet`). Same layout, same dates, same amounts, same sequence numbers —
 * only the description text differs, and only by folding. A test in
 * `tests/import/desjardins.test.ts` pins that fact. Hash the description as-is and a
 * user who downloads one variant in July and the other in August gets a duplicate row
 * for every accented transaction.
 *
 * Three options were on record. This is (a): hash a folded, case-normalised
 * description, store the original verbatim in `txn.description`.
 *
 *   (b) Drop the description; key on `institution_ref` instead. REJECTED, and
 *       decision 2 below is the reason: that reference is not unique, so a collision
 *       would not duplicate a row — it would make a real transaction vanish, because
 *       the second one is swallowed by the first one's hash. A lost transaction is
 *       strictly worse than a duplicated one: a duplicate is visible in a statement
 *       view and reconciles loudly against the statement total; an absent row is
 *       silent.
 *
 *   (c) Hash both forms and queue a fold-match as a merge candidate, the way transfer
 *       detection does. REJECTED. Transfer detection needs a human because "same
 *       amount, opposite sign, within 3 days" is a genuine judgement call that is
 *       sometimes wrong. Accent folding is not a judgement call: it is a mechanical,
 *       1:1, provably reversible-in-aggregate rendering difference produced by one
 *       institution's own export pipeline. Sending it to a confirmation queue — one
 *       that SCOPE item 5 has not built yet — buys no safety and costs the user a
 *       decision per accented row, forever.
 *
 * WHAT (a) COSTS, stated rather than glossed: two genuinely distinct transactions whose
 * descriptions differ ONLY by accents or case, on the same account, same day, for the
 * same amount, collapse into one row. Note the exposure is not new — two transactions
 * with byte-identical descriptions (the same $2.50 coffee bought twice in one day)
 * already collide under ANY scheme that hashes the description, and `institution_ref`
 * does not rescue either case because it is not in the hash. Folding widens that
 * pre-existing class only marginally. The statement-total reconciliation in
 * PARKING-LOT.md is what would catch it; that check is not built.
 */

import type { CalendarDate, CurrencyCode } from "./types.ts";
import { sha256Hex } from "./sha256.ts";

/**
 * The recipe version, and part of the digest.
 *
 * If the field list or the normalisation below ever changes, this changes with it in
 * the same commit. Then every hash changes, which is loud — a re-import inserts a
 * parallel set of rows — instead of the silent alternative, where an unversioned
 * recipe change makes half the ledger's hashes uncomparable with the other half and
 * nothing says so.
 */
export const IMPORT_HASH_VERSION = "1";

/**
 * The description as the hash sees it. Never what gets stored.
 *
 * Three transformations, in order, each with its own justification:
 *
 *   1. NFD + strip combining marks. THE decision above: `É` and `E` are the same
 *      statement line rendered by two exports of the same statement.
 *   2. Uppercase. Same category of rendering variance, and it cannot be produced by
 *      `\p{Mn}` stripping alone (`É` folds to `E`, not `e`, so a folded-vs-accented
 *      pair would otherwise still differ in case for any lowercase accented letter —
 *      `é` -> `e` but `É` -> `E`). Case normalisation is what makes step 1 complete
 *      rather than half-applied.
 *   3. Collapse whitespace. The parser already does this to every description, so this
 *      is belt-and-braces for a source that forgets — and padding width is the third
 *      thing that varies between two renderings of one statement line.
 *
 * Uppercasing is locale-independent here by construction: step 1 has already removed
 * every diacritic, so no `toLocaleUpperCase` edge case (Turkish dotless i, for one) is
 * reachable from the ASCII-plus-punctuation string that survives it.
 */
export function normaliseForHash(description: string): string {
  return description
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toUpperCase()
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * The six fields that identify a transaction.
 *
 * `accountKey` is the ledger account's DURABLE identity (institution slug + external
 * ref), not the raw `accountRef` string from the file and not the integer `account.id`.
 * The file's own key is a property of the file; the integer id is a property of this
 * database's insertion order. Neither is a property of the account.
 */
export interface ImportHashInput {
  readonly accountKey: string;
  readonly occurredOn: CalendarDate;
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
  readonly description: string;
}

/**
 * Frame one field as `<byte-length>:<value>`.
 *
 * Length-prefixed, not delimiter-joined, and this is not paranoia about hostile input —
 * it is about a bank description that legitimately contains the delimiter. Join with
 * any separator `S` and the tuples ("A", "B" + S + "C") and ("A" + S + "B", "C") produce
 * the identical string and therefore the identical hash: two different transactions,
 * one row. Every practical separator fails this, including control characters, because
 * `\s+` collapsing does not remove them. Length prefixing is injective for every
 * possible field content, so the question never has to be asked again.
 *
 * The length is in UTF-16 code units (JavaScript's `String.length`). That is fine and
 * stays fine: it is not a byte count of anything, it is a self-delimiting frame, and it
 * is only ever compared against itself.
 */
function frame(value: string): string {
  return `${value.length}:${value}`;
}

/**
 * The canonical pre-image, exposed for tests and for debugging a hash mismatch.
 *
 * ---------------------------------------------------------------------------
 * DECISION 2 — `institution_ref` IS NOT IN THE HASH
 * ---------------------------------------------------------------------------
 *
 * AGENTS.md names six inputs, one of them "institution reference". This omits it
 * deliberately, and AGENTS.md is amended in the same commit rather than left to
 * disagree with the code.
 *
 * Desjardins populates a 5-digit sequence on every row. It is not a transaction id: it
 * RESETS per product and per statement. The fixture shows the per-product half
 * directly — `ES1` restarts at 00001 while `EOP` is already at 00005 on the same date.
 * The per-statement half is what disqualifies it: download 1–31 January, then download
 * 15 January–15 February, and a transaction that was `00008` in the first file is
 * `00001` in the second. Hash it and every row in the overlap duplicates — which is the
 * exact scenario AGENTS.md instructs us to assume ("assume statements overlap in date
 * range").
 *
 * That is the governing principle at the top of this file: the sequence describes the
 * user's download, not the transaction. `institution_ref` is still WRITTEN to the txn
 * row — it is real provenance, it is what a support call quotes, and PARKING-LOT.md's
 * cross-format deduplication entry may yet want it — it just cannot be an input to
 * identity.
 *
 * `source_id` is out for the same reason and is likewise stored, not hashed: the same
 * transaction imported through a second `StatementSource` is the same transaction.
 * (It will not currently dedupe across sources anyway, because the description text
 * differs between formats — that is the cross-format entry in PARKING-LOT.md, and it
 * is not item 3's job.)
 *
 * `posted_on` is out: bookkeeping only, may be absent from one export and present in
 * another, and the schema forbids a tax rule from reading it.
 */
export function importHashPreimage(input: ImportHashInput): string {
  return [
    frame(IMPORT_HASH_VERSION),
    frame(input.accountKey),
    // The `YYYY-MM-DD` string, verbatim. No Date is constructed anywhere in this
    // module: AGENTS.md, and a hash whose input had been through a timezone would be
    // a hash that changes when the machine moves.
    frame(input.occurredOn),
    // Signed integer minor units as a decimal string. No float ever touches this.
    frame(String(input.amountMinor)),
    frame(input.currency),
    frame(normaliseForHash(input.description)),
  ].join("");
}

/** SHA-256 of the canonical pre-image, lowercase hex. Becomes `txn.import_hash`. */
export function importHash(input: ImportHashInput): string {
  return sha256Hex(importHashPreimage(input));
}

/**
 * The durable identity of a ledger account, as the hash sees it.
 *
 * `institution.slug` + `account.external_ref` is stable across a rebuild of the
 * database, which the integer `account.id` is not: delete and re-create an account row
 * and every hash keyed on its id changes, so the next import of an already-imported
 * statement inserts a full parallel copy.
 *
 * The `#<id>` fallback exists because `external_ref` is nullable — a format that does
 * not name an account (see `RawTransaction.accountRef`) leaves it null. That fallback
 * is deliberately NOT stable across a rebuild, and it cannot be: an account with no
 * external reference has no durable identity to borrow. The `#` prefix keeps the two
 * spaces from ever colliding, since a masked ref is digits or an alphanumeric product
 * code and never starts with `#`.
 */
export function accountKey(
  institutionSlug: string,
  externalRef: string | null,
  accountId: number,
): string {
  return externalRef === null
    ? `${institutionSlug}#${accountId}`
    : `${institutionSlug}/${externalRef}`;
}
