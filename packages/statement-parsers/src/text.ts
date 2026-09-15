/**
 * Turning bank-export bytes into a string.
 *
 * This is its own module because getting it wrong is silent: a Desjardins export
 * declares `CHARSET:1252` in its OFX header and a fr-CA statement is full of accented
 * merchant names, so decoding CP1252 bytes as UTF-8 does not throw — it produces
 * `Ã‰PICERIE` and that string then flows into `txn.description` and, in item 3, into
 * the import hash. A mojibake description hashes differently from a correct one, so a
 * re-import after fixing the encoding would silently duplicate every row.
 */

import type { SourceFormat } from "./types.ts";

/** U+FEFF. Present on Excel-touched CSV exports; never part of the first field. */
const BOM = "\uFEFF";

export type Encoding = "utf-8" | "windows-1252";

/**
 * Which of the two sanctioned text formats a file is, from its opening bytes.
 *
 * The OFX header block is ASCII by construction, so a latin1 view of the first bytes is
 * safe to inspect before the real decode has chosen an encoding. Anything that is not
 * recognisably OFX is treated as CSV — the caller decides whether that is acceptable.
 */
export function detectFormat(bytes: Uint8Array): SourceFormat {
  const head = new TextDecoder("windows-1252").decode(bytes.slice(0, 512));
  return /OFXHEADER\s*:|<OFX>/iu.test(head) ? "ofx" : "csv";
}

/**
 * Decode, preferring UTF-8 and falling back to CP1252.
 *
 * The sniff is exact rather than heuristic: `TextDecoder` in `fatal` mode throws on any
 * byte sequence that is not valid UTF-8, and CP1252 accented bytes (0xC9 for `É`
 * standing alone) are exactly such sequences. Valid UTF-8 is therefore never
 * misidentified as CP1252, and the only false positive would be a CP1252 file whose
 * bytes happen to form valid UTF-8 — which requires the accents to already be in UTF-8
 * form, in which case the two decodings agree anyway.
 *
 * `declared` wins when the file states its own encoding (the OFX header does; CSV has
 * nowhere to say it).
 */
export function decodeBytes(bytes: Uint8Array, declared?: Encoding): string {
  if (declared !== undefined) {
    return stripBom(new TextDecoder(declared).decode(bytes));
  }
  try {
    return stripBom(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return stripBom(new TextDecoder("windows-1252").decode(bytes));
  }
}

export function stripBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(1) : text;
}

/**
 * Collapse runs of whitespace to a single space and trim.
 *
 * Applied to every description. Banks pad fixed-width description fields, and an OFX
 * `<NAME>` can carry a trailing newline from the SGML tokenizer. Item 3 hashes the
 * description, so "EPICERIE  METRO" and "EPICERIE METRO" must not be two rows.
 *
 * Non-breaking spaces (U+00A0, and U+202F which fr-CA uses before `$`) are whitespace
 * for this purpose; `\s` in JavaScript already covers both.
 */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

/**
 * Mask an account number to its last four characters.
 *
 * Applied at the parser boundary, not at the write boundary, so a full account number
 * never exists as a value inside this process for longer than one function call and can
 * never reach a log line, a test snapshot, or `account.external_ref`. This repo goes
 * public; `PRIOR-ART.md` records the previous attempt committing real account numbers.
 */
export function maskAccountRef(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return trimmed.length <= 4 ? trimmed : trimmed.slice(-4);
}
