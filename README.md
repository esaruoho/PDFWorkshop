# PDF Workshop

A split-screen OCR workbench for scanned PDFs. Load an image-only PDF, run OCR page by page using **Tesseract**, **Gemini Vision**, or **GLM-OCR**, edit the extracted text, and export a searchable PDF -- all from your browser.

<!-- screenshot -->

## Download & Run

### Option 1: Download the release (easiest)

1. Download the latest `.zip` for your platform from [Releases](https://github.com/esaruoho/PDFWorkshop/releases)
2. Unzip it
3. **Windows:** Double-click `start.bat`
   **Mac/Linux:** Double-click `start.sh` (or run `./start.sh` in Terminal)
4. The app opens in your browser at http://localhost:3000

Node.js is bundled in the release -- nothing else to install. If you clone from source, `start.bat`/`start.sh` will auto-download Node.js on first run.

### Option 2: Clone the repo

```bash
git clone https://github.com/esaruoho/PDFWorkshop.git
cd PDFWorkshop
npm install
npm run dev
```

## OCR Engines

### Tesseract (built-in, no setup)

Runs entirely in your browser via tesseract.js. Supports 28 languages -- select in Settings. Good for clean scans with standard layouts.

### Gemini Vision (optional, API key)

Higher accuracy for complex documents. Enter your free API key from [Google AI Studio](https://aistudio.google.com/apikey) in Settings. The key is stored in your browser only.

### GLM-OCR (optional, local or cloud)

Best for documents with tables, formulas, and complex layouts. Three backends, tried in order:

1. **MLX (Apple Silicon, recommended)** -- On Mac with Apple Silicon, `start.sh` auto-launches the MLX server. First run downloads the model (~1.8 GB). Completely local and free.

2. **Ollama (any platform)** -- Install [Ollama](https://ollama.com), then:
   ```bash
   ollama pull glm-ocr:latest
   ollama serve
   ```

3. **Zhipu Cloud API (fallback)** -- If no local server is found, enter a Zhipu API key in Settings.

## Features

- **Three OCR engines** -- Tesseract (browser), Gemini Vision (API), GLM-OCR (local MLX/Ollama or cloud)
- **28 languages** -- select one or more OCR languages in Settings
- **Paste from Preview** -- paste text from macOS Preview or any clipboard source
- **Text cleanup** -- fix letter spacing, OCR artifacts, smart quotes, hyphenation
- **Batch cleanup** -- apply cleanup filters to all pages at once
- **Page-by-page editing** -- navigate and edit each page independently
- **Side-by-side diff** -- compare current text vs previous version
- **Undo history** -- full undo stack per page
- **Save/Load projects** -- save work as `.pdfws` files, resume later
- **Export OCR PDF** -- searchable PDF with invisible Unicode text overlay (Noto Sans)
- **Drag and drop** -- drop PDF or `.pdfws` files onto the window
- **Zero-install releases** -- Node.js bundled for Windows, Mac, and Linux

## Tech Stack

- Next.js 16 (App Router, Turbopack)
- React 19, TypeScript, Tailwind CSS v4
- pdfjs-dist v4 -- PDF rendering
- tesseract.js v7 -- client-side OCR
- pdf-lib + fontkit -- PDF export with Unicode text layer (Noto Sans)
- Google Generative AI SDK -- Gemini Vision
- MLX-VLM / Ollama -- local GLM-OCR inference
- Vitest -- testing

## License

MIT -- see [LICENSE](LICENSE).
