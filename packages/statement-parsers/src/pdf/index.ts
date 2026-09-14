import { getDocument } from "pdfjs-dist";

import { buildPageLines, type PageCell, type PageLine, type TextItemLike } from "./lines.ts";
import { pdfWorkerMode, type PdfWorkerMode } from "./worker-mode.ts";

export type { PageCell, PageLine, PdfWorkerMode, TextItemLike };

export { pdfWorkerMode };

export async function extractPageLines(bytes: Uint8Array): Promise<PageLine[]> {
  // jsdom has window+document but no Worker; node-env vitest has none; only a real browser has all three.
  const isBrowser =
    typeof window !== "undefined" &&
    typeof document !== "undefined" &&
    typeof Worker !== "undefined";

  if (isBrowser) {
    const { installPdfWorker } = await import("./worker.ts");
    await installPdfWorker();
  }

  const data = bytes.slice();
  const loadingTask = getDocument({ data });

  try {
    const doc = await loadingTask.promise;
    const lines: PageLine[] = [];

    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);

      try {
        const content = await page.getTextContent();
        const items = content.items.filter((item) => "str" in item) as TextItemLike[];
        lines.push(...buildPageLines(pageNumber, items));
      } finally {
        page.cleanup();
      }
    }

    return lines;
  } finally {
    await loadingTask.destroy();
  }
}
