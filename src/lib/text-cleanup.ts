// Fix "t h e r e" → "there" (single-char spacing)
function fixLetterSpacing(text: string): string {
  // Match sequences where single characters are separated by spaces
  // e.g., "t h e r e" but not "I am here"
  return text.replace(
    /\b([A-Za-z]) ((?:[A-Za-z] ){2,}[A-Za-z])\b/g,
    (match) => match.replace(/ /g, "")
  );
}

// Remove extra whitespace between words (but preserve line breaks)
function collapseSpaces(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/  +/g, " ").trim())
    .join("\n");
}

// Remove empty lines that are just OCR noise (3+ consecutive blank lines → 1)
function collapseBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n");
}

// Fix common OCR character substitutions
function fixOcrSubstitutions(text: string): string {
  return text
    // Common OCR errors — smart quotes to straight
    .replace(/[\u2018\u2019\u201A]/g, "'")
    .replace(/[\u201C\u201D\u201E]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\bI\b(?=\s+[a-z])/g, "I") // preserve capital I
    .replace(/(?<=\w)l(?=\d)/g, "1") // "l" before digits → "1"
    .replace(/(?<=\d)O(?=\d)/g, "0") // "O" between digits → "0"
    .replace(/(?<=\d)l(?=\d)/g, "1") // "l" between digits → "1"
    .replace(/\brnm\b/g, "mm") // rn→m confusion
    .replace(/\brn\b/g, "m"); // rn→m at word level (careful)
}

// Fix broken hyphenation from line breaks
function fixHyphenation(text: string): string {
  return text.replace(/(\w)-\n(\w)/g, "$1$2");
}

// Strip junk characters that OCR sometimes produces
function stripJunk(text: string): string {
  // Remove isolated non-printable or garbage characters
  return text
    .replace(/[^\S\n]+$/gm, "") // trailing whitespace per line
    .replace(/^[^\S\n]+/gm, (m) => m) // keep leading indentation
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ""); // control chars
}

export interface CleanupOptions {
  letterSpacing: boolean;
  collapseSpaces: boolean;
  collapseBlankLines: boolean;
  ocrSubstitutions: boolean;
  hyphenation: boolean;
  stripJunk: boolean;
}

export const DEFAULT_CLEANUP: CleanupOptions = {
  letterSpacing: true,
  collapseSpaces: true,
  collapseBlankLines: true,
  ocrSubstitutions: true,
  hyphenation: true,
  stripJunk: true,
};

export function cleanupText(
  text: string,
  options: CleanupOptions = DEFAULT_CLEANUP
): string {
  let result = text;
  if (options.stripJunk) result = stripJunk(result);
  if (options.letterSpacing) result = fixLetterSpacing(result);
  if (options.collapseSpaces) result = collapseSpaces(result);
  if (options.ocrSubstitutions) result = fixOcrSubstitutions(result);
  if (options.hyphenation) result = fixHyphenation(result);
  if (options.collapseBlankLines) result = collapseBlankLines(result);
  return result;
}

export const CLEANUP_LABELS: Record<keyof CleanupOptions, string> = {
  letterSpacing: 'Fix letter spacing ("t h e r e" → "there")',
  collapseSpaces: "Collapse extra spaces",
  collapseBlankLines: "Collapse blank lines",
  ocrSubstitutions: "Fix OCR character errors (rn→m, l→1)",
  hyphenation: "Fix broken hyphenation",
  stripJunk: "Strip junk characters",
};
