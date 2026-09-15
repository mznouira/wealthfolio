import { useState, type ReactElement } from "react";

import { parseDesjardinsPdfLines } from "@wealthfolio/statement-parsers/desjardins-pdf";
import { extractPageLines, pdfWorkerMode, type PageLine } from "@wealthfolio/statement-parsers/pdf";
import type { ImportBatch } from "@wealthfolio/statement-parsers";

// Default export required by React.lazy for the dev-only probe route.
export default function PdfWorkerProbePage(): ReactElement {
  const [fileName, setFileName] = useState<string>("");
  const [lines, setLines] = useState<PageLine[]>([]);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // WP-3: the manual real-PDF verification surface (MANUAL-TESTS.md). Currency is
  // hardcoded — this dev tool never writes anywhere, unlike the real WP-4 import
  // flow, which will ask the user.
  const [desjardinsBatch, setDesjardinsBatch] = useState<ImportBatch | null>(null);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setFileName(file.name);
    setError(null);
    setLines([]);
    setDurationMs(null);
    setDesjardinsBatch(null);

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const start = performance.now();
      const result = await extractPageLines(bytes);
      const end = performance.now();
      setLines(result);
      setDurationMs(Math.round(end - start));
      setDesjardinsBatch(parseDesjardinsPdfLines(result, file.name, "CAD"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const pageCount = lines.length > 0 ? Math.max(...lines.map((line) => line.page)) : 0;
  const previewLines = lines.slice(0, 25);
  const accountRefs =
    desjardinsBatch === null
      ? []
      : [...new Set(desjardinsBatch.transactions.map((txn) => txn.accountRef))];

  return (
    <div className="space-y-6 p-8 font-mono text-sm">
      <div className="space-y-2">
        <h1 className="text-lg font-semibold">PDF Worker Probe</h1>
        <div className="inline-flex items-center rounded bg-slate-100 px-2 py-1 dark:bg-slate-800">
          mode: {pdfWorkerMode()}
        </div>
      </div>

      <input
        type="file"
        accept="application/pdf"
        onChange={handleFileChange}
        className="block w-full max-w-md"
      />

      {fileName && (
        <div className="space-y-1">
          <div>file: {fileName}</div>
          <div>pages: {pageCount}</div>
          <div>lines: {lines.length}</div>
          {durationMs !== null && <div>duration: {durationMs}ms</div>}
        </div>
      )}

      {error && <div className="text-red-600">Error: {error}</div>}

      {desjardinsBatch && (
        <div className="space-y-2">
          <h2 className="font-semibold">Desjardins PDF parse (W3-D12)</h2>
          <div>transactions: {desjardinsBatch.transactions.length}</div>
          <div className="space-y-1">
            {accountRefs.map((ref) => {
              // accountRef is "<masked-ref>-<PRODUCT>"; a reconciliation_failed
              // message names the product as "product <PRODUCT>:" (desjardins-pdf.ts).
              const productCode = ref?.split("-").pop();
              const failed = desjardinsBatch.problems.some(
                (p) =>
                  p.code === "reconciliation_failed" &&
                  productCode !== undefined &&
                  p.message.includes(`product ${productCode}:`),
              );
              return (
                <div key={ref ?? "null"}>
                  account {ref ?? "(none)"}:{" "}
                  {failed ? (
                    <span className="text-red-600">reconcile FAILED</span>
                  ) : (
                    <span className="text-green-600">reconciled</span>
                  )}
                </div>
              );
            })}
          </div>
          {desjardinsBatch.problems.length > 0 && (
            <div className="space-y-1">
              <div className="font-semibold">problems ({desjardinsBatch.problems.length}):</div>
              {desjardinsBatch.problems.map((problem, index) => (
                <div key={index} className="text-red-600">
                  line {problem.at.line} · {problem.code} · {problem.message}
                </div>
              ))}
            </div>
          )}
          <table className="w-full max-w-4xl border-collapse">
            <thead>
              <tr className="border-b text-left">
                <th className="py-1 pr-4">account</th>
                <th className="py-1 pr-4">date</th>
                <th className="py-1 pr-4">amount</th>
                <th className="py-1">description</th>
              </tr>
            </thead>
            <tbody>
              {desjardinsBatch.transactions.map((txn, index) => (
                <tr key={index} className="border-b">
                  <td className="py-1 pr-4 align-top">{txn.accountRef}</td>
                  <td className="py-1 pr-4 align-top">{txn.occurredOn}</td>
                  <td className="py-1 pr-4 align-top">{(txn.amount.minor / 100).toFixed(2)}</td>
                  <td className="py-1 align-top">{txn.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {previewLines.length > 0 && (
        <table className="w-full max-w-4xl border-collapse">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1 pr-4">page</th>
              <th className="py-1 pr-4">y</th>
              <th className="py-1">cells</th>
            </tr>
          </thead>
          <tbody>
            {previewLines.map((line, index) => (
              <tr key={index} className="border-b">
                <td className="py-1 pr-4 align-top">{line.page}</td>
                <td className="py-1 pr-4 align-top">{line.y.toFixed(2)}</td>
                <td className="py-1 align-top">
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {line.cells.map((cell, cellIndex) => (
                      <span
                        key={cellIndex}
                        className="inline-block rounded bg-slate-50 px-1 dark:bg-slate-900"
                        title={`x=${cell.x.toFixed(2)}`}
                      >
                        x={cell.x.toFixed(2)} {cell.text}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
