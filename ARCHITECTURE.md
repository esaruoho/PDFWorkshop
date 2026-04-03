# PDF Workshop — Architecture

## What it is
A split-screen PDF OCR workbench. Load a scanned (image-only) PDF, OCR it page-by-page, edit the results, and export a searchable PDF.

## Tech Stack
- **Next.js 16** (App Router, Turbopack)
- **pdf.js v4** (pdfjs-dist 4.9.155) — renders PDF pages to canvas in the browser
- **tesseract.js v7** — client-side OCR (no server dependency)
- **pdf-lib** — assembles the final OCR'd PDF with invisible text layer
- **Gemini Vision API** — optional AI-powered OCR via server API route
- **Tailwind CSS v4** — styling

## File Structure
```
src/
├── app/
│   ├── page.tsx              # Main app — state management, wiring
│   ├── layout.tsx            # Root layout
│   ├── globals.css           # Tailwind + dark theme
│   └── api/ocr-gemini/
│       └── route.ts          # Gemini Vision API proxy
├── components/
│   ├── PdfViewer.tsx         # Left panel — PDF page canvas renderer
│   └── OcrEditor.tsx         # Right panel — text editor + OCR controls
└── lib/
    ├── pdf-utils.ts          # pdf.js helpers (lazy-loaded, client-only)
    └── types.ts              # PageData, OcrSource types
```

## Data Model
Each loaded document has an array of `PageData`:
```ts
{
  pageNumber: number;
  ocrText: string;              // Current working text
  source: OcrSource | null;     // 'tesseract' | 'gemini' | 'pasted' | 'manual'
  history: { text, source, timestamp }[];  // Undo stack
}
```

## Workflows
1. **Upload** → pdf.js loads document → pages array initialized
2. **OCR** → Tesseract (browser-side) or Gemini (API route) → text populated
3. **Paste** → Clipboard API reads text → inserted as "pasted" source
4. **Edit** → Direct text editing in textarea
5. **Undo** → Restores previous version from history stack
6. **Export** → pdf-lib copies original pages + overlays invisible text layer

## Gemini Setup
Copy `.env.local.example` to `.env.local` and add your API key from https://aistudio.google.com/apikey

## Running
```bash
npm run dev    # Development server at localhost:3000
npm run build  # Production build
```
