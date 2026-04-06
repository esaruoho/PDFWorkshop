import { NextRequest, NextResponse } from "next/server";

const MAAS_URL = "https://open.bigmodel.cn/api/paas/v4/layout_parsing";

export async function POST(request: NextRequest) {
  const { imageBase64, apiKey: clientKey } = await request.json();

  const apiKey = clientKey || process.env.ZHIPU_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "No Zhipu API key. Enter one in Settings or set ZHIPU_API_KEY in .env.local. Get a key at open.bigmodel.cn" },
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
    // Build data URI from the base64 image
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const dataUri = `data:image/png;base64,${base64Data}`;

    const response = await fetch(MAAS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "glm-ocr",
        file: dataUri,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      return NextResponse.json(
        { error: `GLM-OCR API error ${response.status}: ${body.slice(0, 500)}` },
        { status: response.status }
      );
    }

    const data = await response.json();

    // Extract markdown text from the response.
    // The MaaS API returns md_results as a string (markdown).
    let text = "";
    if (typeof data.md_results === "string") {
      text = data.md_results;
    } else if (data.data && typeof data.data.md_results === "string") {
      text = data.data.md_results;
    }

    return NextResponse.json({ text, raw: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
