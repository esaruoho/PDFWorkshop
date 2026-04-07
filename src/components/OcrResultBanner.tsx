"use client";

import type { OcrSource } from "@/lib/types";

export interface OcrResult {
  failedPages: number[];
  suspiciousPages: number[];
  originalMethod: string;
  totalProcessed: number;
}

export interface RetryResult {
  recovered: number;
  stillEmpty: number[];
}

interface OcrResultBannerProps {
  result: OcrResult | null;
  retryResult: RetryResult | null;
  isRetrying: boolean;
  onRetry: (method: "tesseract" | "gemini" | "glm-ocr") => void;
  onGoToPage: (page: number) => void;
  onDismiss: () => void;
}

const ENGINE_LABELS: Record<string, string> = {
  tesseract: "Tesseract",
  gemini: "Gemini Vision",
  "glm-ocr": "GLM-OCR",
};

const ALL_ENGINES: ("tesseract" | "gemini" | "glm-ocr")[] = [
  "tesseract",
  "gemini",
  "glm-ocr",
];

export default function OcrResultBanner({
  result,
  retryResult,
  isRetrying,
  onRetry,
  onGoToPage,
  onDismiss,
}: OcrResultBannerProps) {
  if (!result) return null;

  const { failedPages, suspiciousPages, originalMethod, totalProcessed } =
    result;
  const hasIssues =
    failedPages.length > 0 || suspiciousPages.length > 0;
  const retryEngines = ALL_ENGINES.filter((e) => e !== originalMethod);

  if (!hasIssues && !retryResult) {
    // All good — show brief success, auto-dismiss after 3s
    return (
      <div className="mx-4 mt-2 p-3 rounded-lg bg-emerald-950 border border-emerald-800 flex items-center justify-between">
        <span className="text-sm text-emerald-300">
          {originalMethod === "cleanup" ? "Cleanup" : "OCR"} complete — {totalProcessed} page
          {totalProcessed !== 1 ? "s" : ""} processed.
        </span>
        <button
          onClick={onDismiss}
          className="text-xs text-emerald-500 hover:text-emerald-400 ml-4"
        >
          Dismiss
        </button>
      </div>
    );
  }

  return (
    <div className="mx-4 mt-2 p-3 rounded-lg bg-amber-950 border border-amber-800">
      {/* Failed pages */}
      {failedPages.length > 0 && (
        <div className="mb-2">
          <span className="text-sm text-red-400 font-medium">
            OCR failed on {failedPages.length} page
            {failedPages.length > 1 ? "s" : ""}:{" "}
          </span>
          <span className="text-sm text-red-300">
            {failedPages.map((p, i) => (
              <span key={p}>
                {i > 0 && ", "}
                <button
                  onClick={() => onGoToPage(p)}
                  className="underline hover:text-red-200"
                >
                  {p}
                </button>
              </span>
            ))}
          </span>
        </div>
      )}

      {/* Suspicious pages */}
      {suspiciousPages.length > 0 && !retryResult && (
        <div className="mb-3">
          <div className="text-sm text-amber-300 mb-1">
            <span className="font-medium">
              {suspiciousPages.length} page
              {suspiciousPages.length > 1 ? "s have" : " has"} visible content
              but empty OCR text:{" "}
            </span>
            {suspiciousPages.map((p, i) => (
              <span key={p}>
                {i > 0 && ", "}
                <button
                  onClick={() => onGoToPage(p)}
                  className="underline hover:text-amber-200"
                >
                  {p}
                </button>
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-xs text-amber-400">Retry with:</span>
            {retryEngines.map((engine) => (
              <button
                key={engine}
                onClick={() => onRetry(engine)}
                disabled={isRetrying}
                className="px-3 py-1.5 text-xs rounded bg-amber-700 hover:bg-amber-600 disabled:opacity-50 font-medium"
              >
                {isRetrying ? "Retrying..." : ENGINE_LABELS[engine]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Retry result */}
      {retryResult && (
        <div className="mb-2">
          <span className="text-sm text-emerald-400">
            Retry recovered {retryResult.recovered} page
            {retryResult.recovered !== 1 ? "s" : ""}.
          </span>
          {retryResult.stillEmpty.length > 0 && (
            <span className="text-sm text-amber-300">
              {" "}
              Still empty:{" "}
              {retryResult.stillEmpty.map((p, i) => (
                <span key={p}>
                  {i > 0 && ", "}
                  <button
                    onClick={() => onGoToPage(p)}
                    className="underline hover:text-amber-200"
                  >
                    {p}
                  </button>
                </span>
              ))}
              . Try a different engine or edit manually.
            </span>
          )}
        </div>
      )}

      {/* Dismiss */}
      <div className="flex justify-end">
        <button
          onClick={onDismiss}
          className="text-xs text-neutral-400 hover:text-neutral-300"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
