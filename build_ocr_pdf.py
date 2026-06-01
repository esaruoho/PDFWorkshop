#!/usr/bin/env python3
# build_ocr_pdf.py — assemble a searchable PDF from a source scan + per-page OCR
# text using PyMuPDF (fitz). Replaces pdf-lib copyPages, which corrupts CCITTFax.
import sys, json
import fitz
src, jsonpath, out = sys.argv[1], sys.argv[2], sys.argv[3]
texts = json.load(open(jsonpath))
doc = fitz.open(src)
for i, page in enumerate(doc):
    t = (texts[i] if i < len(texts) else "") or ""
    if not t.strip():
        continue
    page.insert_textbox(page.rect, t, fontsize=6, fontname="helv",
                        color=(0, 0, 0), render_mode=3, overlay=True)
doc.save(out, garbage=4, deflate=True)
