import { describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { DESJARDINS_SOURCE_ID, DesjardinsFileSource } from "../src/desjardins.ts";
import { detectFormat } from "../src/text.ts";
import { calendarDate } from "../src/types.ts";
import type { ImportBatch, RawTransaction } from "../src/types.ts";

const FIXTURES = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures", "desjardins");

async function source(
  name: string,
  currency: "CAD" | "USD" = "CAD",
): Promise<DesjardinsFileSource> {
  return new DesjardinsFileSource({ bytes: await readFile(join(FIXTURES, name)), name, currency });
}

function byRef(batch: ImportBatch, ref: string): RawTransaction {
  const found = batch.transactions.find((t) => t.institutionRef === ref);
  if (found === undefined) throw new Error(`no transaction with institutionRef ${ref}`);
  return found;
}

// ---------------------------------------------------------------------------
// CSV — the happy path
// ---------------------------------------------------------------------------

describe("DesjardinsFileSource, CSV", () => {
  test("reads every row of the clean fixture with no problems", async () => {
    const batch = await (await source("eop-clean.csv")).fetch();
    expect(batch.sourceId).toBe(DESJARDINS_SOURCE_ID);
    expect(batch.format).toBe("csv");
    expect(batch.problems).toEqual([]);
    expect(batch.transactions).toHaveLength(11);
  });

  /** The real export is CP1252, not UTF-8, and has no BOM. */
  test("the fixture is byte-shaped like a real export", async () => {
    const bytes = await readFile(join(FIXTURES, "eop-clean.csv"));
    // Opens with a blank line, then a quoted field.
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0x0d, 0x0a, 0x22]);
    // 0xE9 is CP1252 "é" and is not valid UTF-8 on its own.
    expect(bytes.includes(0xe9)).toBe(true);
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes)).toThrow();
  });

  test("a withdrawal is negative and a deposit positive, from the account's perspective", async () => {
    const batch = await (await source("eop-clean.csv")).fetch();
    expect(byRef(batch, "00001").amount).toEqual({ minor: -8420, currency: "CAD" });
    expect(byRef(batch, "00002").amount).toEqual({ minor: 214500, currency: "CAD" });
  });

  test("dates are read as YYYY/MM/DD, the format the export actually uses", async () => {
    const batch = await (await source("eop-clean.csv")).fetch();
    const txn = byRef(batch, "00001");
    expect(txn.occurredOn).toBe(calendarDate("2026-01-05"));
    expect(txn.postedOn).toBeNull();
  });

  test("accents survive CP1252 decoding", async () => {
    const batch = await (await source("eop-clean.csv")).fetch();
    expect(byRef(batch, "00003").description).toBe("Achat par carte /Épicerie du Coin");
    expect(byRef(batch, "00006").description).toBe("Prêt personnel /Versement mensuel");
    expect(byRef(batch, "00008").description).toBe("Intérêt créditeur /Période janvier");
  });

  /**
   * The export names an account by folio plus product code and contains no full account
   * number at all. Two products share one folio, so masking the folio alone would
   * collapse them into a single account and interleave their balances.
   */
  test("the account key is the masked folio plus the product code", async () => {
    const batch = await (await source("eop-clean.csv")).fetch();
    expect(byRef(batch, "00001").accountRef).toBe("3456-EOP");
    const es1 = batch.transactions.filter((t) => t.accountRef === "3456-ES1");
    expect(es1).toHaveLength(1);
    // Nothing longer than the masked form ever leaves the parser.
    for (const txn of batch.transactions) expect(txn.accountRef).not.toContain("123456");
  });

  /**
   * The check that proves the column map is right rather than merely plausible. A map
   * that is off by one does not balance.
   */
  test("the parsed rows reproduce the fixture's own running balance, per product", async () => {
    const batch = await (await source("eop-clean.csv")).fetch({ accountRef: "3456-EOP" });
    const total = batch.transactions.reduce((sum, t) => sum + t.amount.minor, 400000);
    expect(total).toBe(377622); // 3 776,22 $, the last EOP balance in the file

    const savings = await (await source("eop-clean.csv")).fetch({ accountRef: "3456-ES1" });
    const savingsTotal = savings.transactions.reduce((sum, t) => sum + t.amount.minor, 100000);
    expect(savingsTotal).toBe(150000);
  });
});

// ---------------------------------------------------------------------------
// The accent-folded variant
// ---------------------------------------------------------------------------

/**
 * AccèsD offers the same export in two charsets: CP1252 with accents, and plain ASCII
 * with the accents folded away. It is the *same layout* — same fourteen columns, same
 * `YYYY/MM/DD`, same dot decimals, same leading blank line — so no parser change was
 * needed for it; encoding detection is per-file and ASCII is valid UTF-8.
 *
 * These tests exist to keep that true, and to pin down the one place the two variants
 * genuinely disagree.
 */
describe("DesjardinsFileSource, accent-folded ASCII variant", () => {
  test("the ASCII variant parses identically", async () => {
    const batch = await (await source("eop-clean-ascii.csv")).fetch();
    expect(batch.problems).toEqual([]);
    expect(batch.transactions).toHaveLength(11);
  });

  test("it really is ASCII, where the default export is CP1252", async () => {
    const ascii = await readFile(join(FIXTURES, "eop-clean-ascii.csv"));
    const cp1252 = await readFile(join(FIXTURES, "eop-clean.csv"));
    expect(ascii.every((b) => b < 0x80)).toBe(true);
    expect(cp1252.some((b) => b >= 0x80)).toBe(true);
    // Desjardins' folding is 1:1, so the two files are the same length.
    expect(ascii.length).toBe(cp1252.length);
  });

  test("every field except the description is identical across the two variants", async () => {
    const accented = await (await source("eop-clean.csv")).fetch();
    const folded = await (await source("eop-clean-ascii.csv")).fetch();
    expect(folded.transactions).toHaveLength(accented.transactions.length);

    for (const [i, a] of accented.transactions.entries()) {
      const b = folded.transactions[i]!;
      expect(b.occurredOn).toBe(a.occurredOn);
      expect(b.amount).toEqual(a.amount);
      expect(b.accountRef).toBe(a.accountRef);
      expect(b.institutionRef).toBe(a.institutionRef);
    }
  });

  /**
   * The finding that matters for SCOPE item 3, stated as an executable fact rather than
   * a note someone has to remember.
   *
   * The two variants describe the *same transaction* with two different strings. Item 3
   * hashes (account, date, amount, currency, description, institution_ref) — so a user
   * who downloads the accented file one month and the ASCII file the next gets a second
   * row for every transaction that contains an accent. Import would stop being
   * idempotent across variants, which is exactly the failure AGENTS.md names.
   *
   * Item 2 does not fix this: mangling the description to make hashing convenient would
   * be a parser inventing data. The decision belongs to item 3, and the options are on
   * record in PARKING-LOT.md.
   */
  test("descriptions differ between variants, which is a problem item 3 must solve", async () => {
    const accented = await (await source("eop-clean.csv")).fetch();
    const folded = await (await source("eop-clean-ascii.csv")).fetch();

    const differing = accented.transactions.filter(
      (a, i) => folded.transactions[i]!.description !== a.description,
    );
    expect(differing.length).toBeGreaterThan(0);

    // ...and they differ *only* by accent folding, which is what makes a normalising
    // hash a viable fix rather than a guess.
    const fold = (t: string): string => t.normalize("NFD").replace(/\p{Mn}/gu, "");
    for (const [i, a] of accented.transactions.entries()) {
      const b = folded.transactions[i]!;
      expect(fold(b.description)).toBe(fold(a.description));
    }
  });
});

// ---------------------------------------------------------------------------
// CSV — RFC 4180 cases the July sample happens not to contain
// ---------------------------------------------------------------------------

describe("DesjardinsFileSource, CSV quoting", () => {
  test("a comma inside a quoted description survives", async () => {
    const batch = await (await source("eop-quoting.csv")).fetch();
    expect(byRef(batch, "00001").description).toBe("Achat /Marchand, succursale 12");
  });

  test("a doubled quote becomes one literal quote", async () => {
    const batch = await (await source("eop-quoting.csv")).fetch();
    expect(byRef(batch, "00002").description).toBe('Resto "Le Paris" inc');
  });

  test("a description spanning a quoted CRLF is one transaction", async () => {
    const batch = await (await source("eop-quoting.csv")).fetch();
    const txn = byRef(batch, "00003");
    expect(txn.description).toBe("Achat en ligne livraison retardée");
    expect(txn.amount.minor).toBe(-1200);
  });

  /**
   * The verified export is dot-decimal, but a comma decimal is unambiguous when the
   * digits after it are not a thousands group, so it is accepted rather than rejected.
   * A locale change at the bank should not silently drop every row.
   */
  test("a comma decimal is still read correctly when unambiguous", async () => {
    const batch = await (await source("eop-quoting.csv")).fetch();
    // The value sits in the withdrawal column, so it is negative.
    expect(byRef(batch, "00004").amount.minor).toBe(-8420);
  });

  test("all four quoting cases parse with no problems", async () => {
    const batch = await (await source("eop-quoting.csv")).fetch();
    expect(batch.problems).toEqual([]);
    expect(batch.transactions).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// CSV — rejections
// ---------------------------------------------------------------------------

describe("DesjardinsFileSource, CSV rejections", () => {
  test("every row of the invalid fixture is rejected, none silently dropped", async () => {
    const batch = await (await source("eop-invalid.csv")).fetch();
    expect(batch.transactions).toEqual([]);
    expect(batch.problems).toHaveLength(10);
  });

  test("each row is rejected for its own stated reason, one problem per row", async () => {
    const batch = await (await source("eop-invalid.csv")).fetch();
    // Line 1 of the file is blank, as it is in a real export, so records start at 2.
    expect(batch.problems.map((p) => [p.at.line, p.code])).toEqual([
      [2, "malformed_record"], // 8 fields, not 14
      [3, "invalid_date"], // 2026/02/30
      [4, "invalid_date"], // 2026/13/01
      [5, "invalid_date"], // 01/02/2026 — ambiguous, so rejected
      [6, "invalid_amount"], // withdrawal and deposit both populated
      [7, "invalid_amount"], // "ABC"
      [8, "zero_amount"], // 0.00
      [9, "zero_amount"], // neither column populated
      [10, "missing_description"], // empty description
      [11, "malformed_record"], // unterminated quote
    ]);
  });

  /**
   * The trap AGENTS.md names. `01/02/2026` is 1 February in DD/MM and 2 January in
   * MM/DD. The layout declares one format and the parser refuses to guess.
   */
  test("an ambiguous date is rejected rather than resolved by coin flip", async () => {
    const batch = await (await source("eop-invalid.csv")).fetch();
    const problem = batch.problems.find((p) => p.at.line === 5);
    expect(problem?.code).toBe("invalid_date");
    expect(problem?.message).toContain("YYYY/MM/DD");
  });

  test("problem messages never contain a full account number", async () => {
    const batch = await (await source("eop-invalid.csv")).fetch();
    for (const problem of batch.problems) {
      expect(problem.message).not.toContain("123456");
    }
  });
});

// ---------------------------------------------------------------------------
// The seam
// ---------------------------------------------------------------------------

describe("format detection and filtering", () => {
  test("format is detected from the file header", async () => {
    expect(detectFormat(await readFile(join(FIXTURES, "eop-clean.csv")))).toBe("csv");
    expect(detectFormat(await readFile(join(FIXTURES, "eop-clean-ascii.csv")))).toBe("csv");
  });

  /**
   * Desjardins publishes no OFX, so an OFX file here is a caller mistake. Thrown rather
   * than collected as row problems: every line would come back `malformed_record` and
   * bury the real cause.
   */
  test("pointing the Desjardins source at an OFX file is an error, not a parse", async () => {
    const src = new DesjardinsFileSource({
      bytes: new TextEncoder().encode("OFXHEADER:100\r\n\r\n<OFX>\r\n"),
      name: "statement-clean.ofx",
      currency: "CAD",
    });
    await expect(src.fetch()).rejects.toThrow(/OFX document; Desjardins publishes CSV only/);
  });

  test("accountRef filters a multi-account export", async () => {
    const batch = await (await source("eop-clean.csv")).fetch({ accountRef: "3456-EOP" });
    expect(batch.transactions).toHaveLength(10);
    for (const txn of batch.transactions) expect(txn.accountRef).toBe("3456-EOP");
  });

  test("since and until are inclusive calendar-date bounds", async () => {
    const src = await source("eop-clean.csv");
    const window = await src.fetch({
      since: calendarDate("2026-01-08"),
      until: calendarDate("2026-01-15"),
    });
    expect(window.transactions.map((t) => t.occurredOn)).toEqual([
      calendarDate("2026-01-08"),
      calendarDate("2026-01-12"),
      calendarDate("2026-01-15"),
    ]);
  });

  /**
   * A rejected row has no readable date or account to filter on. Dropping it because it
   * *might* fall outside the window is how an import silently loses a line.
   */
  test("filters never suppress problems", async () => {
    const batch = await (
      await source("eop-invalid.csv")
    ).fetch({
      since: calendarDate("2030-01-01"),
      accountRef: "0000",
    });
    expect(batch.transactions).toEqual([]);
    expect(batch.problems).toHaveLength(10);
  });

  /** Item 2 stops at validated values. Nothing here writes, hashes, or classifies. */
  test("no hash, type or category is invented at this layer", async () => {
    const batch = await (await source("eop-clean.csv")).fetch();
    const txn = batch.transactions[0]!;
    expect(Object.keys(txn).sort()).toEqual([
      "accountRef",
      "amount",
      "at",
      "description",
      "institutionRef",
      "occurredOn",
      "postedOn",
      "sourceId",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Paths that no fixture reaches
// ---------------------------------------------------------------------------

describe("structural failures", () => {
  test("a CP1252-encoded CSV decodes without mojibake", async () => {
    const row =
      '"Montr\u00e9al","123456","EOP","2026/01/15",00001,"\u00c9picerie M\u00e9tro","",84.20,"","","","","",1000.00\r\n';

    const batch = await new DesjardinsFileSource({
      bytes: Buffer.from(row, "latin1"),
      name: "cp1252.csv",
      currency: "CAD",
    }).fetch();
    expect(batch.problems).toEqual([]);
    expect(batch.transactions[0]?.description).toBe("\u00c9picerie M\u00e9tro");
  });

  /**
   * Portage tested missing-file rejection here, but A2 removed path I/O from the source
   * entirely (bytes are supplied by the caller), so that premise no longer applies.
   * Deliberately dropped.
   */
});
