import { PDFDocument, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 40;

const BODY_SIZE = 8;
const HEADER_SIZE = 8;
const TITLE_SIZE = 12;
const ROW_PITCH = 14;

const DATE_X = 40;
const CODE_X = 90;
const DESCRIPTION_X = 130;
const DESCRIPTION_MAX_WIDTH = 180;

const MONEY_RIGHT_EDGES = {
  frais: 350,
  retrait: 420,
  depot: 490,
  solde: 565,
} as const;

interface RowSpec {
  readonly date?: string;
  readonly code?: string;
  readonly description: string;
  readonly frais?: string;
  readonly retrait?: string;
  readonly depot?: string;
  readonly solde?: string;
}

function formatMoney(value: number): string {
  const parts = value.toFixed(2).split(".");
  const whole = parts[0] ?? "0";
  const fraction = parts[1] ?? "00";
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/gu, " ");
  return `${grouped},${fraction}`;
}

function wrapDescription(text: string, font: PDFFont, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current === "" ? word : `${current} ${word}`;
    const width = font.widthOfTextAtSize(candidate, BODY_SIZE);
    if (width <= maxWidth) {
      current = candidate;
    } else {
      if (current !== "") {
        lines.push(current);
      }
      current = word;
    }
  }

  if (current !== "") {
    lines.push(current);
  }

  return lines.length === 0 ? [""] : lines;
}

function drawRow(
  page: PDFPage,
  bodyFont: PDFFont,
  y: number,
  row: RowSpec,
): number {
  const descChunks = wrapDescription(row.description, bodyFont, DESCRIPTION_MAX_WIDTH);
  let currentY = y;

  for (let index = 0; index < descChunks.length; index++) {
    const chunk = descChunks[index] ?? "";
    const isFirst = index === 0;

    if (isFirst) {
      if (row.date !== undefined) {
        page.drawText(row.date, { x: DATE_X, y: currentY, size: BODY_SIZE, font: bodyFont });
      }
      if (row.code !== undefined) {
        page.drawText(row.code, { x: CODE_X, y: currentY, size: BODY_SIZE, font: bodyFont });
      }
      if (row.frais !== undefined) {
        const text = row.frais;
        const x = MONEY_RIGHT_EDGES.frais - bodyFont.widthOfTextAtSize(text, BODY_SIZE);
        page.drawText(text, { x, y: currentY, size: BODY_SIZE, font: bodyFont });
      }
      if (row.retrait !== undefined) {
        const text = row.retrait;
        const x = MONEY_RIGHT_EDGES.retrait - bodyFont.widthOfTextAtSize(text, BODY_SIZE);
        page.drawText(text, { x, y: currentY, size: BODY_SIZE, font: bodyFont });
      }
      if (row.depot !== undefined) {
        const text = row.depot;
        const x = MONEY_RIGHT_EDGES.depot - bodyFont.widthOfTextAtSize(text, BODY_SIZE);
        page.drawText(text, { x, y: currentY, size: BODY_SIZE, font: bodyFont });
      }
      if (row.solde !== undefined) {
        const text = row.solde;
        const x = MONEY_RIGHT_EDGES.solde - bodyFont.widthOfTextAtSize(text, BODY_SIZE);
        page.drawText(text, { x, y: currentY, size: BODY_SIZE, font: bodyFont });
      }
    }

    page.drawText(chunk, {
      x: DESCRIPTION_X,
      y: currentY,
      size: BODY_SIZE,
      font: bodyFont,
    });

    currentY -= ROW_PITCH;
  }

  return currentY;
}

function drawHeader(page: PDFPage, boldFont: PDFFont, y: number): void {
  page.drawText("Date", { x: DATE_X, y, size: HEADER_SIZE, font: boldFont });
  page.drawText("Code", { x: CODE_X, y, size: HEADER_SIZE, font: boldFont });
  page.drawText("Description", { x: DESCRIPTION_X, y, size: HEADER_SIZE, font: boldFont });

  const moneyHeaders: { text: string; edge: number }[] = [
    { text: "Frais", edge: MONEY_RIGHT_EDGES.frais },
    { text: "Retrait", edge: MONEY_RIGHT_EDGES.retrait },
    { text: "Dépôt", edge: MONEY_RIGHT_EDGES.depot },
    { text: "Solde", edge: MONEY_RIGHT_EDGES.solde },
  ];

  for (const { text, edge } of moneyHeaders) {
    const x = edge - boldFont.widthOfTextAtSize(text, HEADER_SIZE);
    page.drawText(text, { x, y, size: HEADER_SIZE, font: boldFont });
  }
}

const ROWS: RowSpec[] = [
  { description: "SOLDE REPORTÉ", solde: formatMoney(1000.0) },
  { date: "2025-01-02", code: "RETR", description: "Retrait guichet automatique", retrait: formatMoney(45.67) },
  { date: "2025-01-03", code: "DEP", description: "Dépôt direct paie employeur", depot: formatMoney(1234.56) },
  { date: "2025-01-04", code: "FRAIS", description: "Frais de service mensuel", frais: formatMoney(12.5) },
  { date: "2025-01-05", code: "RETR", description: "Paiement par carte - épicerie", retrait: formatMoney(89.12) },
  { date: "2025-01-06", code: "DEP", description: "Virement reçu", depot: formatMoney(500.0) },
  { date: "2025-01-07", code: "RETR", description: "Paiement facture téléphone internet télévision câblé très long détail", retrait: formatMoney(1234.56) },
  { date: "2025-01-08", code: "FRAIS", description: "Frais de transaction", frais: formatMoney(1.25), retrait: formatMoney(25.0) },
  { date: "2025-01-09", code: "RETR", description: "Achat station-service", retrait: formatMoney(56.78) },
  { date: "2025-01-10", code: "DEP", description: "Remboursement ami", depot: formatMoney(75.0) },
  { date: "2025-01-11", code: "RETR", description: "Restaurant centre-ville", retrait: formatMoney(34.9) },
  { date: "2025-01-12", code: "RETR", description: "Pharmacie paiement médicaments ordonnance", retrait: formatMoney(23.45) },
  { date: "2025-01-13", code: "DEP", description: "Dépôt chèque client", depot: formatMoney(890.0) },
  { date: "2025-01-14", code: "FRAIS", description: "Frais de découvert", frais: formatMoney(5.0) },
  { date: "2025-01-15", code: "RETR", description: "Paiement par carte - grand magasin général du centre commercial", retrait: formatMoney(156.34) },
  { date: "2025-01-16", code: "DEP", description: "Virement entre comptes", depot: formatMoney(300.0) },
  { date: "2025-01-17", code: "RETR", description: "Café et pâtisserie locale", retrait: formatMoney(8.75) },
  { date: "2025-01-18", code: "RETR", description: "Achat en ligne marchand virtuel avec description longue qui déborde sur la ligne suivante", retrait: formatMoney(67.89) },
  { date: "2025-01-19", code: "DEP", description: "Remboursement assurance habitation", depot: formatMoney(250.0) },
  { date: "2025-01-20", code: "FRAIS", description: "Frais virement international", frais: formatMoney(15.0), retrait: formatMoney(100.0) },
  { date: "2025-01-21", code: "RETR", description: "Retrait guichet secondaire", retrait: formatMoney(60.0) },
  { date: "2025-01-22", code: "DEP", description: "Dépôt espèces succursale", depot: formatMoney(150.0) },
  { date: "2025-01-23", code: "RETR", description: "Transport en commun mensuel", retrait: formatMoney(95.0) },
  { date: "2025-01-24", code: "RETR", description: "Librairie achat livres et fournures scolaires", retrait: formatMoney(42.15) },
  { date: "2025-01-25", code: "DEP", description: "Paiement reçu service consultation", depot: formatMoney(600.0) },
  { date: "2025-01-26", code: "FRAIS", description: "Frais de compte premium", frais: formatMoney(9.95) },
  { date: "2025-01-27", code: "RETR", description: "Supermarché courses hebdomadaires viande légumes produits laitiers", retrait: formatMoney(187.43) },
  { date: "2025-01-28", code: "DEP", description: "Intérêts crédités", depot: formatMoney(2.5) },
  { date: "2025-01-29", code: "RETR", description: "Paiement carte crédit partiel", retrait: formatMoney(500.0) },
  { date: "2025-01-30", code: "RETR", description: "Salle de sport abonnement annuel renouvelé automatiquement par prélèvement", retrait: formatMoney(350.0) },
  { date: "2025-01-31", code: "DEP", description: "Dernier dépôt du mois", depot: formatMoney(75.25) },
  { date: "2025-02-01", code: "RETR", description: "Cinéma et divertissement", retrait: formatMoney(32.5) },
  { date: "2025-02-02", code: "DEP", description: "Remboursement collègue", depot: formatMoney(40.0) },
  { date: "2025-02-03", code: "RETR", description: "Épicerie spécialité fine", retrait: formatMoney(76.89) },
  { date: "2025-02-04", code: "FRAIS", description: "Frais retrait hors réseau", frais: formatMoney(3.5) },
  { date: "2025-02-05", code: "RETR", description: "Stationnement centre-ville", retrait: formatMoney(18.0) },
  { date: "2025-02-06", code: "DEP", description: "Dépôt chèque cadeau", depot: formatMoney(120.0) },
  { date: "2025-02-07", code: "RETR", description: "Réparation automobile garage du coin", retrait: formatMoney(245.0) },
  { date: "2025-02-08", code: "RETR", description: "Achat pharmacie et cosmétiques", retrait: formatMoney(54.3) },
  { date: "2025-02-09", code: "DEP", description: "Virement retour prêt", depot: formatMoney(180.0) },
  { date: "2025-02-10", code: "FRAIS", description: "Frais carte débit premium", frais: formatMoney(4.25), retrait: formatMoney(50.0) },
  { date: "2025-02-11", code: "RETR", description: "Restaurant avec collègues du bureau après une longue journée", retrait: formatMoney(68.5) },
  { date: "2025-02-12", code: "DEP", description: "Dépôt intérêts compte épargne", depot: formatMoney(12.75) },
  { description: "SOLDE FINAL", solde: formatMoney(2474.51) },
];

export async function generateSyntheticStatementPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const bodyFont = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  page.drawText("SYNTHETIC BANK STATEMENT — FIXTURE ONLY", {
    x: MARGIN,
    y,
    size: TITLE_SIZE,
    font: boldFont,
  });
  y -= ROW_PITCH;

  page.drawText("Account: SYNTH-0001", {
    x: MARGIN,
    y,
    size: BODY_SIZE,
    font: bodyFont,
  });
  y -= ROW_PITCH;

  drawHeader(page, boldFont, y);
  y -= ROW_PITCH;

  for (const row of ROWS) {
    if (y < MARGIN + ROW_PITCH * 4) {
      page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
      drawHeader(page, boldFont, y);
      y -= ROW_PITCH;
    }

    y = drawRow(page, bodyFont, y, row);
  }

  return doc.save();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outputPath = process.argv[2] ?? "/tmp/wf-synthetic-statement.pdf";
  const bytes = await generateSyntheticStatementPdf();
  writeFileSync(outputPath, bytes);
  // eslint-disable-next-line no-console
  console.log(`Wrote ${bytes.length} bytes to ${outputPath}`);
}
