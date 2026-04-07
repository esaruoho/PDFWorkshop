# PDF Workshop — Architecture

## What it is
A split-screen PDF OCR workbench. Load a scanned (image-only) PDF, OCR it page-by-page with Tesseract, Gemini Vision, or GLM-OCR, edit the results, and export a searchable PDF.

## Tech Stack
- **Next.js 16** (App Router, Turbopack)
- **pdf.js v4** (pdfjs-dist 4.9.155) — renders PDF pages to canvas in the browser
- **tesseract.js v7** — client-side OCR (no server dependency)
- **pdf-lib + fontkit** — assembles OCR'd PDF with Unicode text layer (Noto Sans)
- **Gemini Vision API** — optional AI-powered OCR via server API route
- **GLM-OCR** — local OCR via MLX-VLM (Apple Silicon) or Ollama, or cloud via Zhipu MaaS
- **Tailwind CSS v4** — styling
- **Vitest** — testing

## File Structure
```
src/
├── app/
│   ├── page.tsx              # Main app — state management, wiring
│   ├── layout.tsx            # Root layout
│   ├── globals.css           # Tailwind + dark theme
│   └── api/
│       ├── ocr-gemini/
│       │   └── route.ts      # Gemini Vision API proxy
│       └── ocr-glm/
│           └── route.ts      # GLM-OCR proxy (MLX → Ollama → Zhipu cloud)
├── components/
│   ├── PdfViewer.tsx         # Left panel — PDF page canvas renderer
│   ├── OcrEditor.tsx         # Right panel — text editor + OCR controls
│   └── ErrorOverlay.tsx      # Error capture with copy-to-clipboard
└── lib/
    ├── pdf-utils.ts          # pdf.js helpers (lazy-loaded, client-only)
    ├── text-cleanup.ts       # OCR text cleanup filters
    ├── diff-utils.ts         # Line-level diff for side-by-side view
    ├── types.ts              # PageData, OcrSource, ProjectFile, languages
    └── __tests__/
        └── text-cleanup.test.ts  # 28 tests for cleanup functions
```

## Data Model
Each loaded document has an array of `PageData`:
```ts
{
  pageNumber: number;
  ocrText: string;              // Current working text
  source: OcrSource | null;     // 'tesseract' | 'gemini' | 'glm-ocr' | 'pasted' | 'manual'
  history: { text, source, timestamp }[];  // Undo stack
}
```

Projects can be saved/loaded as `.pdfws` files (JSON with base64 PDF + all page data).

## OCR Engines

### Tesseract (client-side)
Runs in browser via tesseract.js. Supports 28 languages via `lang` parameter (e.g. `eng+fin`).

### Gemini Vision (API route)
Proxied through `/api/ocr-gemini`. Sends page image + language hint to Gemini 2.0 Flash. API key from browser localStorage or `GEMINI_API_KEY` env var.

### GLM-OCR (API route, cascading backends)
Proxied through `/api/ocr-glm`. Tries backends in order:
1. **MLX-VLM** on `localhost:8080` — local Apple Silicon inference, auto-launched by `start.sh`
2. **Ollama** on `localhost:11434` — local inference on any platform
3. **Zhipu MaaS cloud** — fallback, requires API key

## Workflows
1. **Upload/Drop** → pdf.js loads document → pages array initialized
2. **OCR** → Tesseract (browser) / Gemini (API) / GLM-OCR (local/cloud) → text populated
3. **Paste** → Clipboard API reads text → inserted as "pasted" source
4. **Edit** → Direct text editing in textarea
5. **Cleanup** → Fix spacing, smart quotes, OCR artifacts (per page or batch)
6. **Diff** → Side-by-side line-level comparison with previous version
7. **Undo** → Restores previous version from history stack
8. **Save** → Export as `.pdfws` project file (PDF + all OCR state)
9. **Export** → pdf-lib copies original pages + overlays invisible Unicode text layer

## Running
```bash
./start.sh     # Mac/Linux — also launches GLM-OCR MLX server on Apple Silicon
start.bat      # Windows — auto-downloads Node.js if needed
npm run dev    # Development server at localhost:3000
npm run test   # Run vitest tests
npm run build  # Production build
```
