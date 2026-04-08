"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { PageData, OcrSource } from "@/lib/types";
import {
  cleanupText,
  DEFAULT_CLEANUP,
  CLEANUP_LABELS,
  type CleanupOptions,
} from "@/lib/text-cleanup";
import { computeLineDiff } from "@/lib/diff-utils";

interface OcrEditorProps {
  pageData: PageData | null;
  currentPage: number;
  totalPages: number;
  isOcrRunning: boolean;
  allPages: PageData[];
  onTextChange: (text: string, source?: OcrSource) => void;
  onOcrPage: (method: "tesseract" | "gemini" | "glm-ocr") => void;
  onOcrAll: (method: "tesseract" | "gemini" | "glm-ocr", overwrite?: boolean) => void;
  onPaste: () => void;
  onUndo: () => void;
  onCleanupAll: (opts: CleanupOptions) => void;
}

function sourceLabel(source: OcrSource | null): string {
  if (!source) return "empty";
  const labels: Record<OcrSource, string> = {
    tesseract: "Tesseract",
    gemini: "Gemini",
    "glm-ocr": "GLM-OCR",
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
    "glm-ocr": "bg-rose-800",
    pasted: "bg-blue-800",
    manual: "bg-amber-800",
  };
  return colors[source];
}

// Hook for dropdown keyboard navigation + click-outside
function useDropdown(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!ref.current) return;
      const items = ref.current.querySelectorAll<HTMLElement>(
        "[data-dropdown-item]"
      );
      if (items.length === 0) return;

      const currentIndex = Array.from(items).indexOf(
        document.activeElement as HTMLElement
      );

      switch (e.key) {
        case "Escape":
        case "Tab":
          e.preventDefault();
          onClose();
          break;
        case "ArrowDown":
          e.preventDefault();
          items[currentIndex < items.length - 1 ? currentIndex + 1 : 0]?.focus();
          break;
        case "ArrowUp":
          e.preventDefault();
          items[
            currentIndex > 0 ? currentIndex - 1 : items.length - 1
          ]?.focus();
          break;
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return ref;
}

export default function OcrEditor({
  pageData,
  currentPage,
  totalPages,
  isOcrRunning,
  allPages,
  onTextChange,
  onOcrPage,
  onOcrAll,
  onPaste,
  onUndo,
  onCleanupAll,
}: OcrEditorProps) {
  const [showOcrMenu, setShowOcrMenu] = useState(false);
  const [showCleanup, setShowCleanup] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [cleanupOpts, setCleanupOpts] =
    useState<CleanupOptions>(DEFAULT_CLEANUP);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const copyToClipboard = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback(label);
      setTimeout(() => setCopyFeedback(null), 1500);
    } catch {
      alert("Clipboard access denied. Please allow clipboard access in your browser settings.");
    }
  }, []);

  const handleCopyPage = useCallback(() => {
    if (pageData?.ocrText) copyToClipboard(pageData.ocrText, "Page copied");
  }, [pageData, copyToClipboard]);

  const handleCopyAll = useCallback(() => {
    const allText = allPages
      .map((p, i) => p.ocrText ? `--- Page ${i + 1} ---\n${p.ocrText}` : null)
      .filter(Boolean)
      .join("\n\n");
    if (allText) copyToClipboard(allText, "All pages copied");
  }, [allPages, copyToClipboard]);

  const closeOcrMenu = useCallback(() => setShowOcrMenu(false), []);
  const closeCleanup = useCallback(() => setShowCleanup(false), []);
  const ocrMenuRef = useDropdown(closeOcrMenu);
  const cleanupMenuRef = useDropdown(closeCleanup);

  const handleCleanup = () => {
    if (!pageData?.ocrText) return;
    const cleaned = cleanupText(pageData.ocrText, cleanupOpts);
    if (cleaned !== pageData.ocrText) {
      onTextChange(cleaned, "manual");
    }
    setShowCleanup(false);
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
    setTimeout(() => {
      ta.focus();
      ta.selectionStart = start + 9;
      ta.selectionEnd = start + 9 + 16;
    }, 0);
  };

  // Diff computation
  const lastHistory = pageData?.history[pageData.history.length - 1];
  const canShowDiff = !!(lastHistory && pageData?.ocrText);
  const diff =
    showDiff && canShowDiff
      ? computeLineDiff(lastHistory!.text, pageData!.ocrText)
      : null;

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
          <button
            onClick={onPaste}
            title="Paste from clipboard (e.g. macOS Preview)"
            className="px-2 py-1 text-xs rounded bg-blue-700 hover:bg-blue-600"
          >
            Paste
          </button>

          {/* OCR dropdown */}
          <div className="relative" ref={ocrMenuRef}>
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
              <div
                className="absolute right-0 top-full mt-1 bg-neutral-800 border border-neutral-600 rounded shadow-xl z-20 min-w-[200px]"
                role="menu"
              >
                <div className="px-3 py-1.5 text-xs text-neutral-500 font-medium">
                  Tesseract (local)
                </div>
                <button
                  data-dropdown-item
                  role="menuitem"
                  onClick={() => {
                    onOcrPage("tesseract");
                    setShowOcrMenu(false);
                  }}
                  className="block w-full text-left px-3 py-2 text-xs hover:bg-neutral-700 focus:bg-neutral-700 focus:outline-none"
                >
                  This page
                </button>
                <button
                  data-dropdown-item
                  role="menuitem"
                  onClick={() => {
                    onOcrAll("tesseract", false);
                    setShowOcrMenu(false);
                  }}
                  className="block w-full text-left px-3 py-2 text-xs hover:bg-neutral-700 focus:bg-neutral-700 focus:outline-none"
                >
                  Empty pages only
                </button>
                <button
                  data-dropdown-item
                  role="menuitem"
                  onClick={() => {
                    onOcrAll("tesseract", true);
                    setShowOcrMenu(false);
                  }}
                  className="block w-full text-left px-3 py-2 text-xs hover:bg-neutral-700 focus:bg-neutral-700 focus:outline-none text-orange-400"
                >
                  All {totalPages} pages (overwrite)
                </button>
                <hr className="border-neutral-700 my-1" />
                <div className="px-3 py-1.5 text-xs text-neutral-500 font-medium">
                  Gemini Vision (API)
                </div>
                <button
                  data-dropdown-item
                  role="menuitem"
                  onClick={() => {
                    onOcrPage("gemini");
                    setShowOcrMenu(false);
                  }}
                  className="block w-full text-left px-3 py-2 text-xs hover:bg-neutral-700 focus:bg-neutral-700 focus:outline-none"
                >
                  This page
                </button>
                <button
                  data-dropdown-item
                  role="menuitem"
                  onClick={() => {
                    onOcrAll("gemini", false);
                    setShowOcrMenu(false);
                  }}
                  className="block w-full text-left px-3 py-2 text-xs hover:bg-neutral-700 focus:bg-neutral-700 focus:outline-none"
                >
                  Empty pages only
                </button>
                <button
                  data-dropdown-item
                  role="menuitem"
                  onClick={() => {
                    onOcrAll("gemini", true);
                    setShowOcrMenu(false);
                  }}
                  className="block w-full text-left px-3 py-2 text-xs hover:bg-neutral-700 focus:bg-neutral-700 focus:outline-none text-orange-400"
                >
                  All {totalPages} pages (overwrite)
                </button>
                <hr className="border-neutral-700 my-1" />
                <div className="px-3 py-1.5 text-xs text-neutral-500 font-medium">
                  GLM-OCR (local) — tables, formulas, layouts
                </div>
                <button
                  data-dropdown-item
                  role="menuitem"
                  onClick={() => {
                    onOcrPage("glm-ocr");
                    setShowOcrMenu(false);
                  }}
                  className="block w-full text-left px-3 py-2 text-xs hover:bg-neutral-700 focus:bg-neutral-700 focus:outline-none"
                >
                  This page
                </button>
                <button
                  data-dropdown-item
                  role="menuitem"
                  onClick={() => {
                    onOcrAll("glm-ocr", false);
                    setShowOcrMenu(false);
                  }}
                  className="block w-full text-left px-3 py-2 text-xs hover:bg-neutral-700 focus:bg-neutral-700 focus:outline-none"
                >
                  Empty pages only
                </button>
                <button
                  data-dropdown-item
                  role="menuitem"
                  onClick={() => {
                    onOcrAll("glm-ocr", true);
                    setShowOcrMenu(false);
                  }}
                  className="block w-full text-left px-3 py-2 text-xs hover:bg-neutral-700 focus:bg-neutral-700 focus:outline-none text-orange-400"
                >
                  All {totalPages} pages (overwrite)
                </button>
              </div>
            )}
          </div>

          {/* Cleanup dropdown */}
          <div className="relative" ref={cleanupMenuRef}>
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
                <div className="flex gap-2 mt-3 flex-wrap">
                  <button
                    data-dropdown-item
                    onClick={handleCleanup}
                    className="px-3 py-1.5 text-xs rounded bg-amber-600 hover:bg-amber-500 font-medium"
                  >
                    This page
                  </button>
                  <button
                    data-dropdown-item
                    onClick={() => {
                      onCleanupAll(cleanupOpts);
                      setShowCleanup(false);
                    }}
                    className="px-3 py-1.5 text-xs rounded bg-amber-800 hover:bg-amber-700 font-medium"
                  >
                    All pages
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Diff toggle */}
          <button
            onClick={() => setShowDiff(!showDiff)}
            disabled={!canShowDiff}
            title="Show diff vs previous version"
            className={`px-2 py-1 text-xs rounded disabled:opacity-30 ${
              showDiff
                ? "bg-indigo-600 hover:bg-indigo-500"
                : "bg-neutral-700 hover:bg-neutral-600"
            }`}
          >
            Diff
          </button>

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

          {/* Copy buttons */}
          <button
            onClick={handleCopyPage}
            disabled={!pageData?.ocrText}
            title="Copy current page text to clipboard"
            className="px-2 py-1 text-xs rounded bg-neutral-700 hover:bg-neutral-600 disabled:opacity-30"
          >
            Copy Page
          </button>
          <button
            onClick={handleCopyAll}
            disabled={!allPages.some((p) => p.ocrText)}
            title="Copy all pages text to clipboard"
            className="px-2 py-1 text-xs rounded bg-neutral-700 hover:bg-neutral-600 disabled:opacity-30"
          >
            Copy All
          </button>
          {copyFeedback && (
            <span className="text-xs text-green-400">{copyFeedback}</span>
          )}
        </div>
      </div>

      {/* Editor area */}
      <div className="flex-1 overflow-hidden">
        {showDiff && diff ? (
          /* Diff view */
          <div className="flex h-full">
            <div className="w-1/2 border-r border-neutral-800 overflow-auto">
              <div className="px-2 py-1 bg-neutral-800 text-xs text-neutral-400 font-medium sticky top-0 border-b border-neutral-700">
                Previous ({sourceLabel(lastHistory?.source ?? null)})
              </div>
              <div className="p-2 font-mono text-xs leading-relaxed">
                {diff.left.map((line, i) => (
                  <div
                    key={i}
                    className={`px-1 ${
                      line.type === "removed"
                        ? "bg-red-950 text-red-300"
                        : line.text === ""
                          ? "h-[1.375rem]"
                          : "text-neutral-400"
                    }`}
                  >
                    {line.text || "\u00A0"}
                  </div>
                ))}
              </div>
            </div>
            <div className="w-1/2 overflow-auto">
              <div className="px-2 py-1 bg-neutral-800 text-xs text-neutral-400 font-medium sticky top-0 border-b border-neutral-700">
                Current ({sourceLabel(pageData?.source ?? null)})
              </div>
              <div className="p-2 font-mono text-xs leading-relaxed">
                {diff.right.map((line, i) => (
                  <div
                    key={i}
                    className={`px-1 ${
                      line.type === "added"
                        ? "bg-green-950 text-green-300"
                        : line.text === ""
                          ? "h-[1.375rem]"
                          : "text-neutral-300"
                    }`}
                  >
                    {line.text || "\u00A0"}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* Normal editor */
          <textarea
            ref={textareaRef}
            value={pageData?.ocrText ?? ""}
            onChange={(e) => onTextChange(e.target.value)}
            placeholder={
              "OCR text will appear here.\n\nOptions:\n\u2022 Paste \u2014 paste text from macOS Preview (\u2318A \u2192 \u2318C in Preview, then Paste here)\n\u2022 OCR \u2014 run Tesseract (local) or Gemini Vision (API)\n\u2022 Cleanup \u2014 fix spacing, OCR artifacts\n\u2022 [IMG] \u2014 mark a region as an image"
            }
            className="w-full h-full p-4 bg-neutral-950 text-neutral-100 resize-none font-mono text-sm leading-relaxed focus:outline-none placeholder:text-neutral-600"
            spellCheck={false}
          />
        )}
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
