export type PdfWorkerMode = "worker-port" | "main-thread" | "not-configured";

let currentMode: PdfWorkerMode = "not-configured";

export function setPdfWorkerMode(mode: PdfWorkerMode): void {
  currentMode = mode;
}

export function pdfWorkerMode(): PdfWorkerMode {
  return currentMode;
}
