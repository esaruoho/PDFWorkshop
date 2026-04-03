"use client";

import { useEffect, useState, useCallback } from "react";

interface CapturedError {
  message: string;
  stack: string;
  source: string;
  timestamp: number;
}

export default function ErrorOverlay() {
  const [errors, setErrors] = useState<CapturedError[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      setErrors((prev) => [
        ...prev,
        {
          message: event.message,
          stack: event.error?.stack ?? "",
          source: `${event.filename}:${event.lineno}:${event.colno}`,
          timestamp: Date.now(),
        },
      ]);
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const err = event.reason;
      setErrors((prev) => [
        ...prev,
        {
          message: err?.message ?? String(err),
          stack: err?.stack ?? "",
          source: "unhandled promise rejection",
          timestamp: Date.now(),
        },
      ]);
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  const formatErrors = useCallback(() => {
    return errors
      .map(
        (e) =>
          `[${new Date(e.timestamp).toLocaleTimeString()}] ${e.message}\nSource: ${e.source}\n${e.stack}`
      )
      .join("\n\n---\n\n");
  }, [errors]);

  const copyToClipboard = useCallback(async () => {
    await navigator.clipboard.writeText(formatErrors());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [formatErrors]);

  const dismiss = useCallback(() => setErrors([]), []);

  if (errors.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-md">
      <div className="bg-red-950 border border-red-800 rounded-lg shadow-2xl p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-red-400">
            {errors.length} error{errors.length > 1 ? "s" : ""}
          </span>
          <div className="flex gap-1">
            <button
              onClick={copyToClipboard}
              className="px-2 py-1 text-xs rounded bg-red-800 hover:bg-red-700 text-red-200"
            >
              {copied ? "Copied!" : "Copy errors"}
            </button>
            <button
              onClick={dismiss}
              className="px-2 py-1 text-xs rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
            >
              Dismiss
            </button>
          </div>
        </div>
        <div className="max-h-32 overflow-auto text-xs text-red-300 font-mono whitespace-pre-wrap">
          {errors[errors.length - 1].message}
        </div>
      </div>
    </div>
  );
}
