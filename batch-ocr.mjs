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
import { execSync } from "child_process";
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
// Large PDF threshold: skip .pdfws (base64-embedded) for files over this size
const LARGE_PDF_BYTES = 50 * 1024 * 1024; // 50 MB

// Check if PyMuPDF is available for fallback rendering
function hasPyMuPDF() {
  try {
    execSync('python3 -c "import fitz"', { stdio: "ignore" });
    return true;
  } catch {
    try {
      execSync('python3 -c "import pymupdf"', { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
}

// Render pages to images using PyMuPDF (fallback when pdfjs canvas fails)
function renderPagesWithPyMuPDF(pdfPath, tmpDir) {
  const scriptPath = path.join(path.dirname(new URL(import.meta.url).pathname), "pdf-to-images.py");
  const output = execSync(`python3 "${scriptPath}" "${pdfPath}" "${tmpDir}" --dpi 200`, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  const lines = output.trim().split("\n");
  const numPages = parseInt(lines[0], 10);
  const pageImages = [];
  for (let i = 1; i < lines.length; i++) {
    const [pageNum, imgPath] = lines[i].split("|");
    pageImages.push({ pageNum: parseInt(pageNum, 10), imgPath });
  }
  return { numPages, pageImages };
}

async function processPdf(pdfPath, outputDir) {
  const baseName = path.basename(pdfPath, ".pdf");
  const fileSize = fs.statSync(pdfPath).size;
  const isLarge = fileSize > LARGE_PDF_BYTES;

  if (isLarge) {
    console.log(`\n--- ${baseName}.pdf --- (${(fileSize / 1024 / 1024).toFixed(0)} MB — large PDF mode)`);
  } else {
    console.log(`\n--- ${baseName}.pdf ---`);
  }

  // Try pdfjs first, fall back to PyMuPDF if canvas rendering fails
  let numPages = 0;
  let usePyMuPDF = false;
  let pdfjsDoc = null;
  const tmpImgDir = path.join(outputDir, "_page_images");

  try {
    const pdfBuffer = fs.readFileSync(pdfPath);
    const pdfDataForPdfjs = Uint8Array.from(pdfBuffer);
    pdfjsDoc = await getDocument({ data: pdfDataForPdfjs, useSystemFonts: true }).promise;
    numPages = pdfjsDoc.numPages;
    console.log(`  ${numPages} pages`);

    // Test render page 1 to detect canvas issues early
    await renderPageToBase64(pdfjsDoc, 1);
  } catch (err) {
    if (pdfjsDoc) { try { pdfjsDoc.destroy(); } catch {} }
    pdfjsDoc = null;
    console.log(`  pdfjs rendering failed: ${err.message.split("\n")[0]}`);

    if (hasPyMuPDF()) {
      console.log(`  Falling back to PyMuPDF for page rendering...`);
      usePyMuPDF = true;
      const result = renderPagesWithPyMuPDF(pdfPath, tmpImgDir);
      numPages = result.numPages;
      console.log(`  ${numPages} pages (via PyMuPDF)`);
    } else {
      console.error("  ERROR: PyMuPDF not available. Install: pip3 install pymupdf");
      throw err;
    }
  }

  const pages = [];
  let backend = null;

  for (let i = 1; i <= numPages; i++) {
    process.stdout.write(`  Page ${i}/${numPages}...`);

    let base64;
    if (usePyMuPDF) {
      // Read the pre-rendered PNG from PyMuPDF
      const imgPath = path.join(tmpImgDir, `page_${String(i).padStart(4, "0")}.png`);
      if (fs.existsSync(imgPath)) {
        base64 = fs.readFileSync(imgPath).toString("base64");
      } else {
        process.stdout.write(` MISSING IMAGE\n`);
        pages.push({ pageNumber: i, ocrText: "", source: null, history: [] });
        continue;
      }
    } else {
      try {
        base64 = await renderPageToBase64(pdfjsDoc, i);
      } catch (err) {
        // If pdfjs fails mid-way, switch to PyMuPDF for remaining pages
        if (!usePyMuPDF && hasPyMuPDF()) {
          console.log(`\n  pdfjs failed on page ${i}, switching to PyMuPDF...`);
          if (pdfjsDoc) { try { pdfjsDoc.destroy(); } catch {} pdfjsDoc = null; }
          usePyMuPDF = true;
          renderPagesWithPyMuPDF(pdfPath, tmpImgDir);
          const imgPath = path.join(tmpImgDir, `page_${String(i).padStart(4, "0")}.png`);
          base64 = fs.existsSync(imgPath) ? fs.readFileSync(imgPath).toString("base64") : null;
        }
        if (!base64) {
          process.stdout.write(` RENDER FAILED\n`);
          pages.push({ pageNumber: i, ocrText: "", source: null, history: [] });
          continue;
        }
      }
    }

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
      pages.push({ pageNumber: i, ocrText: "", source: null, history: [] });
    }
  }

  if (pdfjsDoc) pdfjsDoc.destroy();

  // Clean up temp images
  if (fs.existsSync(tmpImgDir)) {
    fs.rmSync(tmpImgDir, { recursive: true, force: true });
  }

  // Save OCR PDF (re-read the file fresh for pdf-lib — avoids detached buffer)
  const ocrPdfPath = path.join(outputDir, `${baseName}_ocr.pdf`);
  const freshPdfBytes = Uint8Array.from(fs.readFileSync(pdfPath));
  const ocrPdfBytes = await buildOcrPdf(freshPdfBytes, pages);
  fs.writeFileSync(ocrPdfPath, ocrPdfBytes);
  console.log(`  Saved: ${ocrPdfPath}`);

  // Save .pdfws project (skip for large PDFs — base64 embedding would be too big)
  if (!isLarge) {
    const project = {
      version: 1,
      fileName: `${baseName}.pdf`,
      totalPages: numPages,
      pages,
      ocrLanguages: ["eng"],
      pdfBase64: arrayBufferToBase64(pdfBuffer),
      savedAt: new Date().toISOString(),
    };
    const projectPath = path.join(outputDir, `${baseName}.pdfws`);
    fs.writeFileSync(projectPath, JSON.stringify(project));
    console.log(`  Saved: ${projectPath}`);
  } else {
    console.log(`  Skipped .pdfws (file too large for base64 embedding)`);
  }

  // Always save plain text extract
  const txtPath = path.join(outputDir, `${baseName}.txt`);
  const txt = pages
    .map((pg) => `=== Page ${pg.pageNumber} ===\n${pg.ocrText || ""}`)
    .join("\n\n");
  fs.writeFileSync(txtPath, txt);
  console.log(`  Saved: ${txtPath}`);
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
