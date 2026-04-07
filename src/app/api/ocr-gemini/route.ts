import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(request: NextRequest) {
  const { imageBase64, apiKey: clientKey, languages } = await request.json();

  // Prefer client-provided key, fall back to env var
  const apiKey = clientKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "No Gemini API key. Enter one in Settings (gear icon) or set GEMINI_API_KEY in .env.local" },
      { status: 500 }
    );
  }

  if (!imageBase64) {
    return NextResponse.json(
      { error: "No image data provided" },
      { status: 400 }
    );
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: "image/png",
          data: base64Data,
        },
      },
      `Extract all text from this scanned document page. The page may have multiple columns — read all columns from left to right, extracting each column fully top to bottom. Do not skip any text in any area of the page.${
        languages && languages.length > 0
          ? ` The document is in ${languages.join(" and ")}.`
          : ""
      } Preserve the original formatting, paragraphs, and line breaks as closely as possible. Output only the extracted text, nothing else.`,
    ]);

    const text = result.response.text();
    return NextResponse.json({ text });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
