"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PageData, OcrSource } from "@/lib/types";
import { loadPdfDocument, getPageAsImageData } from "@/lib/pdf-utils";
import PdfViewer from "@/components/PdfViewer";
import OcrEditor from "@/components/OcrEditor";

function initPages(count: number): PageData[] {
  return Array.from({ length: count }, (_, i) => ({
    pageNumber: i + 1,
    ocrText: "",
    source: null,
    history: [],
  }));
}

export default function Home() {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [fileName, setFileName] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [pages, setPages] = useState<PageData[]>([]);
  const [isOcrRunning, setIsOcrRunning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [geminiKey, setGeminiKey] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load Gemini key from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("pdf-workshop-gemini-key");
    if (saved) setGeminiKey(saved);
  }, []);

  // Warn before closing with unsaved OCR text
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (pages.some((p) => p.ocrText)) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [pages]);

  const saveGeminiKey = (key: string) => {
    setGeminiKey(key);
    if (key) {
      localStorage.setItem("pdf-workshop-gemini-key", key);
    } else {
      localStorage.removeItem("pdf-workshop-gemini-key");
    }
  };

  const currentPageData = pages[currentPage - 1] ?? null;

  // --- Load PDF from buffer ---
  const loadPdf = useCallback(async (buffer: ArrayBuffer, name: string) => {
    // Copy buffer before pdf.js consumes (detaches) it
    const copy = buffer.slice(0);
    const doc = await loadPdfDocument(buffer);
    setPdfDoc(doc);
    setPdfData(copy);
    setFileName(name);
    setTotalPages(doc.numPages);
    setCurrentPage(1);
    setPages(initPages(doc.numPages));
  }, []);

  // --- File upload ---
  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const buffer = await file.arrayBuffer();
        await loadPdf(buffer, file.name);
      } catch (err) {
        alert(
          `Failed to load PDF: ${err instanceof Error ? err.message : err}`
        );
      }
    },
    [loadPdf]
  );

  // --- Drag and drop ---
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file?.type === "application/pdf") {
        try {
          const buffer = await file.arrayBuffer();
          await loadPdf(buffer, file.name);
        } catch (err) {
          alert(
            `Failed to load PDF: ${err instanceof Error ? err.message : err}`
          );
        }
      }
    },
    [loadPdf]
  );

  // --- Text editing (with source for cleanup/paste) ---
  const updatePageText = useCallback(
    (text: string, source: OcrSource = "manual") => {
      setPages((prev) => {
        const next = [...prev];
        const page = { ...next[currentPage - 1] };
        if (page.ocrText && page.ocrText !== text) {
          page.history = [
            ...page.history,
            {
              text: page.ocrText,
              source: page.source ?? "manual",
              timestamp: Date.now(),
            },
          ];
        }
        page.ocrText = text;
        page.source = source;
        next[currentPage - 1] = page;
        return next;
      });
    },
    [currentPage]
  );

  const handleTextChange = useCallback(
    (text: string, source?: OcrSource) => {
      if (source) {
        // From cleanup/paste — push to undo history
        updatePageText(text, source);
      } else {
        // Direct keystroke — no history per keystroke
        setPages((prev) => {
          const next = [...prev];
          const page = { ...next[currentPage - 1] };
          page.ocrText = text;
          page.source = "manual";
          next[currentPage - 1] = page;
          return next;
        });
      }
    },
    [currentPage, updatePageText]
  );

  // --- Paste from clipboard ---
  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) updatePageText(text, "pasted");
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        alert(
          "Clipboard access denied. Please allow clipboard access in your browser settings."
        );
      } else {
        alert(
          `Could not read clipboard: ${err instanceof Error ? err.message : err}`
        );
      }
    }
  }, [updatePageText]);

  // --- Undo ---
  const handleUndo = useCallback(() => {
    setPages((prev) => {
      const next = [...prev];
      const page = { ...next[currentPage - 1] };
      if (page.history.length === 0) return prev;
      const last = page.history[page.history.length - 1];
      page.history = page.history.slice(0, -1);
      page.ocrText = last.text;
      page.source = last.source;
      next[currentPage - 1] = page;
      return next;
    });
  }, [currentPage]);

  // --- Tesseract OCR ---
  const runTesseract = useCallback(
    async (pageNum: number) => {
      if (!pdfDoc) return;
      const imageData = await getPageAsImageData(pdfDoc, pageNum);
      const Tesseract = await import("tesseract.js");
      const {
        data: { text },
      } = await Tesseract.recognize(imageData, "eng");
      return text;
    },
    [pdfDoc]
  );

  // --- Gemini OCR ---
  const runGemini = useCallback(
    async (pageNum: number) => {
      if (!pdfDoc) return;
      const imageData = await getPageAsImageData(pdfDoc, pageNum);
      const res = await fetch("/api/ocr-gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: imageData, apiKey: geminiKey }),
      });
      if (!res.ok) {
        throw new Error(`Gemini API request failed: ${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data.text as string;
    },
    [pdfDoc, geminiKey]
  );

  // --- OCR single page ---
  const handleOcrPage = useCallback(
    async (method: "tesseract" | "gemini") => {
      if (method === "gemini" && !geminiKey) {
        setShowSettings(true);
        return;
      }
      setIsOcrRunning(true);
      setOcrProgress(`Running ${method} on page ${currentPage}...`);
      try {
        const text =
          method === "tesseract"
            ? await runTesseract(currentPage)
            : await runGemini(currentPage);
        if (text) updatePageText(text, method);
      } catch (err) {
        alert(`OCR error: ${err instanceof Error ? err.message : err}`);
      } finally {
        setIsOcrRunning(false);
        setOcrProgress("");
      }
    },
    [currentPage, runTesseract, runGemini, updatePageText, geminiKey]
  );

  // --- OCR all pages ---
  const handleOcrAll = useCallback(
    async (method: "tesseract" | "gemini", overwrite: boolean = false) => {
      if (!pdfDoc) return;
      if (method === "gemini" && !geminiKey) {
        setShowSettings(true);
        return;
      }

      // Count pages that would be skipped
      const emptyCount = pages.filter((p) => !p.ocrText).length;
      const filledCount = pages.filter((p) => !!p.ocrText).length;

      if (!overwrite && emptyCount === 0) {
        alert("All pages already have text. Use 'All (overwrite)' to re-OCR.");
        return;
      }

      if (overwrite && filledCount > 0) {
        const ok = confirm(
          `${filledCount} page${filledCount > 1 ? "s" : ""} already have text. Overwrite? (Previous text will be saved to undo history.)`
        );
        if (!ok) return;
      }

      setIsOcrRunning(true);
      const ocrFn = method === "tesseract" ? runTesseract : runGemini;
      let processed = 0;
      const target = overwrite ? pdfDoc.numPages : emptyCount;
      const failedPages: number[] = [];

      for (let i = 1; i <= pdfDoc.numPages; i++) {
        // Skip pages with existing text unless overwriting
        if (!overwrite && pages[i - 1]?.ocrText) {
          continue;
        }

        processed++;
        setOcrProgress(`${method} — ${processed}/${target} pages...`);
        try {
          const text = await ocrFn(i);
          if (text) {
            setPages((prev) => {
              const next = [...prev];
              const page = { ...next[i - 1] };
              if (page.ocrText) {
                page.history = [
                  ...page.history,
                  {
                    text: page.ocrText,
                    source: page.source ?? "manual",
                    timestamp: Date.now(),
                  },
                ];
              }
              page.ocrText = text;
              page.source = method;
              next[i - 1] = page;
              return next;
            });
          }
        } catch (err) {
          console.error(`OCR failed on page ${i}:`, err);
          failedPages.push(i);
        }
      }
      setIsOcrRunning(false);
      setOcrProgress("");
      if (failedPages.length > 0) {
        alert(
          `OCR failed on ${failedPages.length} page${failedPages.length > 1 ? "s" : ""}: ${failedPages.join(", ")}`
        );
      }
    },
    [pdfDoc, runTesseract, runGemini, geminiKey]
  );

  // --- Export OCR PDF ---
  const handleExport = useCallback(async () => {
    if (!pdfData) return;
    const { PDFDocument, rgb, StandardFonts } = await import("pdf-lib");
    const srcDoc = await PDFDocument.load(pdfData);
    const exportDoc = await PDFDocument.create();
    const font = await exportDoc.embedFont(StandardFonts.Helvetica);

    for (let i = 0; i < srcDoc.getPageCount(); i++) {
      const [copiedPage] = await exportDoc.copyPages(srcDoc, [i]);
      exportDoc.addPage(copiedPage);

      const page = exportDoc.getPage(i);
      const text = pages[i]?.ocrText ?? "";
      if (text) {
        const fontSize = 1;
        const lines = text.split("\n");
        let y = page.getHeight() - 10;
        for (const line of lines) {
          if (y < 10) break;
          // Skip image placeholders
          if (line.trim().startsWith("[IMAGE")) continue;
          page.drawText(line, {
            x: 10,
            y,
            size: fontSize,
            font,
            color: rgb(0, 0, 0),
            opacity: 0.01,
          });
          y -= fontSize + 1;
        }
      }
    }

    const pdfBytes = await exportDoc.save();
    const blob = new Blob([pdfBytes.buffer as ArrayBuffer], {
      type: "application/pdf",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName.replace(/\.pdf$/i, "") + "_ocr.pdf";
    a.click();
    URL.revokeObjectURL(url);
  }, [pdfData, pages, fileName]);

  return (
    <div
      className="flex flex-col h-screen bg-neutral-950 text-white"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="fixed inset-0 bg-indigo-600/20 border-4 border-dashed border-indigo-400 z-50 flex items-center justify-center">
          <div className="text-2xl font-bold text-indigo-300">
            Drop PDF here
          </div>
        </div>
      )}

      {/* Settings modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/60 z-40 flex items-center justify-center">
          <div className="bg-neutral-800 rounded-lg p-6 w-full max-w-md border border-neutral-600 shadow-2xl">
            <h2 className="text-base font-bold mb-4">Settings</h2>
            <label htmlFor="gemini-api-key" className="block text-xs text-neutral-400 mb-1">
              Gemini API Key
            </label>
            <input
              id="gemini-api-key"
              type="password"
              value={geminiKey}
              onChange={(e) => saveGeminiKey(e.target.value)}
              placeholder="Enter your Gemini API key"
              className="w-full px-3 py-2 text-sm bg-neutral-900 border border-neutral-600 rounded focus:outline-none focus:border-indigo-500"
            />
            <p className="text-xs text-neutral-500 mt-2">
              Get a key from{" "}
              <span className="text-indigo-400">
                aistudio.google.com/apikey
              </span>
              . Stored in your browser only.
            </p>
            <div className="flex justify-end mt-4">
              <button
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 text-xs rounded bg-indigo-600 hover:bg-indigo-500 font-medium"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-2 bg-neutral-900 border-b border-neutral-800 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-bold tracking-tight">PDF Workshop</h1>
          {fileName && (
            <span className="text-xs text-neutral-500 truncate max-w-[300px]">
              {fileName} — {totalPages} page{totalPages !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {ocrProgress && (
            <span className="text-xs text-yellow-400 animate-pulse" aria-live="polite">
              {ocrProgress}
            </span>
          )}
          <button
            onClick={() => setShowSettings(true)}
            title="Settings — Gemini API key"
            className="px-2 py-1.5 text-xs rounded bg-neutral-700 hover:bg-neutral-600"
          >
            Settings
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1.5 text-xs rounded bg-neutral-700 hover:bg-neutral-600 font-medium"
          >
            Upload PDF
          </button>
          <button
            onClick={handleExport}
            disabled={!pdfDoc || pages.every((p) => !p.ocrText)}
            className="px-3 py-1.5 text-xs rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed font-medium"
          >
            Export OCR PDF
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            onChange={handleFileUpload}
            className="hidden"
          />
        </div>
      </header>

      {/* Split pane */}
      <div className="flex flex-1 min-h-0">
        {/* Left: PDF Viewer */}
        <div className="w-1/2 border-r border-neutral-800">
          <PdfViewer
            pdfDoc={pdfDoc}
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
          />
        </div>

        {/* Right: OCR Editor */}
        <div className="w-1/2">
          <OcrEditor
            pageData={currentPageData}
            currentPage={currentPage}
            totalPages={totalPages}
            isOcrRunning={isOcrRunning}
            onTextChange={handleTextChange}
            onOcrPage={handleOcrPage}
            onOcrAll={handleOcrAll}
            onPaste={handlePaste}
            onUndo={handleUndo}
          />
        </div>
      </div>
    </div>
  );
}
