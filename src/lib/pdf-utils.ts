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
  scale: number = 1.5,
  signal?: AbortSignal
) {
  const page = await pdfDoc.getPage(pageNumber);
  if (signal?.aborted) return canvas;
  const viewport = page.getViewport({ scale });
  canvas.height = viewport.height;
  canvas.width = viewport.width;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to get 2D rendering context from canvas.");
  }
  const renderTask = page.render({ canvasContext: ctx, viewport });
  // Cancel render if the caller aborts
  if (signal) {
    signal.addEventListener("abort", () => renderTask.cancel(), { once: true });
  }
  try {
    await renderTask.promise;
  } catch (err) {
    // pdf.js throws when a render is cancelled — ignore it
    if (err instanceof Error && err.message === "Rendering cancelled") return canvas;
    throw err;
  }
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

/**
 * Estimate how much "ink" is on a page by counting dark pixels.
 * Returns a ratio 0..1 where 0 = blank white page, 1 = solid black.
 * A typical text page scores 0.02-0.15. Below 0.005 is likely blank.
 */
export async function getPageInkCoverage(
  pdfDoc: PDFDocumentProxy,
  pageNumber: number,
  scale: number = 0.5 // low res is fine for coverage check
): Promise<number> {
  const page = await pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.height = viewport.height;
  canvas.width = viewport.width;
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;
  await page.render({ canvasContext: ctx, viewport }).promise;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  let darkPixels = 0;
  const totalPixels = canvas.width * canvas.height;
  // Sample every 4th pixel for speed
  for (let i = 0; i < data.length; i += 16) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // Pixel is "dark" if brightness < 180 (on white background)
    if ((r + g + b) / 3 < 180) {
      darkPixels++;
    }
  }
  return darkPixels / (totalPixels / 4);
}
