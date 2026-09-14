/**
 * SCOPE item 2. The seam, and the implementations of it that exist.
 *
 * Adding an institution means adding a module beside `desjardins.ts` and exporting it
 * here. It does not mean touching the seam — which is the whole reason AGENTS.md asks
 * for the interface before the parser.
 */

export type {
  CalendarDate,
  CurrencyCode,
  FetchRequest,
  ImportBatch,
  ImportProblem,
  ImportProblemCode,
  Money,
  RawTransaction,
  SourceFormat,
  SourceLocation,
  StatementSource,
} from "./types.ts";
export { calendarDate, isCalendarDate, money } from "./types.ts";

export { detectFormat } from "./text.ts";

/** The v0.1 institution. CSV only — Desjardins publishes no OFX. */
export {
  DESJARDINS_EOP_LAYOUT,
  DESJARDINS_SOURCE_ID,
  DesjardinsFileSource,
  type CsvLayout,
  type DesjardinsFileSourceOptions,
} from "./desjardins.ts";

/**
 * SCOPE item 3: the deterministic hash (the idempotent write path was not ported). Separate from
 * every parser — a source produces values, this consumes them. See `hash.ts` for the
 * three decisions (accent folding, `institution_ref`, `type_code`).
 */
export {
  IMPORT_HASH_VERSION,
  accountKey,
  importHash,
  importHashPreimage,
  normaliseForHash,
  type ImportHashInput,
} from "./hash.ts";
