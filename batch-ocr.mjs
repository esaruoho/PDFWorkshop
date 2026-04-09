#!/usr/bin/env node
/**
 * Batch OCR — headless GLM-OCR for all PDFs in a folder.
 *
 * Usage:
 *   node batch-ocr.mjs /path/to/pdf-folder [--output /path/to/output]
 *
 * Requires GLM-OCR running locally (MLX on :8080 or Ollama on :11434).
 * Produces for each PDF:
 *   - <name>_ocr.pdf   (original PDF with invisible OCR text layer)
 *   - <name>.pdfws     (project file, reloadable in PDF Workshop)
 */

import fs from "fs";
import path from "path";
import { createCanvas } from "canvas";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

// Disable worker for Node.js — point to actual worker file
import { fileURLToPath } from "url";
import { createRequire } from "module";
const __require = createRequire(import.meta.url);
const workerPath = __require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
GlobalWorkerOptions.workerSrc = new URL(`file://${workerPath}`).href;

// --- Config ---
const MLX_URL = "http://localhost:8080/chat/completions";
const OLLAMA_URL = "http://localhost:11434/api/generate";
const OCR_PROMPT =
  "OCR this image. Extract ALL text preserving the original formatting, paragraphs, tables, and formulas. Output only the extracted text.";

// --- Helpers ---
function arrayBufferToBase64(buffer) {
  return Buffer.from(buffer).toString("base64");
}

async function renderPageToBase64(pdfDoc, pageNum, scale = 2) {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext("2d");

  await page.render({
    canvasContext: ctx,
    viewport,
  }).promise;

  // canvas.toBuffer returns a PNG Buffer
  return canvas.toBuffer("image/png").toString("base64");
}

async function tryMlx(base64Data) {
  try {
    const res = await fetch(MLX_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "mlx-community/GLM-OCR-bf16",
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: `data:image/png;base64,${base64Data}` } },
              { type: "text", text: OCR_PROMPT },
            ],
          },
        ],
        max_tokens: 8192,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

async function tryOllama(base64Data) {
  try {
    const res = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "glm-ocr:latest",
        prompt: OCR_PROMPT,
        images: [base64Data],
        stream: false,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.response ?? null;
  } catch {
    return null;
  }
}

async function ocrPage(base64Data) {
  const mlxResult = await tryMlx(base64Data);
  if (mlxResult) return { text: mlxResult, backend: "mlx" };

  const ollamaResult = await tryOllama(base64Data);
  if (ollamaResult) return { text: ollamaResult, backend: "ollama" };

  return null;
}

async function buildOcrPdf(pdfBytes, pages) {
  const srcDoc = await PDFDocument.load(pdfBytes);
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
        if (line.trim().startsWith("[IMAGE")) continue;
        let safeLine = line;
        try {
          font.encodeText(line);
        } catch {
          safeLine = line
            .split("")
            .filter((ch) => {
              try { font.encodeText(ch); return true; } catch { return false; }
            })
            .join("");
        }
        if (!safeLine) continue;
        page.drawText(safeLine, { x: 10, y, size: fontSize, font, color: rgb(0, 0, 0), opacity: 0.01 });
        y -= fontSize + 1;
      }
    }
  }

  return await exportDoc.save();
}

// --- Main ---
async function processPdf(pdfPath, outputDir) {
  const baseName = path.basename(pdfPath, ".pdf");
  const pdfBytes = fs.readFileSync(pdfPath);
  const pdfData = new Uint8Array(pdfBytes);

  console.log(`\n--- ${baseName}.pdf ---`);

  const doc = await getDocument({ data: pdfData, useSystemFonts: true }).promise;
  const numPages = doc.numPages;
  console.log(`  ${numPages} pages`);

  const pages = [];
  let backend = null;

  for (let i = 1; i <= numPages; i++) {
    process.stdout.write(`  Page ${i}/${numPages}...`);
    const base64 = await renderPageToBase64(doc, i);
    const result = await ocrPage(base64);

    if (result) {
      if (!backend) backend = result.backend;
      const chars = result.text.length;
      process.stdout.write(` ${chars} chars (${result.backend})\n`);
      pages.push({
        pageNumber: i,
        ocrText: result.text,
        source: "glm-ocr",
        history: [],
      });
    } else {
      process.stdout.write(` FAILED\n`);
      pages.push({
        pageNumber: i,
        ocrText: "",
        source: null,
        history: [],
      });
    }
  }

  // Save OCR PDF
  const ocrPdfPath = path.join(outputDir, `${baseName}_ocr.pdf`);
  const ocrPdfBytes = await buildOcrPdf(pdfData, pages);
  fs.writeFileSync(ocrPdfPath, ocrPdfBytes);
  console.log(`  Saved: ${ocrPdfPath}`);

  // Save .pdfws project
  const project = {
    version: 1,
    fileName: `${baseName}.pdf`,
    totalPages: numPages,
    pages,
    ocrLanguages: ["eng"],
    pdfBase64: arrayBufferToBase64(pdfData),
    savedAt: new Date().toISOString(),
  };
  const projectPath = path.join(outputDir, `${baseName}.pdfws`);
  fs.writeFileSync(projectPath, JSON.stringify(project));
  console.log(`  Saved: ${projectPath}`);

  doc.destroy();
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: ./ocr <file.pdf | folder> [--output <output-folder>]");
    process.exit(1);
  }

  const input = path.resolve(args[0]);
  const outIdx = args.indexOf("--output");
  let outputDir = outIdx !== -1 && args[outIdx + 1] ? path.resolve(args[outIdx + 1]) : null;

  if (!fs.existsSync(input)) {
    console.error(`Not found: ${input}`);
    process.exit(1);
  }

  const stat = fs.statSync(input);
  let pdfFiles;

  if (stat.isFile()) {
    if (!input.toLowerCase().endsWith(".pdf")) {
      console.error("Not a PDF file:", input);
      process.exit(1);
    }
    pdfFiles = [input];
    if (!outputDir) outputDir = path.dirname(input);
  } else {
    pdfFiles = fs.readdirSync(input)
      .filter((f) => f.toLowerCase().endsWith(".pdf"))
      .sort()
      .map((f) => path.join(input, f));
    if (!outputDir) outputDir = input;
  }

  if (pdfFiles.length === 0) {
    console.error("No PDF files found.");
    process.exit(1);
  }

  fs.mkdirSync(outputDir, { recursive: true });

  // Check GLM-OCR server availability (lightweight health checks)
  let testMlx = false;
  let testOllama = false;
  try {
    const r = await fetch("http://localhost:8080/v1/models", { signal: AbortSignal.timeout(5000) });
    testMlx = r.ok;
  } catch {}
  if (!testMlx) {
    try {
      const r = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        const d = await r.json();
        testOllama = d.models?.some(m => m.name?.includes("glm-ocr")) ?? false;
      }
    } catch {}
  }

  if (!testMlx && !testOllama) {
    console.error("No GLM-OCR server found. Start MLX (port 8080) or Ollama (port 11434) first.");
    console.error("  MLX:    ./start.sh (auto-starts MLX server)");
    console.error("  Ollama: ollama pull glm-ocr:latest && ollama serve");
    process.exit(1);
  }

  console.log(`GLM-OCR backend: ${testMlx ? "MLX (:8080)" : "Ollama (:11434)"}`);
  console.log(`Input:  ${stat.isFile() ? input : input + "/"}`);
  console.log(`Output: ${outputDir}`);
  console.log(`Found ${pdfFiles.length} PDF(s)`);

  for (const pdf of pdfFiles) {
    await processPdf(pdf, outputDir);
  }

  console.log(`\nDone! Processed ${pdfFiles.length} PDF(s).`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
