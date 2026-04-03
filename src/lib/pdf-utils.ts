import type { PDFDocumentProxy } from "pdfjs-dist";

let pdfjsLib: typeof import("pdfjs-dist") | null = null;

async function getPdfjs() {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import("pdfjs-dist");

  // Use CDN worker for reliability (local worker paths break under Turbopack)
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.worker.min.mjs";

  return pdfjsLib;
}

export async function loadPdfDocument(data: ArrayBuffer) {
  const pdfjs = await getPdfjs();
  const loadingTask = pdfjs.getDocument({ data });
  return await loadingTask.promise;
}

export async function renderPageToCanvas(
  pdfDoc: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  scale: number = 1.5
) {
  const page = await pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  canvas.height = viewport.height;
  canvas.width = viewport.width;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to get 2D rendering context from canvas. The browser may not support canvas rendering.");
  }
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

export async function getPageAsImageData(
  pdfDoc: PDFDocumentProxy,
  pageNumber: number,
  scale: number = 2
): Promise<string> {
  const page = await pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.height = viewport.height;
  canvas.width = viewport.width;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to get 2D rendering context from off-screen canvas. The browser may not support canvas rendering.");
  }
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL("image/png");
}
