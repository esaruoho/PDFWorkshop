# PDF Workshop

A split-screen OCR workbench for scanned PDFs. Load an image-only PDF, run OCR page by page using Tesseract or Gemini Vision, edit the extracted text, and export a searchable PDF -- all from your browser.

<!-- screenshot -->

## Download & Run

### Option 1: Download the release (easiest)

1. Install [Node.js](https://nodejs.org) (LTS version -- just click "Next" through the installer)
2. Download the latest `.zip` from [Releases](https://github.com/esaruoho/PDFWorkshop/releases)
3. Unzip it
4. **Windows:** Double-click `start.bat`
   **Mac/Linux:** Double-click `start.sh` (or run `./start.sh` in Terminal)
5. The app opens in your browser at http://localhost:3000

### Option 2: Clone the repo

```bash
git clone https://github.com/esaruoho/PDFWorkshop.git
cd PDFWorkshop
npm install
npm run dev
```

## Features

- **Tesseract OCR** -- runs entirely in your browser, no server needed
- **Gemini Vision OCR** -- optional AI-powered OCR via Google Gemini API
- **28 languages** -- select one or more OCR languages in Settings
- **Paste from Preview** -- paste text from macOS Preview or any clipboard source
- **Text cleanup** -- fix letter spacing, OCR artifacts, smart quotes, hyphenation
- **Batch cleanup** -- apply cleanup to all pages at once
- **Page-by-page editing** -- navigate and edit each page independently
- **Side-by-side diff** -- compare current text vs previous version
- **Undo history** -- full undo stack per page
- **Save/Load projects** -- save your work as `.pdfws` files, resume later
- **Export OCR PDF** -- searchable PDF with invisible text overlay
- **Drag and drop** -- drop PDF or `.pdfws` files onto the window

## Gemini Vision Setup (optional)

Gemini Vision gives better OCR results than Tesseract for complex documents. To enable it:

1. Get a free API key from [Google AI Studio](https://aistudio.google.com/apikey)
2. Click **Settings** in the app and paste your key

The key is stored in your browser only -- never sent anywhere except Google's API.

## Tech Stack

- Next.js 16 (App Router, Turbopack)
- React 19, TypeScript, Tailwind CSS v4
- pdfjs-dist v4 -- PDF rendering
- tesseract.js v7 -- client-side OCR
- pdf-lib -- PDF export with text layer
- Google Generative AI SDK -- Gemini Vision
- Vitest -- testing

## License

MIT -- see [LICENSE](LICENSE).
