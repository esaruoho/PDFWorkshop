"use client";

import { useEffect, useRef } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { renderPageToCanvas } from "@/lib/pdf-utils";

interface PdfViewerProps {
  pdfDoc: PDFDocumentProxy | null;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export default function PdfViewer({
  pdfDoc,
  currentPage,
  totalPages,
  onPageChange,
}: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;
    const controller = new AbortController();
    const canvas = canvasRef.current;
    renderPageToCanvas(pdfDoc, currentPage, canvas, 1.5, controller.signal).catch(
      (err) => {
        if (!controller.signal.aborted) {
          console.error("Failed to render PDF page:", err);
        }
      }
    );
    return () => {
      controller.abort();
    };
  }, [pdfDoc, currentPage]);

  if (!pdfDoc) {
    return (
      <div className="flex items-center justify-center h-full text-neutral-500">
        <div className="text-center">
          <p className="text-lg font-medium">No PDF loaded</p>
          <p className="text-sm mt-1">Upload a scanned PDF to get started</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-700 bg-neutral-800 shrink-0">
        <span className="text-sm font-medium text-neutral-300">
          Original Scan
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onPageChange(1)}
            disabled={currentPage <= 1}
            className="px-1.5 py-1 text-xs rounded bg-neutral-700 hover:bg-neutral-600 disabled:opacity-30 disabled:cursor-not-allowed"
            title="First page"
          >
            First
          </button>
          <button
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage <= 1}
            className="px-2 py-1 text-xs rounded bg-neutral-700 hover:bg-neutral-600 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Previous page"
          >
            Prev
          </button>
          <span className="text-sm tabular-nums min-w-[4em] text-center">
            {String(currentPage).padStart(String(totalPages).length, "0")} / {totalPages}
          </span>
          <button
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage >= totalPages}
            className="px-2 py-1 text-xs rounded bg-neutral-700 hover:bg-neutral-600 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Next page"
          >
            Next
          </button>
          <button
            onClick={() => onPageChange(totalPages)}
            disabled={currentPage >= totalPages}
            className="px-1.5 py-1 text-xs rounded bg-neutral-700 hover:bg-neutral-600 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Last page"
          >
            Last
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4 bg-neutral-900">
        <canvas ref={canvasRef} className="mx-auto shadow-lg" />
      </div>
    </div>
  );
}
