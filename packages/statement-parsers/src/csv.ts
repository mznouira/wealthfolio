/**
 * RFC 4180 CSV, by hand, with no dependency.
 *
 * AGENTS.md requires asking before adding a dependency and names the edge cases that
 * actually bite. All of them are in this file and none of them needs a package: quoted
 * commas, `""` escapes, `\r\n`, a BOM, and a newline *inside* a quoted field. That last
 * one is the reason a CSV cannot be read with `split("\n")` — `tests/fixtures/desjardins/
 * eop-clean.csv` line 6 contains one, and a line-splitting reader turns that single
 * transaction into two malformed halves.
 *
 * Records carry the physical line they *start* on, so a problem reported against a
 * multi-line record points at somewhere a human can look.
 */

import { stripBom } from "./text.ts";

export interface CsvRecord {
  /** 1-indexed physical line where this record begins. */
  readonly line: number;
  readonly fields: readonly string[];
  /**
   * The record ended because the file did, while still inside a quoted field. Its
   * fields are whatever was accumulated and must not be trusted. An unterminated quote
   * swallows the remainder of the file by definition, so this is always the last record.
   */
  readonly malformed: boolean;
}

export function parseCsv(input: string, delimiter = ","): CsvRecord[] {
  const src = stripBom(input);
  const records: CsvRecord[] = [];

  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  let started = false;
  let i = 0;

  const begin = (): void => {
    if (!started) {
      started = true;
      recordLine = line;
    }
  };
  const endRecord = (malformed: boolean): void => {
    fields.push(field);
    records.push({ line: recordLine, fields, malformed });
    fields = [];
    field = "";
    started = false;
  };

  while (i < src.length) {
    const ch = src[i]!;

    if (inQuotes) {
      if (ch === '"') {
        // RFC 4180 escapes a quote by doubling it.
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      if (ch === "\r" || ch === "\n") {
        // A newline inside quotes is data, not a record terminator. Normalised to
        // "\n" so the value does not depend on the exporter's line endings — the
        // description feeds item 3's hash, and a CRLF/LF difference must not make the
        // same transaction hash two ways.
        const crlf = ch === "\r" && src[i + 1] === "\n";
        field += "\n";
        line += 1;
        i += crlf ? 2 : 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      begin();
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      begin();
      fields.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      const crlf = ch === "\r" && src[i + 1] === "\n";
      // A blank line between records is skipped rather than yielded as a one-empty-
      // field record, which would otherwise show up as a malformed row in every
      // export that ends with a trailing newline.
      if (started) endRecord(false);
      line += 1;
      i += crlf ? 2 : 1;
      continue;
    }

    begin();
    field += ch;
    i += 1;
  }

  if (started || inQuotes) endRecord(inQuotes);
  return records;
}
