"use client";

import { useState, useRef } from "react";
import type { PageData, OcrSource } from "@/lib/types";
import {
  cleanupText,
  DEFAULT_CLEANUP,
  CLEANUP_LABELS,
  type CleanupOptions,
} from "@/lib/text-cleanup";

interface OcrEditorProps {
  pageData: PageData | null;
  currentPage: number;
  totalPages: number;
  isOcrRunning: boolean;
  onTextChange: (text: string, source?: OcrSource) => void;
  onOcrPage: (method: "tesseract" | "gemini") => void;
  onOcrAll: (method: "tesseract" | "gemini", overwrite?: boolean) => void;
  onPaste: () => void;
  onUndo: () => void;
}

function sourceLabel(source: OcrSource | null): string {
  if (!source) return "empty";
  const labels: Record<OcrSource, string> = {
    tesseract: "Tesseract",
    gemini: "Gemini",
    pasted: "Pasted",
    manual: "Edited",
  };
  return labels[source];
}

function sourceBadgeColor(source: OcrSource | null): string {
  if (!source) return "bg-neutral-700";
  const colors: Record<OcrSource, string> = {
    tesseract: "bg-emerald-800",
    gemini: "bg-purple-800",
    pasted: "bg-blue-800",
    manual: "bg-amber-800",
  };
  return colors[source];
}

export default function OcrEditor({
  pageData,
  currentPage,
  totalPages,
  isOcrRunning,
  onTextChange,
  onOcrPage,
  onOcrAll,
  onPaste,
  onUndo,
}: OcrEditorProps) {
  const [showOcrMenu, setShowOcrMenu] = useState(false);
  const [showCleanup, setShowCleanup] = useState(false);
  const [cleanupOpts, setCleanupOpts] = useState<CleanupOptions>(DEFAULT_CLEANUP);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleCleanup = () => {
    if (!pageData?.ocrText) return;
    const cleaned = cleanupText(pageData.ocrText, cleanupOpts);
    if (cleaned !== pageData.ocrText) {
      onTextChange(cleaned, "manual");
    }
    setShowCleanup(false);
  };

  const handleCleanupAll = (opts: CleanupOptions) => {
    if (!pageData?.ocrText) return;
    const cleaned = cleanupText(pageData.ocrText, opts);
    if (cleaned !== pageData.ocrText) {
      onTextChange(cleaned, "manual");
    }
  };

  const insertImagePlaceholder = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const text = pageData?.ocrText ?? "";
    const placeholder = `\n[IMAGE: description here]\n`;
    const newText = text.slice(0, start) + placeholder + text.slice(end);
    onTextChange(newText, "manual");
    // Move cursor inside the placeholder
    setTimeout(() => {
      ta.focus();
      ta.selectionStart = start + 9; // after "[IMAGE: "
      ta.selectionEnd = start + 9 + 16; // select "description here"
    }, 0);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-700 bg-neutral-800 shrink-0 flex-wrap gap-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-neutral-300">
            Page {currentPage}
          </span>
          {pageData?.source && (
            <span
              className={`text-xs px-1.5 py-0.5 rounded ${sourceBadgeColor(pageData.source)} text-neutral-200`}
            >
              {sourceLabel(pageData.source)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 relative">
          {/* Paste */}
          <button
            onClick={onPaste}
            title="Paste from clipboard (e.g. macOS Preview)"
            className="px-2 py-1 text-xs rounded bg-blue-700 hover:bg-blue-600"
          >
            Paste
          </button>

          {/* OCR dropdown */}
          <div className="relative">
            <button
              onClick={() => {
                setShowOcrMenu(!showOcrMenu);
                setShowCleanup(false);
              }}
              disabled={isOcrRunning}
              className="px-2 py-1 text-xs rounded bg-green-700 hover:bg-green-600 disabled:opacity-50"
            >
              {isOcrRunning ? "Running..." : "OCR \u25BE"}
            </button>
            {showOcrMenu && (
              <div className="absolute right-0 top-full mt-1 bg-neutral-800 border border-neutral-600 rounded shadow-xl z-20 min-w-[200px]">
                <div className="px-3 py-1.5 text-xs text-neutral-500 font-medium">
                  Tesseract (local)
                </div>
                <button
                  onClick={() => {
                    onOcrPage("tesseract");
                    setShowOcrMenu(false);
                  }}
                  className="block w-full text-left px-3 py-2 text-xs hover:bg-neutral-700"
                >
                  This page
                </button>
                <button
                  onClick={() => {
                    onOcrAll("tesseract", false);
                    setShowOcrMenu(false);
                  }}
                  className="block w-full text-left px-3 py-2 text-xs hover:bg-neutral-700"
                >
                  Empty pages only
                </button>
                <button
                  onClick={() => {
                    onOcrAll("tesseract", true);
                    setShowOcrMenu(false);
                  }}
                  className="block w-full text-left px-3 py-2 text-xs hover:bg-neutral-700 text-orange-400"
                >
                  All {totalPages} pages (overwrite)
                </button>
                <hr className="border-neutral-700 my-1" />
                <div className="px-3 py-1.5 text-xs text-neutral-500 font-medium">
                  Gemini Vision (API)
                </div>
                <button
                  onClick={() => {
                    onOcrPage("gemini");
                    setShowOcrMenu(false);
                  }}
                  className="block w-full text-left px-3 py-2 text-xs hover:bg-neutral-700"
                >
                  This page
                </button>
                <button
                  onClick={() => {
                    onOcrAll("gemini", false);
                    setShowOcrMenu(false);
                  }}
                  className="block w-full text-left px-3 py-2 text-xs hover:bg-neutral-700"
                >
                  Empty pages only
                </button>
                <button
                  onClick={() => {
                    onOcrAll("gemini", true);
                    setShowOcrMenu(false);
                  }}
                  className="block w-full text-left px-3 py-2 text-xs hover:bg-neutral-700 text-orange-400"
                >
                  All {totalPages} pages (overwrite)
                </button>
              </div>
            )}
          </div>

          {/* Cleanup dropdown */}
          <div className="relative">
            <button
              onClick={() => {
                setShowCleanup(!showCleanup);
                setShowOcrMenu(false);
              }}
              disabled={!pageData?.ocrText}
              title="Clean up OCR text"
              className="px-2 py-1 text-xs rounded bg-amber-700 hover:bg-amber-600 disabled:opacity-30"
            >
              Cleanup \u25BE
            </button>
            {showCleanup && (
              <div className="absolute right-0 top-full mt-1 bg-neutral-800 border border-neutral-600 rounded shadow-xl z-20 min-w-[300px] p-3">
                <div className="text-xs font-medium text-neutral-400 mb-2">
                  Text Cleanup Options
                </div>
                {(
                  Object.keys(CLEANUP_LABELS) as (keyof CleanupOptions)[]
                ).map((key) => (
                  <label
                    key={key}
                    className="flex items-start gap-2 py-1 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={cleanupOpts[key]}
                      onChange={(e) =>
                        setCleanupOpts((o) => ({
                          ...o,
                          [key]: e.target.checked,
                        }))
                      }
                      className="mt-0.5"
                    />
                    <span className="text-xs text-neutral-300">
                      {CLEANUP_LABELS[key]}
                    </span>
                  </label>
                ))}
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={handleCleanup}
                    className="px-3 py-1.5 text-xs rounded bg-amber-600 hover:bg-amber-500 font-medium"
                  >
                    Apply to this page
                  </button>
                  <button
                    onClick={() => handleCleanupAll(cleanupOpts)}
                    className="px-3 py-1.5 text-xs rounded bg-neutral-600 hover:bg-neutral-500 font-medium"
                  >
                    Quick clean
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Image placeholder */}
          <button
            onClick={insertImagePlaceholder}
            disabled={!pageData}
            title="Insert [IMAGE] placeholder at cursor"
            className="px-2 py-1 text-xs rounded bg-neutral-700 hover:bg-neutral-600 disabled:opacity-30"
          >
            [IMG]
          </button>

          {/* Undo */}
          <button
            onClick={onUndo}
            disabled={!pageData?.history.length}
            title="Undo last OCR/paste/cleanup"
            className="px-2 py-1 text-xs rounded bg-neutral-700 hover:bg-neutral-600 disabled:opacity-30"
          >
            Undo
          </button>
        </div>
      </div>

      {/* Text editor */}
      <div className="flex-1 overflow-hidden">
        <textarea
          ref={textareaRef}
          value={pageData?.ocrText ?? ""}
          onChange={(e) => onTextChange(e.target.value)}
          placeholder={
            "OCR text will appear here.\n\nOptions:\n• Paste — paste text from macOS Preview (⌘A → ⌘C in Preview, then Paste here)\n• OCR — run Tesseract (local) or Gemini Vision (API)\n• Cleanup — fix spacing, OCR artifacts\n• [IMG] — mark a region as an image"
          }
          className="w-full h-full p-4 bg-neutral-950 text-neutral-100 resize-none font-mono text-sm leading-relaxed focus:outline-none placeholder:text-neutral-600"
          spellCheck={false}
        />
      </div>

      {/* Footer status */}
      {pageData && (
        <div className="flex items-center justify-between px-3 py-1.5 border-t border-neutral-700 bg-neutral-800 shrink-0 text-xs text-neutral-500">
          <span>
            {pageData.ocrText.length} chars ·{" "}
            {pageData.ocrText.split(/\n/).length} lines
          </span>
          {pageData.history.length > 0 && (
            <span>
              {pageData.history.length} undo step
              {pageData.history.length > 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
