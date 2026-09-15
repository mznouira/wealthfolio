import { describe, expect, test } from "vitest";

import { DesjardinsPdfSource, parseDesjardinsPdfLines } from "../src/desjardins-pdf.ts";
import { extractPageLines } from "../src/pdf/index.ts";
import { calendarDate } from "../src/types.ts";
import { generateDesjardinsStatementPdf } from "./fixtures/pdf/generate-desjardins.ts";

const TIMEOUT = 30_000;

/**
 * End-to-end: real pdf-lib bytes -> real pdfjs text extraction -> `buildPageLines`
 * -> `parseDesjardinsPdfLines`. Unlike `pdf-golden.test.ts` (WP-2), this doesn't pin
 * a raw `PageLine[]` literal — the interesting claim here is semantic (the full
 * grammar parses and reconciles through the real pipeline), which the WP-2 golden
 * test's geometry literal already covers for the extraction layer itself.
 */
describe("parseDesjardinsPdfLines, real pdfjs pipeline", () => {
  test(
    "a 2-product, multi-page, wrapped-description statement parses with no problems",
    async () => {
      const bytes = await generateDesjardinsStatementPdf();
      const lines = await extractPageLines(bytes);

      // Sanity: the fixture actually spans more than one page (it forces a break).
      expect(lines.some((line) => line.page === 2)).toBe(true);

      const batch = parseDesjardinsPdfLines(lines, "synthetic-desjardins.pdf", "CAD");

      expect(batch.problems).toEqual([]);
      expect(batch.transactions).toHaveLength(19);

      const eopRefs = new Set(
        batch.transactions.filter((t) => t.accountRef?.endsWith("-EOP")).map((t) => t.accountRef),
      );
      const esRefs = new Set(
        batch.transactions.filter((t) => t.accountRef?.endsWith("-ES")).map((t) => t.accountRef),
      );
      expect(eopRefs.size).toBe(1);
      expect(esRefs.size).toBe(1);
      expect([...eopRefs][0]).not.toBe([...esRefs][0]);

      const withdrawal = batch.transactions.find(
        (t) => t.description === "Retrait guichet automatique",
      );
      expect(withdrawal).toBeDefined();
      expect(withdrawal?.occurredOn).toBe(calendarDate("2026-01-02"));
      expect(withdrawal?.amount).toEqual({ minor: -4567, currency: "CAD" });

      // The wrapped description reassembles across the continuation line.
      const wrapped = batch.transactions.find((t) =>
        t.description.startsWith("Paiement facture téléphone"),
      );
      expect(wrapped?.description).toBe(
        "Paiement facture téléphone internet télévision câblé très long détail",
      );

      const savingsInterest = batch.transactions.find((t) => t.description === "Intérêt crédité");
      expect(savingsInterest?.accountRef?.endsWith("-ES")).toBe(true);
      expect(savingsInterest?.amount).toEqual({ minor: 250, currency: "CAD" });

      // Never a full account/folio number in any RawTransaction produced here.
      for (const txn of batch.transactions) {
        expect(txn.accountRef).not.toContain("92746");
      }
    },
    TIMEOUT,
  );

  test(
    "DesjardinsPdfSource wires bytes -> extractPageLines -> parseDesjardinsPdfLines end to end",
    async () => {
      const bytes = await generateDesjardinsStatementPdf();
      const batch = await new DesjardinsPdfSource({
        bytes,
        name: "/home/owner/statements/synthetic-desjardins.pdf",
        currency: "CAD",
      }).fetch();

      expect(batch.problems).toEqual([]);
      expect(batch.transactions).toHaveLength(19);
      // Only the basename is stored — a full path never reaches SourceLocation.
      for (const txn of batch.transactions) {
        expect(txn.at.file).toBe("synthetic-desjardins.pdf");
      }
    },
    TIMEOUT,
  );
});
