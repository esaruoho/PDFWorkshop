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
import os from "os";
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
// The MLX VISION server (Metal GPU), :8081 — NOT :8080. :8080 runs mlx_lm.server (TEXT,
// Qwen3-14B-MLX-4bit); it advertises GLM-OCR in /v1/models but cannot serve a vision model,
// so asking it silently dropped every OCR through to Ollama-on-CPU (0 OK / 119 FAILED,
// ~6 cores for 4.5h, 2026-08-11). Vision lives on :8081 via mlx_vlm.server.
const MLX_URL = process.env.OCR_MLX_URL || "http://localhost:8081/chat/completions";
const OLLAMA_URL = process.env.OCR_OLLAMA_URL || "http://localhost:11434/api/generate";
const OCR_PROMPT =
  "OCR this image. Extract ALL text preserving the original formatting, paragraphs, tables, and formulas. Output only the extracted text.";
const HEARTBEAT_PATH = path.join(
  process.env.HOME || "/Users/esaruoho",
  "work/comms/queue/ocr-heartbeat.json",
);

const HOST = os.hostname().split(".")[0];

function writeHeartbeat(state) {
  try {
    // Stamp host so fleet peers attribute this OCR job to its real machine —
    // the heartbeat is Syncthing-shared, so without it every Mac claims it.
    state.host = HOST;
    fs.writeFileSync(HEARTBEAT_PATH, JSON.stringify(state, null, 2) + "\n");
  } catch {
    // Heartbeat is best-effort; never fail a job because of it
  }
}

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
    if (!res.ok) return { text: null, error: `HTTP ${res.status} ${res.statusText}` };
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content ?? null;
    return { text, error: text ? null : "empty completion" };
  } catch (e) {
    return { text: null, error: `${e.name}: ${e.message}` };
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
    if (!res.ok) return { text: null, error: `HTTP ${res.status} ${res.statusText}` };
    const data = await res.json();
    const text = data.response ?? null;
    return { text, error: text ? null : "empty response" };
  } catch (e) {
    return { text: null, error: `${e.name}: ${e.message}` };
  }
}

// How many times a single page is retried before it is given up on, and how many
// CONSECUTIVE pages may be given up on before the whole run aborts.
//
// 2026-08-11: a 160-page book ran for 4.5 HOURS producing 0 OK / 119 FAILED, pinning
// ~6 CPU cores the entire time, because (a) every page got exactly one attempt, (b) the
// backends swallowed their errors with a bare `catch { return null }`, so the log said
// only "FAILED" with no reason, and (c) nothing ever gave up — it would happily have
// burned all 160 pages to write an empty file. A broken backend is now detected in
// ~25 failed calls instead of ~160, and the REASON is printed.
const MAX_PAGE_ATTEMPTS = Number(process.env.OCR_PAGE_ATTEMPTS || 5);
const ABORT_AFTER_CONSECUTIVE_FAILS = Number(process.env.OCR_ABORT_AFTER || 5);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ocrPage(base64Data) {
  let lastError = "unknown";
  for (let attempt = 1; attempt <= MAX_PAGE_ATTEMPTS; attempt++) {
    const mlx = await tryMlx(base64Data);
    if (mlx.text) return { text: mlx.text, backend: "mlx", attempts: attempt };

    const ollama = await tryOllama(base64Data);
    if (ollama.text) return { text: ollama.text, backend: "ollama", attempts: attempt };

    lastError = `mlx: ${mlx.error} | ollama: ${ollama.error}`;
    // Back off a little between attempts — a model still loading, or a transient
    // out-of-memory, is worth waiting for; hammering it instantly is not.
    if (attempt < MAX_PAGE_ATTEMPTS) await sleep(1000 * attempt);
  }
  return { text: null, error: lastError, attempts: MAX_PAGE_ATTEMPTS };
}

async function buildOcrPdf(pdfBytes, pages) {
  // Build the searchable PDF with PyMuPDF (fitz), NOT pdf-lib copyPages.
  // pdf-lib copyPages corrupts CCITTFax-G4 image streams -> blank _ocr.pdf on
  // fax-scanned books (Tensors/GEET/etc.). fitz preserves the page images and
  // only adds an invisible OCR text layer (render mode 3). Fix 2026-06-01;
  // companion: apple/bin/ocr-pdf-rebuild + wiki/operations/blank-ocr-pdfs.md.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ocrpdf-"));
  try {
    const srcPath = path.join(tmp, "src.pdf");
    const jsonPath = path.join(tmp, "pages.json");
    const outPath = path.join(tmp, "out.pdf");
    fs.writeFileSync(srcPath, Buffer.from(pdfBytes));
    fs.writeFileSync(jsonPath, JSON.stringify(pages.map((pg) => pg.ocrText || "")));
    const builder = path.join(path.dirname(fileURLToPath(import.meta.url)), "build_ocr_pdf.py");
    execSync(
      `python3 ${JSON.stringify(builder)} ${JSON.stringify(srcPath)} ${JSON.stringify(jsonPath)} ${JSON.stringify(outPath)}`,
      EXEC_OPTS
    );
    return fs.readFileSync(outPath);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// --- Main ---
// Large PDF threshold: skip .pdfws (base64-embedded) for files over this size
const LARGE_PDF_BYTES = 50 * 1024 * 1024; // 50 MB

// execSync with proper PATH and PYTHONPATH (nohup workers may lack site-packages)
const HOME = process.env.HOME || "/Users/esaruoho";
const EXEC_OPTS = {
  env: {
    ...process.env,
    PATH: `/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${process.env.PATH || ""}`,
    PYTHONPATH: `${HOME}/Library/Python/3.9/lib/python/site-packages:${process.env.PYTHONPATH || ""}`,
  },
};

// Check if PyMuPDF is available for fallback rendering
function hasPyMuPDF() {
  try {
    execSync('python3 -c "import fitz"', { ...EXEC_OPTS, stdio: "ignore" });
    return true;
  } catch {
    try {
      execSync('python3 -c "import pymupdf"', { ...EXEC_OPTS, stdio: "ignore" });
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
    ...EXEC_OPTS,
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
  const startedAt = new Date();

  if (isLarge) {
    console.log(`\n--- ${baseName}.pdf --- (${(fileSize / 1024 / 1024).toFixed(0)} MB — large PDF mode)`);
  } else {
    console.log(`\n--- ${baseName}.pdf ---`);
  }

  // Initial heartbeat so watchers know we've picked up this file
  writeHeartbeat({
    ts: new Date().toISOString(),
    status: "rendering",
    current_job: `${baseName}.pdf`,
    file_size_bytes: fileSize,
    current_page: 0,
    total_pages: 0,
    backend: null,
    started_at: startedAt.toISOString(),
  });

  // Try pdfjs first, fall back to PyMuPDF if canvas rendering fails
  let numPages = 0;
  let usePyMuPDF = false;
  let pdfjsDoc = null;
  const tmpImgDir = path.join(outputDir, "_page_images");
  const pdfBuffer = fs.readFileSync(pdfPath);

  try {
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
  let consecutiveFails = 0;

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

    if (result && result.text) {
      if (!backend) backend = result.backend;
      const chars = result.text.length;
      const retried = result.attempts > 1 ? ` after ${result.attempts} attempts` : "";
      process.stdout.write(` ${chars} chars (${result.backend})${retried}\n`);
      consecutiveFails = 0;
      pages.push({
        pageNumber: i,
        ocrText: result.text,
        source: "glm-ocr",
        history: [],
      });
    } else {
      consecutiveFails++;
      // Say WHY. A bare "FAILED" is what let a wholly broken backend run for hours.
      process.stdout.write(` FAILED after ${result?.attempts ?? 1} attempts — ${result?.error ?? "unknown"}\n`);
      pages.push({ pageNumber: i, ocrText: "", source: null, history: [] });

      if (consecutiveFails >= ABORT_AFTER_CONSECUTIVE_FAILS) {
        const msg =
          `ABORTING: ${consecutiveFails} consecutive pages failed all ${MAX_PAGE_ATTEMPTS} attempts ` +
          `(~${consecutiveFails * MAX_PAGE_ATTEMPTS} failed backend calls). The OCR backend is not ` +
          `working — fix it rather than burning the remaining ${numPages - i} page(s). ` +
          `Last error — ${result?.error ?? "unknown"}`;
        process.stdout.write(`\n${msg}\n`);
        throw new Error(msg);
      }
    }

    // Per-page heartbeat for off-network visibility (survives Syncthing)
    const charsSoFar = pages.reduce((sum, p) => sum + (p.ocrText?.length || 0), 0);
    const elapsedMs = Date.now() - startedAt.getTime();
    const etaMs = i > 0 ? Math.round((elapsedMs / i) * (numPages - i)) : null;
    writeHeartbeat({
      ts: new Date().toISOString(),
      status: "processing",
      current_job: `${baseName}.pdf`,
      file_size_bytes: fileSize,
      current_page: i,
      total_pages: numPages,
      backend: backend || "unknown",
      started_at: startedAt.toISOString(),
      elapsed_ms: elapsedMs,
      eta_ms: etaMs,
      chars_total: charsSoFar,
    });
  }

  if (pdfjsDoc) pdfjsDoc.destroy();

  // Clean up temp images
  if (fs.existsSync(tmpImgDir)) {
    fs.rmSync(tmpImgDir, { recursive: true, force: true });
  }

  // ───── ORDER OF SAVES IS LOAD-BEARING ─────
  // Save .txt FIRST. The OCR'd pages array lives in process memory only
  // until written to disk; if the OCR-PDF assembly step (pdf-lib) throws
  // — for example on encrypted source PDFs — the entire processPdf()
  // function unwinds and the pages array is garbage-collected. Writing
  // .txt first guarantees we never lose hours of OCR work to a failure
  // in the cosmetic last-mile PDF assembly.
  // History: 2026-05-01 Wiley 1939 + Dover 1959 OCR runs (664 + 270 pages,
  // ~3.5h + ~1h) were destroyed by EncryptedPDFError at the buildOcrPdf
  // step despite every page having OCR'd successfully. The .txt-first
  // reorder + buildOcrPdf ignoreEncryption: true together prevent recurrence.

  // 1) Always save plain text extract — never depends on pdf-lib succeeding
  const txtPath = path.join(outputDir, `${baseName}.txt`);
  const txt = pages
    .map((pg) => `=== Page ${pg.pageNumber} ===\n${pg.ocrText || ""}`)
    .join("\n\n");
  fs.writeFileSync(txtPath, txt);
  console.log(`  Saved: ${txtPath}`);

  // 2) Save .pdfws project (skip for large PDFs — base64 embedding would be too big)
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

  // 3) Save OCR PDF (re-read the file fresh for pdf-lib — avoids detached buffer)
  // If this step throws (e.g. encryption, malformed PDF), .txt and .pdfws
  // are already on disk so the OCR work is preserved and the failure is
  // recoverable by re-assembling the PDF from the .pdfws project.
  try {
    const ocrPdfPath = path.join(outputDir, `${baseName}_ocr.pdf`);
    const freshPdfBytes = Uint8Array.from(fs.readFileSync(pdfPath));
    const ocrPdfBytes = await buildOcrPdf(freshPdfBytes, pages);
    fs.writeFileSync(ocrPdfPath, ocrPdfBytes);
    console.log(`  Saved: ${ocrPdfPath}`);
  } catch (err) {
    console.warn(`  WARNING: OCR-PDF assembly failed: ${err.message.split("\n")[0]}`);
    console.warn(`  .txt and .pdfws were saved successfully; _ocr.pdf can be re-assembled later.`);
  }
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
