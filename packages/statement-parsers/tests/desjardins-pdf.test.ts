import { describe, expect, test } from "vitest";

import { DESJARDINS_PDF_SOURCE_ID, parseDesjardinsPdfLines } from "../src/desjardins-pdf.ts";
import { DesjardinsFileSource } from "../src/desjardins.ts";
import type { PageCell, PageLine } from "../src/pdf/lines.ts";
import { calendarDate } from "../src/types.ts";
import type { ImportBatch, RawTransaction } from "../src/types.ts";

const FILE = "test.pdf";

function cell(x: number, text: string): PageCell {
  return { x, text };
}

function line(y: number, cells: readonly PageCell[], page = 1): PageLine {
  return { page, y, cells };
}

// Round numbers, deliberately not tied to any real or synthetic-generator x-value —
// W3-D3 derives geometry from whichever header row is actually in the input.
const HEADER = line(800, [
  cell(40, "Date"),
  cell(90, "Code"),
  cell(130, "Description"),
  cell(350, "Frais"),
  cell(420, "Retrait"),
  cell(490, "Dépôt"),
  cell(565, "Solde"),
]);

function letterhead(period: string, accountRef: string): PageLine[] {
  return [
    line(900, [cell(40, `Pour la période du ${period}`)]),
    line(880, [cell(40, `Compte ${accountRef} du titulaire`)]),
  ];
}

const JANUARY_2026 = letterhead("1er janvier au 31 janvier 2026", "SJ 123-45678-9");

function marker(code: string, y: number): PageLine {
  return line(y, [cell(40, `${code} COMPTE D'OPÉRATIONS COURANTES`)]);
}

function opening(y: number, solde: string): PageLine {
  return line(y, [cell(130, "Solde reporté"), cell(565, solde)]);
}

interface TxnOpts {
  readonly frais?: string;
  readonly retrait?: string;
  readonly depot?: string;
  readonly solde?: string;
}

/** Fully split date/code/description cells — the "best case" geometry. */
function txn(
  y: number,
  day: string,
  month: string,
  code: string,
  description: string,
  opts: TxnOpts = {},
): PageLine {
  const cells: PageCell[] = [cell(40, `${day} ${month}`), cell(90, code), cell(130, description)];
  if (opts.frais !== undefined) cells.push(cell(350, opts.frais));
  if (opts.retrait !== undefined) cells.push(cell(420, opts.retrait));
  if (opts.depot !== undefined) cells.push(cell(490, opts.depot));
  if (opts.solde !== undefined) cells.push(cell(565, opts.solde));
  return line(y, cells);
}

function continuation(y: number, text: string): PageLine {
  return line(y, [cell(130, text)]);
}

function byDescription(batch: ImportBatch, description: string): RawTransaction {
  const found = batch.transactions.find((t) => t.description === description);
  if (found === undefined) throw new Error(`no transaction with description ${description}`);
  return found;
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("parseDesjardinsPdfLines, happy path", () => {
  test("reads a single product's chain with no problems", () => {
    const lines: PageLine[] = [
      ...JANUARY_2026,
      marker("EOP", 860),
      HEADER,
      opening(786, "1 000.00"),
      txn(772, "2", "JAN", "RETR", "Retrait guichet automatique", { retrait: "45.67" }),
      txn(758, "3", "JAN", "DEP", "Dépôt direct paie employeur", {
        depot: "500.00",
        solde: "1 454.33",
      }),
    ];

    const batch = parseDesjardinsPdfLines(lines, FILE, "CAD");
    expect(batch.sourceId).toBe(DESJARDINS_PDF_SOURCE_ID);
    expect(batch.format).toBe("pdf");
    expect(batch.problems).toEqual([]);
    expect(batch.transactions).toHaveLength(2);

    const withdrawal = byDescription(batch, "Retrait guichet automatique");
    expect(withdrawal.amount).toEqual({ minor: -4567, currency: "CAD" });
    expect(withdrawal.occurredOn).toBe(calendarDate("2026-01-02"));
    expect(withdrawal.institutionRef).toBe("RETR");

    const deposit = byDescription(batch, "Dépôt direct paie employeur");
    expect(deposit.amount).toEqual({ minor: 50000, currency: "CAD" });
  });

  test("the account key is the masked reference plus the product code, never the full reference", () => {
    const lines: PageLine[] = [
      ...JANUARY_2026,
      marker("EOP", 860),
      HEADER,
      opening(786, "1 000.00"),
      txn(772, "2", "JAN", "RETR", "Retrait", { retrait: "45.67", solde: "954.33" }),
    ];
    const batch = parseDesjardinsPdfLines(lines, FILE, "CAD");
    const ref = batch.transactions[0]?.accountRef;
    expect(ref).toBeDefined();
    expect(ref?.endsWith("-EOP")).toBe(true);
    expect(ref).not.toContain("45678");
    expect(ref?.length).toBeLessThanOrEqual(8);
  });

  test("frais alongside retrait reduces the balance by both (W3-D8: one row, net effect)", () => {
    const lines: PageLine[] = [
      ...JANUARY_2026,
      marker("EOP", 860),
      HEADER,
      opening(786, "1 000.00"),
      txn(772, "8", "JAN", "FRAIS", "Frais de transaction", {
        frais: "1.25",
        retrait: "25.00",
        solde: "973.75",
      }),
    ];
    const batch = parseDesjardinsPdfLines(lines, FILE, "CAD");
    expect(batch.problems).toEqual([]);
    expect(batch.transactions).toHaveLength(1);
    expect(batch.transactions[0]?.amount.minor).toBe(-2625);
  });
});

// ---------------------------------------------------------------------------
// Column assignment / merged cells (W3-D3, W3-D4 — S4's real-sample findings)
// ---------------------------------------------------------------------------

describe("parseDesjardinsPdfLines, merged-cell geometry", () => {
  test("date+code merged into one cell still parses (S4: always merges at real spacing)", () => {
    const lines: PageLine[] = [
      ...JANUARY_2026,
      marker("EOP", 860),
      HEADER,
      opening(786, "1 000.00"),
      line(772, [
        cell(40, "2 JAN VWW"),
        cell(130, "Retrait guichet"),
        cell(420, "45.67"),
        cell(565, "954.33"),
      ]),
    ];
    const batch = parseDesjardinsPdfLines(lines, FILE, "CAD");
    expect(batch.problems).toEqual([]);
    expect(batch.transactions).toHaveLength(1);
    expect(batch.transactions[0]?.occurredOn).toBe(calendarDate("2026-01-02"));
    expect(batch.transactions[0]?.institutionRef).toBe("VWW");
    expect(batch.transactions[0]?.description).toBe("Retrait guichet");
  });

  test("date+code+description fully merged into one cell still parses (S4: 3-letter codes)", () => {
    const lines: PageLine[] = [
      ...JANUARY_2026,
      marker("EOP", 860),
      HEADER,
      opening(786, "1 000.00"),
      line(772, [
        cell(40, "2 JAN VWW Retrait guichet automatique"),
        cell(420, "45.67"),
        cell(565, "954.33"),
      ]),
    ];
    const batch = parseDesjardinsPdfLines(lines, FILE, "CAD");
    expect(batch.problems).toEqual([]);
    expect(batch.transactions).toHaveLength(1);
    expect(batch.transactions[0]?.description).toBe("Retrait guichet automatique");
  });

  test("a wrapped description continuation is appended to the previous transaction", () => {
    const lines: PageLine[] = [
      ...JANUARY_2026,
      marker("EOP", 860),
      HEADER,
      opening(786, "1 000.00"),
      txn(772, "7", "JAN", "RETR", "Paiement facture téléphone internet", {
        retrait: "1 234.56",
        solde: "-234.56",
      }),
      continuation(758, "télévision câblé"),
    ];
    const batch = parseDesjardinsPdfLines(lines, FILE, "CAD");
    expect(batch.problems).toEqual([]);
    expect(batch.transactions).toHaveLength(1);
    expect(batch.transactions[0]?.description).toBe(
      "Paiement facture téléphone internet télévision câblé",
    );
  });

  test("a footer at the page margin is not mistaken for a wrapped continuation", () => {
    const lines: PageLine[] = [
      ...JANUARY_2026,
      marker("EOP", 860),
      HEADER,
      opening(786, "1 000.00"),
      txn(772, "2", "JAN", "RETR", "Retrait guichet", { retrait: "45.67", solde: "954.33" }),
      line(758, [cell(40, "Page 2 de 2")]), // date-bucket x, not description-bucket x
    ];
    const batch = parseDesjardinsPdfLines(lines, FILE, "CAD");
    expect(batch.problems).toEqual([]);
    expect(batch.transactions).toHaveLength(1);
    expect(batch.transactions[0]?.description).toBe("Retrait guichet");
  });
});

// ---------------------------------------------------------------------------
// Section detection: markers, header repeats, multiple products
// ---------------------------------------------------------------------------

describe("parseDesjardinsPdfLines, sections", () => {
  test("a repeated header with no preceding marker continues the same chain (e.g. a page break)", () => {
    const lines: PageLine[] = [
      ...JANUARY_2026,
      marker("EOP", 860),
      HEADER,
      opening(786, "1 000.00"),
      txn(772, "2", "JAN", "RETR", "Retrait", { retrait: "45.67" }),
      line(700, HEADER.cells, 2), // page 2 repeat, no new marker
      txn(686, "3", "JAN", "DEP", "Dépôt", { depot: "500.00", solde: "1 454.33" }),
    ];
    const batch = parseDesjardinsPdfLines(lines, FILE, "CAD");
    expect(batch.problems).toEqual([]);
    expect(batch.transactions).toHaveLength(2);
    // Both rows belong to the one EOP chain, not two separate ones.
    expect(new Set(batch.transactions.map((t) => t.accountRef)).size).toBe(1);
  });

  test("two products in one file get independent balance chains and account refs", () => {
    const lines: PageLine[] = [
      ...JANUARY_2026,
      marker("EOP", 860),
      HEADER,
      opening(786, "1 000.00"),
      txn(772, "2", "JAN", "RETR", "Retrait EOP", { retrait: "45.67", solde: "954.33" }),
      marker("ES", 750),
      HEADER,
      opening(736, "200.00"),
      txn(722, "3", "JAN", "DEP", "Dépôt ES", { depot: "50.00", solde: "250.00" }),
    ];
    const batch = parseDesjardinsPdfLines(lines, FILE, "CAD");
    expect(batch.problems).toEqual([]);
    expect(batch.transactions).toHaveLength(2);
    expect(byDescription(batch, "Retrait EOP").accountRef?.endsWith("-EOP")).toBe(true);
    expect(byDescription(batch, "Dépôt ES").accountRef?.endsWith("-ES")).toBe(true);
    expect(byDescription(batch, "Retrait EOP").accountRef).not.toBe(
      byDescription(batch, "Dépôt ES").accountRef,
    );
  });

  test("one product's reconciliation failure doesn't affect another product in the same file", () => {
    const lines: PageLine[] = [
      ...JANUARY_2026,
      marker("EOP", 860),
      HEADER,
      opening(786, "1 000.00"),
      // Wrong closing balance on purpose.
      txn(772, "2", "JAN", "RETR", "Retrait EOP", { retrait: "45.67", solde: "999.99" }),
      marker("ES", 750),
      HEADER,
      opening(736, "200.00"),
      txn(722, "3", "JAN", "DEP", "Dépôt ES", { depot: "50.00", solde: "250.00" }),
    ];
    const batch = parseDesjardinsPdfLines(lines, FILE, "CAD");
    expect(batch.transactions).toHaveLength(1);
    expect(batch.transactions[0]?.description).toBe("Dépôt ES");
    expect(batch.problems).toHaveLength(1);
    expect(batch.problems[0]?.code).toBe("reconciliation_failed");
    expect(batch.problems[0]?.message).toContain("EOP");
  });
});

// ---------------------------------------------------------------------------
// Reconciliation (D5 hard gate)
// ---------------------------------------------------------------------------

describe("parseDesjardinsPdfLines, reconciliation (D5)", () => {
  test("a product that reconciles keeps all its transactions", () => {
    const lines: PageLine[] = [
      ...JANUARY_2026,
      marker("EOP", 860),
      HEADER,
      opening(786, "1 000.00"),
      txn(772, "2", "JAN", "RETR", "Retrait", { retrait: "45.67" }),
      txn(758, "3", "JAN", "DEP", "Dépôt", { depot: "500.00", solde: "1 454.33" }),
    ];
    const batch = parseDesjardinsPdfLines(lines, FILE, "CAD");
    expect(batch.transactions).toHaveLength(2);
    expect(batch.problems).toEqual([]);
  });

  test("a product that does not reconcile is rejected wholesale, not as a warning (D5)", () => {
    const lines: PageLine[] = [
      ...JANUARY_2026,
      marker("EOP", 860),
      HEADER,
      opening(786, "1 000.00"),
      txn(772, "2", "JAN", "RETR", "Retrait", { retrait: "45.67" }),
      txn(758, "3", "JAN", "DEP", "Dépôt", { depot: "500.00", solde: "1 999.99" }), // wrong
    ];
    const batch = parseDesjardinsPdfLines(lines, FILE, "CAD");
    expect(batch.transactions).toEqual([]);
    expect(batch.problems).toHaveLength(1);
    expect(batch.problems[0]?.code).toBe("reconciliation_failed");
    expect(batch.problems[0]?.message).toContain("EOP");
  });

  test("a missing opening balance line is flagged and the product cannot reconcile", () => {
    const lines: PageLine[] = [
      ...JANUARY_2026,
      marker("EOP", 860),
      HEADER,
      // No "Solde reporté" row — straight to a transaction.
      txn(772, "2", "JAN", "RETR", "Retrait", { retrait: "45.67", solde: "954.33" }),
    ];
    const batch = parseDesjardinsPdfLines(lines, FILE, "CAD");
    expect(batch.transactions).toEqual([]);
    expect(batch.problems.map((p) => p.code)).toEqual([
      "malformed_record",
      "reconciliation_failed",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Problem codes
// ---------------------------------------------------------------------------

describe("parseDesjardinsPdfLines, problem codes", () => {
  test("invalid_date: an unreadable date does not block reconciliation of the rest (W3-D7)", () => {
    const lines: PageLine[] = [
      ...JANUARY_2026,
      marker("EOP", 860),
      HEADER,
      opening(786, "1 000.00"),
      // 30 février does not exist, but the amount is still counted.
      txn(772, "30", "FÉV", "RETR", "Retrait suspect", { retrait: "45.67" }),
      txn(758, "3", "JAN", "DEP", "Dépôt", { depot: "500.00", solde: "1 454.33" }),
    ];
    const batch = parseDesjardinsPdfLines(lines, FILE, "CAD");
    expect(batch.transactions).toHaveLength(1);
    expect(batch.transactions[0]?.description).toBe("Dépôt");
    expect(batch.problems).toHaveLength(1);
    expect(batch.problems[0]?.code).toBe("invalid_date");
  });

  test("invalid_amount: both retrait and dépôt populated on one row", () => {
    const lines: PageLine[] = [
      ...JANUARY_2026,
      marker("EOP", 860),
      HEADER,
      opening(786, "1 000.00"),
      txn(772, "2", "JAN", "RETR", "Ambigu", { retrait: "10.00", depot: "10.00" }),
    ];
    const batch = parseDesjardinsPdfLines(lines, FILE, "CAD");
    expect(batch.transactions).toEqual([]);
    expect(batch.problems.some((p) => p.code === "invalid_amount")).toBe(true);
  });

  test("invalid_amount: two cells land in the same money column", () => {
    const lines: PageLine[] = [
      ...JANUARY_2026,
      marker("EOP", 860),
      HEADER,
      opening(786, "1 000.00"),
      line(772, [
        cell(40, "2 JAN"),
        cell(90, "RETR"),
        cell(130, "Ambigu"),
        cell(415, "10.00"),
        cell(425, "20.00"),
      ]),
    ];
    const batch = parseDesjardinsPdfLines(lines, FILE, "CAD");
    expect(batch.transactions).toEqual([]);
    expect(batch.problems.some((p) => p.code === "invalid_amount")).toBe(true);
  });

  test("zero_amount: no money column populated", () => {
    const lines: PageLine[] = [
      ...JANUARY_2026,
      marker("EOP", 860),
      HEADER,
      opening(786, "1 000.00"),
      txn(772, "2", "JAN", "RETR", "Rien"),
    ];
    const batch = parseDesjardinsPdfLines(lines, FILE, "CAD");
    expect(batch.transactions).toEqual([]);
    expect(batch.problems.some((p) => p.code === "zero_amount")).toBe(true);
  });

  test("missing_description: a code with nothing after it", () => {
    const lines: PageLine[] = [
      ...JANUARY_2026,
      marker("EOP", 860),
      HEADER,
      opening(786, "1 000.00"),
      line(772, [cell(40, "2 JAN"), cell(90, "RETR"), cell(420, "45.67")]),
    ];
    const batch = parseDesjardinsPdfLines(lines, FILE, "CAD");
    expect(batch.transactions).toEqual([]);
    expect(batch.problems.some((p) => p.code === "missing_description")).toBe(true);
  });

  test("problem messages never contain the full account reference", () => {
    const lines: PageLine[] = [
      ...JANUARY_2026,
      marker("EOP", 860),
      HEADER,
      txn(772, "2", "JAN", "RETR", "Retrait", { retrait: "45.67", solde: "954.33" }),
    ];
    const batch = parseDesjardinsPdfLines(lines, FILE, "CAD");
    for (const problem of batch.problems) {
      expect(problem.message).not.toContain("45678");
    }
  });
});

// ---------------------------------------------------------------------------
// French dates: the year-wraparound heuristic (W3-D10)
// ---------------------------------------------------------------------------

describe("parseDesjardinsPdfLines, year wraparound", () => {
  test("a period crossing a year boundary assigns the earlier year to the later-in-calendar month", () => {
    const lines: PageLine[] = [
      ...letterhead("15 décembre au 15 janvier 2026", "SJ 123-45678-9"),
      marker("EOP", 860),
      HEADER,
      opening(786, "1 000.00"),
      txn(772, "20", "DEC", "RETR", "Retrait décembre", { retrait: "45.67" }),
      txn(758, "5", "JAN", "DEP", "Dépôt janvier", { depot: "500.00", solde: "1 454.33" }),
    ];
    const batch = parseDesjardinsPdfLines(lines, FILE, "CAD");
    expect(batch.problems).toEqual([]);
    expect(byDescription(batch, "Retrait décembre").occurredOn).toBe(calendarDate("2025-12-20"));
    expect(byDescription(batch, "Dépôt janvier").occurredOn).toBe(calendarDate("2026-01-05"));
  });

  test("no period line found: every row is invalid_date, but amounts still reconcile", () => {
    const lines: PageLine[] = [
      marker("EOP", 860),
      HEADER,
      opening(786, "1 000.00"),
      txn(772, "2", "JAN", "RETR", "Retrait", { retrait: "45.67" }),
      txn(758, "3", "JAN", "DEP", "Dépôt", { depot: "500.00", solde: "1 454.33" }),
    ];
    const batch = parseDesjardinsPdfLines(lines, FILE, "CAD");
    expect(batch.transactions).toEqual([]);
    expect(batch.problems.filter((p) => p.code === "invalid_date")).toHaveLength(2);
    expect(batch.problems.some((p) => p.code === "reconciliation_failed")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The seam: request filtering still applies (reuses common.ts's assembleBatch)
// ---------------------------------------------------------------------------

describe("parseDesjardinsPdfLines, the seam", () => {
  test("accountRef filters a multi-product file", () => {
    const lines: PageLine[] = [
      ...JANUARY_2026,
      marker("EOP", 860),
      HEADER,
      opening(786, "1 000.00"),
      txn(772, "2", "JAN", "RETR", "Retrait EOP", { retrait: "45.67", solde: "954.33" }),
      marker("ES", 750),
      HEADER,
      opening(736, "200.00"),
      txn(722, "3", "JAN", "DEP", "Dépôt ES", { depot: "50.00", solde: "250.00" }),
    ];
    const full = parseDesjardinsPdfLines(lines, FILE, "CAD");
    const eopRef = byDescription(full, "Retrait EOP").accountRef;
    expect(eopRef).toBeDefined();
    if (eopRef !== undefined && eopRef !== null) {
      const filtered = parseDesjardinsPdfLines(lines, FILE, "CAD", { accountRef: eopRef });
      expect(filtered.transactions).toHaveLength(1);
      expect(filtered.transactions[0]?.description).toBe("Retrait EOP");
    }
  });
});

// ---------------------------------------------------------------------------
// D4: cross-check against the verified Desjardins CSV source
// ---------------------------------------------------------------------------

/**
 * No real overlapping month exists this session, so this pairs a small synthetic
 * CSV (the verified `DESJARDINS_EOP_LAYOUT` shape) with a small synthetic PDF-grammar
 * fixture describing the *same* transactions, and asserts the two sources agree.
 */
describe("cross-check against the CSV source (D4)", () => {
  test("PDF and CSV agree on date and amount for the same transactions", async () => {
    const csvText =
      "\r\n" +
      '"Montréal","123456","EOP","2026/01/02",00001,"Retrait guichet","",45.67,"","","","","",95433\r\n' +
      '"Montréal","123456","EOP","2026/01/03",00002,"Dépôt paie","","",500.00,"","","","",145433\r\n';
    const csvBatch = await new DesjardinsFileSource({
      bytes: new TextEncoder().encode(csvText),
      name: "eop.csv",
      currency: "CAD",
    }).fetch();
    expect(csvBatch.problems).toEqual([]);

    const pdfLines: PageLine[] = [
      ...JANUARY_2026,
      marker("EOP", 860),
      HEADER,
      opening(786, "1 000.00"),
      txn(772, "2", "JAN", "RETR", "Retrait guichet", { retrait: "45.67" }),
      txn(758, "3", "JAN", "DEP", "Dépôt paie", { depot: "500.00", solde: "1 454.33" }),
    ];
    const pdfBatch = parseDesjardinsPdfLines(pdfLines, FILE, "CAD");
    expect(pdfBatch.problems).toEqual([]);

    expect(pdfBatch.transactions).toHaveLength(csvBatch.transactions.length);
    for (const csvTxn of csvBatch.transactions) {
      const pdfTxn = pdfBatch.transactions.find((t) => t.description === csvTxn.description);
      expect(pdfTxn).toBeDefined();
      expect(pdfTxn?.occurredOn).toBe(csvTxn.occurredOn);
      expect(pdfTxn?.amount).toEqual(csvTxn.amount);
    }
  });
});
