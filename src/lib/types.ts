export type OcrSource = "tesseract" | "gemini" | "pasted" | "manual";

export interface PageData {
  pageNumber: number;
  ocrText: string;
  source: OcrSource | null;
  history: { text: string; source: OcrSource; timestamp: number }[];
}

export interface DocumentState {
  fileName: string;
  totalPages: number;
  currentPage: number;
  pages: PageData[];
  pdfData: ArrayBuffer | null;
}
