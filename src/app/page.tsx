"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type {
  PageData,
  OcrSource,
  TesseractLanguage,
  ProjectFile,
} from "@/lib/types";
import { TESSERACT_LANGUAGES } from "@/lib/types";
import { loadPdfDocument, getPageAsImageData } from "@/lib/pdf-utils";
import { cleanupText, type CleanupOptions } from "@/lib/text-cleanup";
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

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
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
  const pendingOcrAction = useRef<{ type: "page" | "all"; method: "gemini" | "glm-ocr"; overwrite?: boolean } | null>(null);
  const [geminiKey, setGeminiKey] = useState("");
  const [glmOcrKey, setGlmOcrKey] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [ocrLanguages, setOcrLanguages] = useState<TesseractLanguage[]>([
    "eng",
  ]);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [lastModifiedAt, setLastModifiedAt] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load settings from localStorage on mount
  useEffect(() => {
    const savedKey = localStorage.getItem("pdf-workshop-gemini-key");
    if (savedKey) setGeminiKey(savedKey);

    const savedGlmKey = localStorage.getItem("pdf-workshop-glm-ocr-key");
    if (savedGlmKey) setGlmOcrKey(savedGlmKey);

    const savedLangs = localStorage.getItem("pdf-workshop-ocr-languages");
    if (savedLangs) {
      try {
        const parsed = JSON.parse(savedLangs);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setOcrLanguages(parsed);
        }
      } catch {
        // ignore bad data
      }
    }
  }, []);

  // Warn before closing with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      const hasContent = pages.some((p) => p.ocrText);
      const isUnsaved = !lastSavedAt || (lastModifiedAt && lastModifiedAt > lastSavedAt);
      if (hasContent && isUnsaved) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [pages, lastSavedAt, lastModifiedAt]);

  const saveGeminiKey = (key: string) => {
    setGeminiKey(key);
    if (key) {
      localStorage.setItem("pdf-workshop-gemini-key", key);
    } else {
      localStorage.removeItem("pdf-workshop-gemini-key");
    }
  };

  const saveGlmOcrKey = (key: string) => {
    setGlmOcrKey(key);
    if (key) {
      localStorage.setItem("pdf-workshop-glm-ocr-key", key);
    } else {
      localStorage.removeItem("pdf-workshop-glm-ocr-key");
    }
  };

  const saveOcrLanguages = (langs: TesseractLanguage[]) => {
    if (langs.length === 0) return; // must have at least one
    setOcrLanguages(langs);
    localStorage.setItem("pdf-workshop-ocr-languages", JSON.stringify(langs));
  };

  const toggleLanguage = (lang: TesseractLanguage) => {
    const newLangs = ocrLanguages.includes(lang)
      ? ocrLanguages.filter((l) => l !== lang)
      : [...ocrLanguages, lang];
    if (newLangs.length > 0) saveOcrLanguages(newLangs);
  };

  const currentPageData = pages[currentPage - 1] ?? null;
  const langString = ocrLanguages.join("+");

  // --- Load PDF from buffer ---
  const loadPdf = useCallback(async (buffer: ArrayBuffer, name: string) => {
    const copy = buffer.slice(0);
    const doc = await loadPdfDocument(buffer);
    setPdfDoc(doc);
    setPdfData(copy);
    setFileName(name);
    setTotalPages(doc.numPages);
    setCurrentPage(1);
    setPages(initPages(doc.numPages));
    setLastSavedAt(null);
    setLastModifiedAt(null);
  }, []);

  // --- Load project with restored pages ---
  const loadProject = useCallback(
    async (buffer: ArrayBuffer, name: string, projectPages: PageData[], projectLangs?: TesseractLanguage[]) => {
      const copy = buffer.slice(0);
      const doc = await loadPdfDocument(buffer);
      setPdfDoc(doc);
      setPdfData(copy);
      setFileName(name);
      setTotalPages(doc.numPages);
      setCurrentPage(1);
      setPages(projectPages);
      setLastSavedAt(Date.now());
      setLastModifiedAt(null);
      if (projectLangs && projectLangs.length > 0) {
        saveOcrLanguages(projectLangs);
      }
    },
    []
  );

  // --- File upload (PDF or project) ---
  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        if (file.name.endsWith(".pdfws")) {
          const text = await file.text();
          const project: ProjectFile = JSON.parse(text);
          if (project.version !== 1) throw new Error("Unsupported project version");
          const pdfBuffer = base64ToArrayBuffer(project.pdfBase64);
          await loadProject(pdfBuffer, project.fileName, project.pages, project.ocrLanguages);
        } else {
          const buffer = await file.arrayBuffer();
          await loadPdf(buffer, file.name);
        }
      } catch (err) {
        alert(`Failed to load file: ${err instanceof Error ? err.message : err}`);
      }
    },
    [loadPdf, loadProject]
  );

  // --- Drag and drop ---
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (!file) return;
      try {
        if (file.name.endsWith(".pdfws")) {
          const text = await file.text();
          const project: ProjectFile = JSON.parse(text);
          if (project.version !== 1) throw new Error("Unsupported project version");
          const pdfBuffer = base64ToArrayBuffer(project.pdfBase64);
          await loadProject(pdfBuffer, project.fileName, project.pages, project.ocrLanguages);
        } else if (file.type === "application/pdf") {
          const buffer = await file.arrayBuffer();
          await loadPdf(buffer, file.name);
        }
      } catch (err) {
        alert(`Failed to load file: ${err instanceof Error ? err.message : err}`);
      }
    },
    [loadPdf, loadProject]
  );

  // --- Text editing ---
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
      setLastModifiedAt(Date.now());
    },
    [currentPage]
  );

  const handleTextChange = useCallback(
    (text: string, source?: OcrSource) => {
      if (source) {
        updatePageText(text, source);
      } else {
        setPages((prev) => {
          const next = [...prev];
          const page = { ...next[currentPage - 1] };
          page.ocrText = text;
          page.source = "manual";
          next[currentPage - 1] = page;
          return next;
        });
        setLastModifiedAt(Date.now());
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
        alert("Clipboard access denied. Please allow clipboard access in your browser settings.");
      } else {
        alert(`Could not read clipboard: ${err instanceof Error ? err.message : err}`);
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
      } = await Tesseract.recognize(imageData, langString);
      return text;
    },
    [pdfDoc, langString]
  );

  // --- Gemini OCR ---
  const runGemini = useCallback(
    async (pageNum: number) => {
      if (!pdfDoc) return;
      const imageData = await getPageAsImageData(pdfDoc, pageNum);
      const languageNames = ocrLanguages.map((l) => TESSERACT_LANGUAGES[l]);
      const res = await fetch("/api/ocr-gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: imageData,
          apiKey: geminiKey,
          languages: languageNames,
        }),
      });
      if (!res.ok) {
        throw new Error(`Gemini API request failed: ${res.status} ${res.statusText}`);
      }
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return data.text as string;
    },
    [pdfDoc, geminiKey, ocrLanguages]
  );

  // --- GLM-OCR ---
  const runGlmOcr = useCallback(
    async (pageNum: number) => {
      if (!pdfDoc) return;
      const imageData = await getPageAsImageData(pdfDoc, pageNum);
      const res = await fetch("/api/ocr-glm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: imageData,
          apiKey: glmOcrKey,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || `GLM-OCR API request failed: ${res.status}`);
      }
      return data.text as string;
    },
    [pdfDoc, glmOcrKey]
  );

  // --- OCR single page ---
  const handleOcrPage = useCallback(
    async (method: "tesseract" | "gemini" | "glm-ocr") => {
      if (method === "gemini" && !geminiKey) {
        pendingOcrAction.current = { type: "page", method };
        setShowSettings(true);
        return;
      }
      setIsOcrRunning(true);
      setOcrProgress(`Running ${method === "glm-ocr" ? "GLM-OCR" : method} on page ${currentPage}...`);
      try {
        const text =
          method === "tesseract"
            ? await runTesseract(currentPage)
            : method === "gemini"
              ? await runGemini(currentPage)
              : await runGlmOcr(currentPage);
        if (text) updatePageText(text, method);
      } catch (err) {
        alert(`OCR error: ${err instanceof Error ? err.message : err}`);
      } finally {
        setIsOcrRunning(false);
        setOcrProgress("");
      }
    },
    [currentPage, runTesseract, runGemini, runGlmOcr, updatePageText, geminiKey, glmOcrKey]
  );

  // --- OCR all pages ---
  const handleOcrAll = useCallback(
    async (method: "tesseract" | "gemini" | "glm-ocr", overwrite: boolean = false) => {
      if (!pdfDoc) return;
      if (method === "gemini" && !geminiKey) {
        pendingOcrAction.current = { type: "all", method, overwrite };
        setShowSettings(true);
        return;
      }

      const emptyCount = pages.filter((p) => !p.ocrText).length;
      const filledCount = pages.filter((p) => !!p.ocrText).length;

      if (!overwrite && emptyCount === 0) {
        alert("All pages already have text. Use 'All (overwrite)' to re-OCR.");
        return;
      }

      if (overwrite && filledCount > 0) {
        const ok = confirm(
          `${filledCount} page${filledCount > 1 ? "s" : ""} already have text. Overwrite? (Previous text saved to undo history.)`
        );
        if (!ok) return;
      }

      setIsOcrRunning(true);
      const ocrFn = method === "tesseract" ? runTesseract : method === "gemini" ? runGemini : runGlmOcr;
      let processed = 0;
      const target = overwrite ? pdfDoc.numPages : emptyCount;
      const failedPages: number[] = [];

      for (let i = 1; i <= pdfDoc.numPages; i++) {
        if (!overwrite && pages[i - 1]?.ocrText) continue;

        processed++;
        const methodLabel = method === "glm-ocr" ? "GLM-OCR" : method;
        setOcrProgress(`${methodLabel} — ${processed}/${target} pages...`);
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
      setLastModifiedAt(Date.now());
      if (failedPages.length > 0) {
        alert(
          `OCR failed on ${failedPages.length} page${failedPages.length > 1 ? "s" : ""}: ${failedPages.join(", ")}`
        );
      }
    },
    [pdfDoc, runTesseract, runGemini, runGlmOcr, geminiKey, glmOcrKey, pages]
  );

  // --- Batch cleanup all pages ---
  const handleCleanupAll = useCallback(
    (opts: CleanupOptions) => {
      let cleaned = 0;
      setPages((prev) => {
        const next = prev.map((page) => {
          if (!page.ocrText) return page;
          const newText = cleanupText(page.ocrText, opts);
          if (newText === page.ocrText) return page;
          cleaned++;
          return {
            ...page,
            history: [
              ...page.history,
              {
                text: page.ocrText,
                source: page.source ?? ("manual" as OcrSource),
                timestamp: Date.now(),
              },
            ],
            ocrText: newText,
            source: "manual" as OcrSource,
          };
        });
        return next;
      });
      setLastModifiedAt(Date.now());
      // Use setTimeout so state has updated
      setTimeout(() => {
        alert(`Cleaned up ${cleaned} page${cleaned !== 1 ? "s" : ""}`);
      }, 50);
    },
    []
  );

  // --- Export OCR PDF ---
  const handleExport = useCallback(async () => {
    if (!pdfData) return;
    const { PDFDocument, rgb } = await import("pdf-lib");
    const fontkit = (await import("@pdf-lib/fontkit")).default;
    const srcDoc = await PDFDocument.load(pdfData);
    const exportDoc = await PDFDocument.create();
    exportDoc.registerFontkit(fontkit);

    // Fetch a Unicode-capable font (Noto Sans supports Latin, Greek, Cyrillic, etc.)
    let font: Awaited<ReturnType<typeof exportDoc.embedFont>>;
    try {
      const fontUrl =
        "https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSans/hinted/ttf/NotoSans-Regular.ttf";
      const fontRes = await fetch(fontUrl);
      const fontBytes = await fontRes.arrayBuffer();
      font = await exportDoc.embedFont(fontBytes, { subset: true });
    } catch {
      // Fallback: use Helvetica but strip non-WinAnsi characters
      const { StandardFonts } = await import("pdf-lib");
      font = await exportDoc.embedFont(StandardFonts.Helvetica);
    }

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
          if (line.trim().startsWith("[IMAGE")) continue;
          // Filter out characters the font cannot encode
          let safeLine = line;
          try {
            font.encodeText(line);
          } catch {
            safeLine = line
              .split("")
              .filter((ch) => {
                try {
                  font.encodeText(ch);
                  return true;
                } catch {
                  return false;
                }
              })
              .join("");
          }
          if (!safeLine) continue;
          page.drawText(safeLine, {
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

  // --- Save project ---
  const handleSaveProject = useCallback(() => {
    if (!pdfData) return;
    const project: ProjectFile = {
      version: 1,
      fileName,
      totalPages,
      pages,
      ocrLanguages,
      pdfBase64: arrayBufferToBase64(pdfData),
      savedAt: new Date().toISOString(),
    };
    const json = JSON.stringify(project);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName.replace(/\.pdf$/i, "") + ".pdfws";
    a.click();
    URL.revokeObjectURL(url);
    setLastSavedAt(Date.now());
  }, [pdfData, fileName, totalPages, pages, ocrLanguages]);

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
            Drop PDF or .pdfws project here
          </div>
        </div>
      )}

      {/* Settings modal */}
      {showSettings && (
        <div className="fixed inset-0 bg-black/60 z-40 flex items-center justify-center">
          <div className="bg-neutral-800 rounded-lg p-6 w-full max-w-lg border border-neutral-600 shadow-2xl max-h-[80vh] overflow-y-auto">
            <h2 className="text-base font-bold mb-4">Settings</h2>

            {/* Gemini key */}
            <label
              htmlFor="gemini-api-key"
              className="block text-xs text-neutral-400 mb-1"
            >
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
            <p className="text-xs text-neutral-500 mt-1 mb-4">
              Get a key from{" "}
              <span className="text-indigo-400">
                aistudio.google.com/apikey
              </span>
              . Stored in your browser only.
            </p>

            {/* GLM-OCR key */}
            <label
              htmlFor="glm-ocr-api-key"
              className="block text-xs text-neutral-400 mb-1"
            >
              GLM-OCR API Key (optional — cloud fallback)
            </label>
            <input
              id="glm-ocr-api-key"
              type="password"
              value={glmOcrKey}
              onChange={(e) => saveGlmOcrKey(e.target.value)}
              placeholder="Not needed if MLX or Ollama is running locally"
              className="w-full px-3 py-2 text-sm bg-neutral-900 border border-neutral-600 rounded focus:outline-none focus:border-indigo-500"
            />
            <p className="text-xs text-neutral-500 mt-1 mb-4">
              GLM-OCR runs locally via MLX (./start-mlx-server.sh) or Ollama (ollama pull glm-ocr).
              No API key needed. Cloud fallback: get a key from{" "}
              <span className="text-indigo-400">
                open.bigmodel.cn
              </span>
              .
            </p>

            {/* Language selection */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-neutral-400 font-medium">
                  OCR Languages
                </span>
                <span className="text-xs text-neutral-500">
                  {ocrLanguages.length} selected
                </span>
              </div>
              <div className="grid grid-cols-2 gap-1 max-h-48 overflow-y-auto bg-neutral-900 rounded p-2 border border-neutral-700">
                {(
                  Object.entries(TESSERACT_LANGUAGES) as [
                    TesseractLanguage,
                    string,
                  ][]
                ).map(([code, name]) => (
                  <label
                    key={code}
                    className="flex items-center gap-1.5 py-0.5 cursor-pointer hover:bg-neutral-800 px-1 rounded"
                  >
                    <input
                      type="checkbox"
                      checked={ocrLanguages.includes(code)}
                      onChange={() => toggleLanguage(code)}
                      className="accent-indigo-500"
                    />
                    <span className="text-xs text-neutral-300">
                      {name}
                      <span className="text-neutral-600 ml-1">({code})</span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-neutral-500 mt-1">
                Multiple languages can be selected. Tesseract uses &quot;{langString}&quot; format.
              </p>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => {
                  setShowSettings(false);
                  const pending = pendingOcrAction.current;
                  if (pending) {
                    pendingOcrAction.current = null;
                    const keyReady = pending.method === "gemini" ? geminiKey : glmOcrKey;
                    if (keyReady) {
                      if (pending.type === "page") {
                        handleOcrPage(pending.method);
                      } else {
                        handleOcrAll(pending.method, pending.overwrite);
                      }
                    }
                  }
                }}
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
          {ocrLanguages.length > 0 && (
            <span className="text-xs text-neutral-600">
              [{ocrLanguages.join("+")}]
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {ocrProgress && (
            <span
              className="text-xs text-yellow-400 animate-pulse"
              aria-live="polite"
            >
              {ocrProgress}
            </span>
          )}
          <button
            onClick={() => setShowSettings(true)}
            title="Settings — languages, Gemini API key"
            className="px-2 py-1.5 text-xs rounded bg-neutral-700 hover:bg-neutral-600"
          >
            Settings
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1.5 text-xs rounded bg-neutral-700 hover:bg-neutral-600 font-medium"
          >
            Open
          </button>
          <button
            onClick={handleSaveProject}
            disabled={!pdfDoc || pages.every((p) => !p.ocrText)}
            title="Save project (.pdfws) — resume later"
            className="px-3 py-1.5 text-xs rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-30 disabled:cursor-not-allowed font-medium"
          >
            Save Project
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
            accept=".pdf,.pdfws"
            onChange={handleFileUpload}
            className="hidden"
          />
        </div>
      </header>

      {/* Split pane */}
      <div className="flex flex-1 min-h-0">
        <div className="w-1/2 border-r border-neutral-800">
          <PdfViewer
            pdfDoc={pdfDoc}
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
          />
        </div>
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
            onCleanupAll={handleCleanupAll}
          />
        </div>
      </div>
    </div>
  );
}
