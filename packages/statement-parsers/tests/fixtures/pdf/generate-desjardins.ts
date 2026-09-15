/**
 * WP-3 (W3-D11): a Desjardins-grammar synthetic PDF generator, separate from
 * `generate.ts` (WP-2's generic PDF-layer fixture, whose golden test pins an
 * exact literal — upgrading it in place would break that frozen review). This
 * generator exercises the full Desjardins grammar: multiple products, each with
 * its own `Solde reporté` opening line and a reconciling per-row balance chain,
 * wrapped descriptions, `D MON` French dates, and period-decimal amounts
 * (`2 485.06`, not `2 485,06` — NOTES §S4). All content is invented; nothing here
 * is a real folio, account, or balance.
 */

import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PAGE_WIDTH = 612;
// Deliberately shorter than a real Letter page (792): forces a page break inside
// product 1's row list without needing an oversized fixture, so the golden test
// exercises the real-pdfjs "header repeats, same chain continues" path (W3-D6).
const PAGE_HEIGHT = 260;
const MARGIN = 40;

const BODY_SIZE = 8;
const HEADER_SIZE = 8;
const TITLE_SIZE = 12;
const ROW_PITCH = 12;

const DATE_X = 40;
// A small, deliberate gap: date+code merge into one `PageLine` cell at real
// spacing (NOTES §S4). Description stays well clear so it never merges — the
// merged-description case is already exhaustively unit-tested by hand-built
// fixtures in `tests/desjardins-pdf.test.ts`; this generator's job is proving the
// real pdfjs pipeline handles the date+code merge, not re-deriving every case.
const DATE_CODE_GAP = 2;
const DESCRIPTION_X = 130;
const DESCRIPTION_MAX_WIDTH = 180;

const MONEY_RIGHT_EDGES = {
  frais: 350,
  retrait: 420,
  depot: 490,
  solde: 565,
} as const;

function formatMoney(value: number): string {
  const negative = value < 0;
  const abs = Math.abs(Math.round(value * 100) / 100);
  const [whole = "0", fraction = "00"] = abs.toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, " ");
  return `${negative ? "-" : ""}${grouped}.${fraction}`;
}

function wrapDescription(text: string, font: PDFFont, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (font.widthOfTextAtSize(candidate, BODY_SIZE) <= maxWidth) {
      current = candidate;
    } else {
      if (current !== "") lines.push(current);
      current = word;
    }
  }
  if (current !== "") lines.push(current);
  return lines.length === 0 ? [""] : lines;
}

interface TxnSpec {
  readonly day: number;
  readonly month: string;
  readonly code: string;
  readonly description: string;
  /** Magnitudes only — always non-negative, matching a normal statement row. */
  readonly frais?: number;
  readonly retrait?: number;
  readonly depot?: number;
}

interface ProductSpec {
  readonly code: string;
  readonly label: string;
  readonly opening: number;
  readonly rows: readonly TxnSpec[];
}

const PRODUCTS: readonly ProductSpec[] = [
  {
    code: "EOP",
    label: "COMPTE D'OPÉRATIONS COURANTES",
    opening: 1000.0,
    rows: [
      { day: 2, month: "JAN", code: "RETR", description: "Retrait guichet automatique", retrait: 45.67 },
      { day: 3, month: "JAN", code: "DEP", description: "Dépôt direct paie employeur", depot: 1234.56 },
      { day: 4, month: "JAN", code: "FRAIS", description: "Frais de service mensuel", frais: 12.5 },
      { day: 5, month: "JAN", code: "RETR", description: "Paiement par carte épicerie du coin", retrait: 89.12 },
      { day: 6, month: "JAN", code: "DEP", description: "Virement reçu", depot: 500.0 },
      {
        day: 7,
        month: "JAN",
        code: "RETR",
        description: "Paiement facture téléphone internet télévision câblé très long détail",
        retrait: 1234.56,
      },
      { day: 8, month: "JAN", code: "FRAIS", description: "Frais de transaction", frais: 1.25, retrait: 25.0 },
      { day: 9, month: "JAN", code: "RETR", description: "Achat station-service", retrait: 56.78 },
      { day: 10, month: "JAN", code: "DEP", description: "Remboursement ami", depot: 75.0 },
      { day: 11, month: "JAN", code: "RETR", description: "Restaurant centre-ville", retrait: 34.9 },
      { day: 12, month: "JAN", code: "RETR", description: "Pharmacie médicaments ordonnance", retrait: 23.45 },
      { day: 13, month: "JAN", code: "DEP", description: "Dépôt chèque client", depot: 890.0 },
      { day: 14, month: "JAN", code: "FRAIS", description: "Frais de découvert", frais: 5.0 },
      {
        day: 15,
        month: "JAN",
        code: "RETR",
        description: "Paiement par carte grand magasin général du centre commercial",
        retrait: 156.34,
      },
    ],
  },
  {
    code: "ES",
    label: "COMPTE D'ÉPARGNE",
    opening: 200.0,
    rows: [
      { day: 16, month: "JAN", code: "DEP", description: "Virement entre comptes", depot: 300.0 },
      { day: 17, month: "JAN", code: "DI", description: "Intérêt crédité", depot: 2.5 },
      { day: 18, month: "JAN", code: "RETR", description: "Retrait guichet secondaire", retrait: 60.0 },
      { day: 19, month: "JAN", code: "DEP", description: "Dépôt espèces succursale", depot: 150.0 },
      { day: 20, month: "JAN", code: "RETR", description: "Transport en commun mensuel", retrait: 95.0 },
    ],
  },
];

function netEffect(row: TxnSpec): number {
  return (row.depot ?? 0) - (row.retrait ?? 0) - (row.frais ?? 0);
}

function drawHeader(page: PDFPage, boldFont: PDFFont, y: number): void {
  page.drawText("Date", { x: DATE_X, y, size: HEADER_SIZE, font: boldFont });
  const codeX = DATE_X + boldFont.widthOfTextAtSize("Date", HEADER_SIZE) + DATE_CODE_GAP + 20;
  page.drawText("Code", { x: codeX, y, size: HEADER_SIZE, font: boldFont });
  page.drawText("Description", { x: DESCRIPTION_X, y, size: HEADER_SIZE, font: boldFont });
  for (const [text, edge] of Object.entries(MONEY_RIGHT_EDGES) as [string, number][]) {
    const label = { frais: "Frais", retrait: "Retrait", depot: "Dépôt", solde: "Solde" }[text] ?? text;
    const x = edge - boldFont.widthOfTextAtSize(label, HEADER_SIZE);
    page.drawText(label, { x, y, size: HEADER_SIZE, font: boldFont });
  }
}

function drawMoneyCell(page: PDFPage, font: PDFFont, y: number, edge: number, text: string | undefined): void {
  if (text === undefined) return;
  const x = edge - font.widthOfTextAtSize(text, BODY_SIZE);
  page.drawText(text, { x, y, size: BODY_SIZE, font });
}

interface PageCursor {
  page: PDFPage;
  y: number;
}

function ensureSpace(doc: PDFDocument, boldFont: PDFFont, cursor: PageCursor, needed: number): void {
  if (cursor.y >= MARGIN + needed) return;
  cursor.page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  cursor.y = PAGE_HEIGHT - MARGIN;
  drawHeader(cursor.page, boldFont, cursor.y);
  cursor.y -= ROW_PITCH;
}

function drawOpening(bodyFont: PDFFont, cursor: PageCursor, solde: number): void {
  cursor.page.drawText("Solde reporté", { x: DESCRIPTION_X, y: cursor.y, size: BODY_SIZE, font: bodyFont });
  drawMoneyCell(cursor.page, bodyFont, cursor.y, MONEY_RIGHT_EDGES.solde, formatMoney(solde));
  cursor.y -= ROW_PITCH;
}

function drawTransaction(bodyFont: PDFFont, cursor: PageCursor, row: TxnSpec, running: number): void {
  const dateText = `${row.day} ${row.month}`;
  const chunks = wrapDescription(row.description, bodyFont, DESCRIPTION_MAX_WIDTH);

  for (const [index, chunk] of chunks.entries()) {
    if (index === 0) {
      cursor.page.drawText(dateText, { x: DATE_X, y: cursor.y, size: BODY_SIZE, font: bodyFont });
      const codeX = DATE_X + bodyFont.widthOfTextAtSize(dateText, BODY_SIZE) + DATE_CODE_GAP;
      cursor.page.drawText(row.code, { x: codeX, y: cursor.y, size: BODY_SIZE, font: bodyFont });
      drawMoneyCell(
        cursor.page,
        bodyFont,
        cursor.y,
        MONEY_RIGHT_EDGES.frais,
        row.frais === undefined ? undefined : formatMoney(row.frais),
      );
      drawMoneyCell(
        cursor.page,
        bodyFont,
        cursor.y,
        MONEY_RIGHT_EDGES.retrait,
        row.retrait === undefined ? undefined : formatMoney(row.retrait),
      );
      drawMoneyCell(
        cursor.page,
        bodyFont,
        cursor.y,
        MONEY_RIGHT_EDGES.depot,
        row.depot === undefined ? undefined : formatMoney(row.depot),
      );
      drawMoneyCell(cursor.page, bodyFont, cursor.y, MONEY_RIGHT_EDGES.solde, formatMoney(running));
    }
    cursor.page.drawText(chunk, { x: DESCRIPTION_X, y: cursor.y, size: BODY_SIZE, font: bodyFont });
    cursor.y -= ROW_PITCH;
  }
}

export async function generateDesjardinsStatementPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const bodyFont = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  const cursor: PageCursor = { page: doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]), y: PAGE_HEIGHT - MARGIN };

  cursor.page.drawText("SYNTHETIC DESJARDINS STATEMENT — FIXTURE ONLY", {
    x: MARGIN,
    y: cursor.y,
    size: TITLE_SIZE,
    font: boldFont,
  });
  cursor.y -= ROW_PITCH * 1.5;
  cursor.page.drawText("Pour la période du 1er janvier au 31 janvier 2026", {
    x: MARGIN,
    y: cursor.y,
    size: BODY_SIZE,
    font: bodyFont,
  });
  cursor.y -= ROW_PITCH;
  cursor.page.drawText("Compte SJ 815-92746-3 du titulaire — FICTIF", {
    x: MARGIN,
    y: cursor.y,
    size: BODY_SIZE,
    font: bodyFont,
  });
  cursor.y -= ROW_PITCH * 1.5;

  for (const product of PRODUCTS) {
    ensureSpace(doc, boldFont, cursor, ROW_PITCH * 4);
    cursor.page.drawText(`${product.code} ${product.label}`, {
      x: MARGIN,
      y: cursor.y,
      size: BODY_SIZE,
      font: boldFont,
    });
    cursor.y -= ROW_PITCH;

    drawHeader(cursor.page, boldFont, cursor.y);
    cursor.y -= ROW_PITCH;

    let running = product.opening;
    drawOpening(bodyFont, cursor, running);

    for (const row of product.rows) {
      ensureSpace(doc, boldFont, cursor, ROW_PITCH * 3);
      running += netEffect(row);
      drawTransaction(bodyFont, cursor, row, running);
    }
    cursor.y -= ROW_PITCH * 0.5;
  }

  return doc.save();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outputPath = process.argv[2] ?? "/tmp/wf-synthetic-desjardins-statement.pdf";
  const bytes = await generateDesjardinsStatementPdf();
  writeFileSync(outputPath, bytes);
  // eslint-disable-next-line no-console
  console.log(`Wrote ${bytes.length} bytes to ${outputPath}`);
}
