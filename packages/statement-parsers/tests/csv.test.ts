import { describe, expect, test } from "vitest";
import { parseCsv } from "../src/csv.ts";

describe("parseCsv", () => {
  test("plain records, CRLF and LF alike", () => {
    expect(parseCsv("a,b,c\r\nd,e,f\r\n").map((r) => r.fields)).toEqual([
      ["a", "b", "c"],
      ["d", "e", "f"],
    ]);
    expect(parseCsv("a,b,c\nd,e,f").map((r) => r.fields)).toEqual([
      ["a", "b", "c"],
      ["d", "e", "f"],
    ]);
  });

  test("strips a UTF-8 BOM rather than gluing it to the first field", () => {
    const [record] = parseCsv("\uFEFF00815,0000101\r\n");
    expect(record?.fields[0]).toBe("00815");
  });

  test("a quoted field may contain the delimiter", () => {
    const [record] = parseCsv('a,"DEPOT SALAIRE, PAIE 2026-01",c\r\n');
    expect(record?.fields).toEqual(["a", "DEPOT SALAIRE, PAIE 2026-01", "c"]);
  });

  test("a doubled quote is one literal quote", () => {
    const [record] = parseCsv('a,"RESTO ""LE PARIS"" INC",c\r\n');
    expect(record?.fields[1]).toBe('RESTO "LE PARIS" INC');
  });

  /**
   * The case that makes `split("\n")` wrong. A line-splitting reader turns this single
   * record into two malformed halves and loses the transaction.
   */
  test("a newline inside a quoted field is data, not a record terminator", () => {
    const records = parseCsv('a,"ACHAT EN LIGNE\r\nLIVRAISON RETARDEE",c\r\nd,e,f\r\n');
    expect(records).toHaveLength(2);
    expect(records[0]?.fields[1]).toBe("ACHAT EN LIGNE\nLIVRAISON RETARDEE");
    expect(records[0]?.line).toBe(1);
    // The following record still reports its true physical line.
    expect(records[1]?.line).toBe(3);
  });

  test("empty fields are preserved, including trailing ones", () => {
    const [record] = parseCsv("a,,c,\r\n");
    expect(record?.fields).toEqual(["a", "", "c", ""]);
  });

  test("blank lines are skipped, not yielded as empty records", () => {
    expect(parseCsv("a,b\r\n\r\n\r\nc,d\r\n")).toHaveLength(2);
    expect(parseCsv("a,b\r\n")).toHaveLength(1);
  });

  test("a record without a trailing newline is still yielded", () => {
    expect(parseCsv("a,b,c").map((r) => r.fields)).toEqual([["a", "b", "c"]]);
  });

  test("an unterminated quote is flagged and consumes the rest of the file", () => {
    const records = parseCsv('a,b\r\nc,"unterminated,d\r\ne,f\r\n');
    expect(records).toHaveLength(2);
    expect(records[0]?.malformed).toBe(false);
    expect(records[1]?.malformed).toBe(true);
    expect(records[1]?.line).toBe(2);
  });

  test("line numbers are 1-indexed and count physical lines", () => {
    expect(parseCsv("a\r\nb\r\nc\r\n").map((r) => r.line)).toEqual([1, 2, 3]);
  });
});
