import { describe, it, expect } from "vitest";
import { cleanupText, DEFAULT_CLEANUP, type CleanupOptions } from "../text-cleanup";

function only(key: keyof CleanupOptions): CleanupOptions {
  const opts: CleanupOptions = {
    letterSpacing: false,
    collapseSpaces: false,
    collapseBlankLines: false,
    ocrSubstitutions: false,
    hyphenation: false,
    stripJunk: false,
  };
  opts[key] = true;
  return opts;
}

describe("fixLetterSpacing", () => {
  it('fixes "t h e r e" → "there"', () => {
    expect(cleanupText("t h e r e", only("letterSpacing"))).toBe("there");
  });

  it('fixes "h e l l o w o r l d"', () => {
    expect(cleanupText("h e l l o w o r l d", only("letterSpacing"))).toBe(
      "helloworld"
    );
  });

  it("does not touch normal text", () => {
    expect(cleanupText("I am here today", only("letterSpacing"))).toBe(
      "I am here today"
    );
  });

  it("does not touch two-letter words", () => {
    expect(cleanupText("I am ok", only("letterSpacing"))).toBe("I am ok");
  });

  it("handles empty string", () => {
    expect(cleanupText("", only("letterSpacing"))).toBe("");
  });
});

describe("collapseSpaces", () => {
  it("collapses multiple spaces to one", () => {
    expect(cleanupText("hello    world", only("collapseSpaces"))).toBe(
      "hello world"
    );
  });

  it("trims lines", () => {
    expect(cleanupText("  hello  ", only("collapseSpaces"))).toBe("hello");
  });

  it("preserves line breaks", () => {
    expect(cleanupText("hello\n\nworld", only("collapseSpaces"))).toBe(
      "hello\n\nworld"
    );
  });
});

describe("collapseBlankLines", () => {
  it("collapses 3+ blank lines to 1", () => {
    expect(
      cleanupText("hello\n\n\n\nworld", only("collapseBlankLines"))
    ).toBe("hello\n\nworld");
  });

  it("leaves double newlines alone", () => {
    expect(cleanupText("hello\n\nworld", only("collapseBlankLines"))).toBe(
      "hello\n\nworld"
    );
  });

  it("collapses 10 blank lines", () => {
    expect(
      cleanupText("a\n\n\n\n\n\n\n\n\n\nb", only("collapseBlankLines"))
    ).toBe("a\n\nb");
  });
});

describe("fixOcrSubstitutions", () => {
  it("fixes smart quotes to straight quotes", () => {
    expect(cleanupText("\u2018hello\u2019", only("ocrSubstitutions"))).toBe(
      "'hello'"
    );
    expect(cleanupText("\u201Chello\u201D", only("ocrSubstitutions"))).toBe(
      '"hello"'
    );
  });

  it("fixes em/en dashes to hyphens", () => {
    expect(cleanupText("a\u2013b", only("ocrSubstitutions"))).toBe("a-b");
    expect(cleanupText("a\u2014b", only("ocrSubstitutions"))).toBe("a-b");
  });

  it('fixes "l" between digits to "1"', () => {
    expect(cleanupText("2l3", only("ocrSubstitutions"))).toBe("213");
  });

  it('fixes "O" between digits to "0"', () => {
    expect(cleanupText("2O3", only("ocrSubstitutions"))).toBe("203");
  });

  it('fixes standalone "rn" to "m"', () => {
    expect(cleanupText("rn", only("ocrSubstitutions"))).toBe("m");
  });

  it('fixes standalone "rnm" to "mm"', () => {
    expect(cleanupText("rnm", only("ocrSubstitutions"))).toBe("mm");
  });

  it("does not corrupt normal words", () => {
    expect(cleanupText("turn around", only("ocrSubstitutions"))).toBe(
      "turn around"
    );
    expect(cleanupText("learning", only("ocrSubstitutions"))).toBe("learning");
  });
});

describe("fixHyphenation", () => {
  it("fixes hyphenated line breaks", () => {
    expect(cleanupText("docu-\nment", only("hyphenation"))).toBe("document");
  });

  it("preserves hyphens not at line breaks", () => {
    expect(cleanupText("well-known", only("hyphenation"))).toBe("well-known");
  });

  it("preserves hyphens at end of line without continuation", () => {
    expect(cleanupText("hello-\n\nworld", only("hyphenation"))).toBe(
      "hello-\n\nworld"
    );
  });
});

describe("stripJunk", () => {
  it("strips control characters", () => {
    expect(cleanupText("hello\x00world", only("stripJunk"))).toBe(
      "helloworld"
    );
    expect(cleanupText("test\x01\x02\x03", only("stripJunk"))).toBe("test");
  });

  it("strips trailing whitespace per line", () => {
    expect(cleanupText("hello   \nworld  ", only("stripJunk"))).toBe(
      "hello\nworld"
    );
  });

  it("preserves leading indentation", () => {
    expect(cleanupText("  indented", only("stripJunk"))).toBe("  indented");
  });
});

describe("cleanupText with defaults", () => {
  it("applies all cleanups", () => {
    const input = "t h e r e   is   a\n\n\n\nproblem\x01";
    const result = cleanupText(input);
    expect(result).not.toContain("\x01");
    expect(result).not.toContain("   ");
    expect(result).not.toContain("\n\n\n");
  });

  it("handles empty string", () => {
    expect(cleanupText("")).toBe("");
  });

  it("returns already clean text unchanged", () => {
    const clean = "Hello world.\nThis is fine.";
    expect(cleanupText(clean)).toBe(clean);
  });
});

describe("cleanupText with no options", () => {
  const none: CleanupOptions = {
    letterSpacing: false,
    collapseSpaces: false,
    collapseBlankLines: false,
    ocrSubstitutions: false,
    hyphenation: false,
    stripJunk: false,
  };

  it("returns text unchanged when all options disabled", () => {
    const input = "t h e r e   \x01\n\n\n\n";
    expect(cleanupText(input, none)).toBe(input);
  });
});
