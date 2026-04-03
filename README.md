# PDF Workshop

PDF Workshop is a split-screen OCR workbench for scanned PDFs. Load an image-only PDF, run OCR page by page using Tesseract (client-side) or Google Gemini Vision (API), edit the extracted text, and export a searchable PDF with an invisible text layer -- all from your browser, no server-side processing required for basic OCR.

<!-- screenshot -->

## Features

- **Tesseract OCR** -- client-side OCR powered by tesseract.js, no server needed
- **Gemini Vision OCR** -- optional AI-powered OCR via Google Gemini API for higher accuracy
- **Paste from Preview** -- paste text directly from macOS Preview or any clipboard source
- **Text cleanup** -- edit and clean up OCR results before export
- **Page-by-page editing** -- navigate and edit each page independently
- **Undo history** -- full undo stack per page so you never lose work
- **OCR PDF export** -- export a searchable PDF with invisible text overlay on original pages
- **Drag and drop** -- drop a PDF file onto the window to load it instantly

## Quick Start

```bash
git clone https://github.com/esaruoho/PDFWorkshop.git
cd PDFWorkshop
npm install
./start.sh
# or
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Gemini Setup

Gemini Vision OCR is optional. To enable it:

1. Get an API key from [Google AI Studio](https://aistudio.google.com/apikey)
2. Either enter the key in the Settings UI within the app, or copy `.env.local.example` to `.env.local` and add your key there:

```bash
cp .env.local.example .env.local
# Edit .env.local and add your Gemini API key
```

## Tech Stack

- **Next.js 16** (App Router, Turbopack)
- **React 19**
- **pdfjs-dist v4** -- PDF rendering in the browser
- **tesseract.js v7** -- client-side OCR engine
- **pdf-lib** -- PDF assembly and text layer overlay
- **Google Generative AI SDK** -- Gemini Vision API integration
- **Tailwind CSS v4**
- **TypeScript**

## License

MIT -- see [LICENSE](LICENSE) for details.
