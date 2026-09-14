import { GlobalWorkerOptions } from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";

import { setPdfWorkerMode, type PdfWorkerMode } from "./worker-mode.ts";

let installPromise: Promise<PdfWorkerMode> | null = null;

export async function installPdfWorker(): Promise<PdfWorkerMode> {
  if (installPromise !== null) {
    return installPromise;
  }

  installPromise = (async (): Promise<PdfWorkerMode> => {
    try {
      GlobalWorkerOptions.workerPort = new PdfWorker();
      setPdfWorkerMode("worker-port");
      return "worker-port";
    } catch {
      // pdfjs-dist does not ship types for this worker entry, so the import is
      // intentionally untyped.
      // @ts-expect-error pdfjs-dist worker entry has no declaration file.
      const workerModule = await import("pdfjs-dist/build/pdf.worker.mjs");
      (globalThis as Record<string, unknown>).pdfjsWorker = workerModule;
      setPdfWorkerMode("main-thread");
      return "main-thread";
    }
  })();

  return installPromise;
}
