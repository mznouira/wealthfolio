import { describe, expect, test } from "vitest";

import { extractPageLines, type PageLine } from "../src/pdf/index.ts";
import { generateSyntheticStatementPdf } from "./fixtures/pdf/generate.ts";

const TIMEOUT = 30_000;

function expectLine(actual: PageLine, expected: PageLine): void {
  expect(actual.page).toBe(expected.page);
  expect(actual.y).toBeCloseTo(expected.y, 2);
  expect(actual.cells).toHaveLength(expected.cells.length);
  for (let i = 0; i < expected.cells.length; i++) {
    const actualCell = actual.cells[i];
    const expectedCell = expected.cells[i];
    expect(actualCell).toBeDefined();
    expect(expectedCell).toBeDefined();
    if (actualCell !== undefined && expectedCell !== undefined) {
      expect(actualCell.x).toBeCloseTo(expectedCell.x, 2);
      expect(actualCell.text).toBe(expectedCell.text);
    }
  }
}

const EXPECTED: PageLine[] = [
  { page: 1, y: 752, cells: [{ x: 40, text: "SYNTHETIC BANK STATEMENT — FIXTURE ONLY" }] },
  { page: 1, y: 738, cells: [{ x: 40, text: "Account: SYNTH-0001" }] },
  {
    page: 1,
    y: 724,
    cells: [
      { x: 40, text: "Date" },
      { x: 90, text: "Code" },
      { x: 130, text: "Description" },
      { x: 330.88, text: "Frais" },
      { x: 394.664, text: "Retrait" },
      { x: 467.336, text: "Dépôt" },
      { x: 543.216, text: "Solde" },
    ],
  },
  {
    page: 1,
    y: 710,
    cells: [
      { x: 130, text: "SOLDE REPORTÉ" },
      { x: 533.864, text: "1 000,00" },
    ],
  },
  {
    page: 1,
    y: 696,
    cells: [
      { x: 40, text: "2025-01-02" },
      { x: 90, text: "RETR" },
      { x: 130, text: "Retrait guichet automatique" },
      { x: 399.984, text: "45,67" },
    ],
  },
  {
    page: 1,
    y: 682,
    cells: [
      { x: 40, text: "2025-01-03" },
      { x: 90, text: "DEP" },
      { x: 130, text: "Dépôt direct paie employeur" },
      { x: 458.864, text: "1 234,56" },
    ],
  },
  {
    page: 1,
    y: 668,
    cells: [
      { x: 40, text: "2025-01-04" },
      { x: 90, text: "FRAIS" },
      { x: 130, text: "Frais de service mensuel" },
      { x: 329.984, text: "12,50" },
    ],
  },
  {
    page: 1,
    y: 654,
    cells: [
      { x: 40, text: "2025-01-05" },
      { x: 90, text: "RETR" },
      { x: 130, text: "Paiement par carte - épicerie" },
      { x: 399.984, text: "89,12" },
    ],
  },
  {
    page: 1,
    y: 640,
    cells: [
      { x: 40, text: "2025-01-06" },
      { x: 90, text: "DEP" },
      { x: 130, text: "Virement reçu" },
      { x: 465.536, text: "500,00" },
    ],
  },
  {
    page: 1,
    y: 626,
    cells: [
      { x: 40, text: "2025-01-07" },
      { x: 90, text: "RETR" },
      { x: 130, text: "Paiement facture téléphone internet télévision" },
      { x: 388.864, text: "1 234,56" },
    ],
  },
  { page: 1, y: 612, cells: [{ x: 130, text: "câblé très long détail" }] },
  {
    page: 1,
    y: 598,
    cells: [
      { x: 40, text: "2025-01-08" },
      { x: 90, text: "FRAIS" },
      { x: 130, text: "Frais de transaction" },
      { x: 334.432, text: "1,25" },
      { x: 399.984, text: "25,00" },
    ],
  },
  {
    page: 1,
    y: 584,
    cells: [
      { x: 40, text: "2025-01-09" },
      { x: 90, text: "RETR" },
      { x: 130, text: "Achat station-service" },
      { x: 399.984, text: "56,78" },
    ],
  },
  {
    page: 1,
    y: 570,
    cells: [
      { x: 40, text: "2025-01-10" },
      { x: 90, text: "DEP" },
      { x: 130, text: "Remboursement ami" },
      { x: 469.984, text: "75,00" },
    ],
  },
  {
    page: 1,
    y: 556,
    cells: [
      { x: 40, text: "2025-01-11" },
      { x: 90, text: "RETR" },
      { x: 130, text: "Restaurant centre-ville" },
      { x: 399.984, text: "34,90" },
    ],
  },
  {
    page: 1,
    y: 542,
    cells: [
      { x: 40, text: "2025-01-12" },
      { x: 90, text: "RETR" },
      { x: 130, text: "Pharmacie paiement médicaments ordonnance" },
      { x: 399.984, text: "23,45" },
    ],
  },
  {
    page: 1,
    y: 528,
    cells: [
      { x: 40, text: "2025-01-13" },
      { x: 90, text: "DEP" },
      { x: 130, text: "Dépôt chèque client" },
      { x: 465.536, text: "890,00" },
    ],
  },
  {
    page: 1,
    y: 514,
    cells: [
      { x: 40, text: "2025-01-14" },
      { x: 90, text: "FRAIS" },
      { x: 130, text: "Frais de découvert" },
      { x: 334.432, text: "5,00" },
    ],
  },
  {
    page: 1,
    y: 500,
    cells: [
      { x: 40, text: "2025-01-15" },
      { x: 90, text: "RETR" },
      { x: 130, text: "Paiement par carte - grand magasin général du" },
      { x: 395.536, text: "156,34" },
    ],
  },
  { page: 1, y: 486, cells: [{ x: 130, text: "centre commercial" }] },
  {
    page: 1,
    y: 472,
    cells: [
      { x: 40, text: "2025-01-16" },
      { x: 90, text: "DEP" },
      { x: 130, text: "Virement entre comptes" },
      { x: 465.536, text: "300,00" },
    ],
  },
  {
    page: 1,
    y: 458,
    cells: [
      { x: 40, text: "2025-01-17" },
      { x: 90, text: "RETR" },
      { x: 130, text: "Café et pâtisserie locale" },
      { x: 404.432, text: "8,75" },
    ],
  },
  {
    page: 1,
    y: 444,
    cells: [
      { x: 40, text: "2025-01-18" },
      { x: 90, text: "RETR" },
      { x: 130, text: "Achat en ligne marchand virtuel avec description" },
      { x: 399.984, text: "67,89" },
    ],
  },
  { page: 1, y: 430, cells: [{ x: 130, text: "longue qui déborde sur la ligne suivante" }] },
  {
    page: 1,
    y: 416,
    cells: [
      { x: 40, text: "2025-01-19" },
      { x: 90, text: "DEP" },
      { x: 130, text: "Remboursement assurance habitation" },
      { x: 465.536, text: "250,00" },
    ],
  },
  {
    page: 1,
    y: 402,
    cells: [
      { x: 40, text: "2025-01-20" },
      { x: 90, text: "FRAIS" },
      { x: 130, text: "Frais virement international" },
      { x: 329.984, text: "15,00" },
      { x: 395.536, text: "100,00" },
    ],
  },
  {
    page: 1,
    y: 388,
    cells: [
      { x: 40, text: "2025-01-21" },
      { x: 90, text: "RETR" },
      { x: 130, text: "Retrait guichet secondaire" },
      { x: 399.984, text: "60,00" },
    ],
  },
  {
    page: 1,
    y: 374,
    cells: [
      { x: 40, text: "2025-01-22" },
      { x: 90, text: "DEP" },
      { x: 130, text: "Dépôt espèces succursale" },
      { x: 465.536, text: "150,00" },
    ],
  },
  {
    page: 1,
    y: 360,
    cells: [
      { x: 40, text: "2025-01-23" },
      { x: 90, text: "RETR" },
      { x: 130, text: "Transport en commun mensuel" },
      { x: 399.984, text: "95,00" },
    ],
  },
  {
    page: 1,
    y: 346,
    cells: [
      { x: 40, text: "2025-01-24" },
      { x: 90, text: "RETR" },
      { x: 130, text: "Librairie achat livres et fournures scolaires" },
      { x: 399.984, text: "42,15" },
    ],
  },
  {
    page: 1,
    y: 332,
    cells: [
      { x: 40, text: "2025-01-25" },
      { x: 90, text: "DEP" },
      { x: 130, text: "Paiement reçu service consultation" },
      { x: 465.536, text: "600,00" },
    ],
  },
  {
    page: 1,
    y: 318,
    cells: [
      { x: 40, text: "2025-01-26" },
      { x: 90, text: "FRAIS" },
      { x: 130, text: "Frais de compte premium" },
      { x: 334.432, text: "9,95" },
    ],
  },
  {
    page: 1,
    y: 304,
    cells: [
      { x: 40, text: "2025-01-27" },
      { x: 90, text: "RETR" },
      { x: 130, text: "Supermarché courses hebdomadaires viande" },
      { x: 395.536, text: "187,43" },
    ],
  },
  { page: 1, y: 290, cells: [{ x: 130, text: "légumes produits laitiers" }] },
  {
    page: 1,
    y: 276,
    cells: [
      { x: 40, text: "2025-01-28" },
      { x: 90, text: "DEP" },
      { x: 130, text: "Intérêts crédités" },
      { x: 474.432, text: "2,50" },
    ],
  },
  {
    page: 1,
    y: 262,
    cells: [
      { x: 40, text: "2025-01-29" },
      { x: 90, text: "RETR" },
      { x: 130, text: "Paiement carte crédit partiel" },
      { x: 395.536, text: "500,00" },
    ],
  },
  {
    page: 1,
    y: 248,
    cells: [
      { x: 40, text: "2025-01-30" },
      { x: 90, text: "RETR" },
      { x: 130, text: "Salle de sport abonnement annuel renouvelé" },
      { x: 395.536, text: "350,00" },
    ],
  },
  { page: 1, y: 234, cells: [{ x: 130, text: "automatiquement par prélèvement" }] },
  {
    page: 1,
    y: 220,
    cells: [
      { x: 40, text: "2025-01-31" },
      { x: 90, text: "DEP" },
      { x: 130, text: "Dernier dépôt du mois" },
      { x: 469.984, text: "75,25" },
    ],
  },
  {
    page: 1,
    y: 206,
    cells: [
      { x: 40, text: "2025-02-01" },
      { x: 90, text: "RETR" },
      { x: 130, text: "Cinéma et divertissement" },
      { x: 399.984, text: "32,50" },
    ],
  },
  {
    page: 1,
    y: 192,
    cells: [
      { x: 40, text: "2025-02-02" },
      { x: 90, text: "DEP" },
      { x: 130, text: "Remboursement collègue" },
      { x: 469.984, text: "40,00" },
    ],
  },
  {
    page: 1,
    y: 178,
    cells: [
      { x: 40, text: "2025-02-03" },
      { x: 90, text: "RETR" },
      { x: 130, text: "Épicerie spécialité fine" },
      { x: 399.984, text: "76,89" },
    ],
  },
  {
    page: 1,
    y: 164,
    cells: [
      { x: 40, text: "2025-02-04" },
      { x: 90, text: "FRAIS" },
      { x: 130, text: "Frais retrait hors réseau" },
      { x: 334.432, text: "3,50" },
    ],
  },
  {
    page: 1,
    y: 150,
    cells: [
      { x: 40, text: "2025-02-05" },
      { x: 90, text: "RETR" },
      { x: 130, text: "Stationnement centre-ville" },
      { x: 399.984, text: "18,00" },
    ],
  },
  {
    page: 1,
    y: 136,
    cells: [
      { x: 40, text: "2025-02-06" },
      { x: 90, text: "DEP" },
      { x: 130, text: "Dépôt chèque cadeau" },
      { x: 465.536, text: "120,00" },
    ],
  },
  {
    page: 1,
    y: 122,
    cells: [
      { x: 40, text: "2025-02-07" },
      { x: 90, text: "RETR" },
      { x: 130, text: "Réparation automobile garage du coin" },
      { x: 395.536, text: "245,00" },
    ],
  },
  {
    page: 1,
    y: 108,
    cells: [
      { x: 40, text: "2025-02-08" },
      { x: 90, text: "RETR" },
      { x: 130, text: "Achat pharmacie et cosmétiques" },
      { x: 399.984, text: "54,30" },
    ],
  },
  {
    page: 2,
    y: 752,
    cells: [
      { x: 40, text: "Date" },
      { x: 90, text: "Code" },
      { x: 130, text: "Description" },
      { x: 330.88, text: "Frais" },
      { x: 394.664, text: "Retrait" },
      { x: 467.336, text: "Dépôt" },
      { x: 543.216, text: "Solde" },
    ],
  },
  {
    page: 2,
    y: 738,
    cells: [
      { x: 40, text: "2025-02-09" },
      { x: 90, text: "DEP" },
      { x: 130, text: "Virement retour prêt" },
      { x: 465.536, text: "180,00" },
    ],
  },
  {
    page: 2,
    y: 724,
    cells: [
      { x: 40, text: "2025-02-10" },
      { x: 90, text: "FRAIS" },
      { x: 130, text: "Frais carte débit premium" },
      { x: 334.432, text: "4,25" },
      { x: 399.984, text: "50,00" },
    ],
  },
  {
    page: 2,
    y: 710,
    cells: [
      { x: 40, text: "2025-02-11" },
      { x: 90, text: "RETR" },
      { x: 130, text: "Restaurant avec collègues du bureau après une" },
      { x: 399.984, text: "68,50" },
    ],
  },
  { page: 2, y: 696, cells: [{ x: 130, text: "longue journée" }] },
  {
    page: 2,
    y: 682,
    cells: [
      { x: 40, text: "2025-02-12" },
      { x: 90, text: "DEP" },
      { x: 130, text: "Dépôt intérêts compte épargne" },
      { x: 469.984, text: "12,75" },
    ],
  },
  {
    page: 2,
    y: 668,
    cells: [
      { x: 130, text: "SOLDE FINAL" },
      { x: 533.864, text: "2 474,51" },
    ],
  },
];

describe("extractPageLines golden", () => {
  test(
    "reconstructs the synthetic statement geometry",
    async () => {
      const bytes = await generateSyntheticStatementPdf();
      const lines = await extractPageLines(bytes);

      expect(lines).toHaveLength(EXPECTED.length);
      for (let i = 0; i < EXPECTED.length; i++) {
        const actual = lines[i];
        const expected = EXPECTED[i];
        expect(actual).toBeDefined();
        expect(expected).toBeDefined();
        if (actual !== undefined && expected !== undefined) {
          expectLine(actual, expected);
        }
      }

      // (a) Right-alignment invariant in the Retrait column.
      const retraitCells = lines
        .flatMap((line) => line.cells)
        .filter((cell) => cell.x > 350 && cell.x < 420)
        .filter((cell) => cell.text === "8,75" || cell.text === "1 234,56");
      expect(retraitCells).toHaveLength(2);
      const [shortAmount, longAmount] = retraitCells.sort((a, b) => a.text.length - b.text.length);
      expect(shortAmount).toBeDefined();
      expect(longAmount).toBeDefined();
      expect(longAmount!.x).toBeLessThan(shortAmount!.x);
      expect(longAmount!.x).toBeGreaterThan(350);
      expect(shortAmount!.x).toBeLessThan(420);

      // (b) Header row has exactly the seven expected cells.
      const header = lines.find(
        (line) =>
          line.cells.map((cell) => cell.text).join("|") ===
          "Date|Code|Description|Frais|Retrait|Dépôt|Solde",
      );
      expect(header).toBeDefined();
      expect(header?.cells).toHaveLength(7);

      // (c) A wrapped description produces a continuation line with fewer cells.
      const hasWrappedContinuation = lines.some((line, index) => {
        const next = lines[index + 1];
        if (next === undefined) return false;
        return (
          line.cells.length > 1 &&
          next.cells.length === 1 &&
          next.cells[0]?.x === 130 &&
          line.cells.some((cell) => cell.x === 130)
        );
      });
      expect(hasWrappedContinuation).toBe(true);

      // (d) Page 1 precedes page 2 and y descends within each page.
      const page1Lines = lines.filter((line) => line.page === 1);
      const page2Lines = lines.filter((line) => line.page === 2);
      expect(page1Lines.every((line) => line.page === 1)).toBe(true);
      expect(page2Lines.every((line) => line.page === 2)).toBe(true);
      expect(lines[lines.length - 1]?.page).toBeGreaterThanOrEqual(lines[0]?.page ?? 0);
      for (const pageLines of [page1Lines, page2Lines]) {
        for (let i = 1; i < pageLines.length; i++) {
          expect(pageLines[i]?.y).toBeLessThan(pageLines[i - 1]?.y ?? Infinity);
        }
      }
    },
    TIMEOUT,
  );
});
