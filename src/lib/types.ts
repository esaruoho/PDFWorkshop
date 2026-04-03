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

export const TESSERACT_LANGUAGES = {
  eng: "English",
  fin: "Finnish",
  swe: "Swedish",
  deu: "German",
  fra: "French",
  spa: "Spanish",
  ita: "Italian",
  por: "Portuguese",
  nld: "Dutch",
  pol: "Polish",
  rus: "Russian",
  jpn: "Japanese",
  chi_sim: "Chinese (Simplified)",
  chi_tra: "Chinese (Traditional)",
  kor: "Korean",
  ara: "Arabic",
  hin: "Hindi",
  tha: "Thai",
  vie: "Vietnamese",
  tur: "Turkish",
  ukr: "Ukrainian",
  ces: "Czech",
  ron: "Romanian",
  hun: "Hungarian",
  ell: "Greek",
  heb: "Hebrew",
  dan: "Danish",
  nor: "Norwegian",
} as const;

export type TesseractLanguage = keyof typeof TESSERACT_LANGUAGES;

export interface ProjectFile {
  version: 1;
  fileName: string;
  totalPages: number;
  pages: PageData[];
  ocrLanguages: TesseractLanguage[];
  pdfBase64: string;
  savedAt: string;
}
