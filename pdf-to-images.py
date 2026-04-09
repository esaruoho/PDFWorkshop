#!/usr/bin/env python3
"""Extract PDF pages as PNG images using PyMuPDF.

Fallback for when pdfjs canvas rendering fails (e.g., Node v25 + scanned PDFs).
Used by batch-ocr.mjs when --pymupdf flag is set.

Usage:
    python3 pdf-to-images.py input.pdf output_dir [--dpi 200] [--page N]
"""
import sys
import os

def main():
    args = sys.argv[1:]
    if len(args) < 2:
        print("Usage: python3 pdf-to-images.py input.pdf output_dir [--dpi N] [--page N]", file=sys.stderr)
        sys.exit(1)

    pdf_path = args[0]
    output_dir = args[1]
    dpi = 200
    single_page = None

    i = 2
    while i < len(args):
        if args[i] == "--dpi" and i + 1 < len(args):
            dpi = int(args[i + 1])
            i += 2
        elif args[i] == "--page" and i + 1 < len(args):
            single_page = int(args[i + 1])
            i += 2
        else:
            i += 1

    try:
        import pymupdf as fitz
    except ImportError:
        import fitz

    os.makedirs(output_dir, exist_ok=True)

    doc = fitz.open(pdf_path)
    total = doc.page_count
    print(f"{total}")  # First line: page count (for batch-ocr.mjs to parse)

    zoom = dpi / 72
    mat = fitz.Matrix(zoom, zoom)

    pages = [single_page - 1] if single_page else range(total)

    for page_num in pages:
        page = doc[page_num]
        pix = page.get_pixmap(matrix=mat)
        out_path = os.path.join(output_dir, f"page_{page_num + 1:04d}.png")
        pix.save(out_path)
        # Output: page_number|path|width|height
        print(f"{page_num + 1}|{out_path}|{pix.width}|{pix.height}")

    doc.close()

if __name__ == "__main__":
    main()
