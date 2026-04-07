import { NextRequest, NextResponse } from "next/server";

// Local backends (no API key needed)
const MLX_URL = "http://localhost:8080/chat/completions";
const OLLAMA_URL = "http://localhost:11434/api/generate";

// Cloud backend (API key required)
const MAAS_URL = "https://open.bigmodel.cn/api/paas/v4/layout_parsing";

const OCR_PROMPT =
  "OCR this image. Extract ALL text preserving the original formatting, paragraphs, tables, and formulas. Output only the extracted text.";

async function tryMlx(base64Data: string, retries = 2): Promise<string | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(MLX_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "mlx-community/GLM-OCR-bf16",
          messages: [
            {
              role: "user",
              content: [
                { type: "image_url", image_url: { url: `data:image/png;base64,${base64Data}` } },
                { type: "text", text: OCR_PROMPT },
              ],
            },
          ],
          max_tokens: 8192,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!res.ok) {
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        return null;
      }
      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? null;
    } catch {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      return null;
    }
  }
  return null;
}

async function tryOllama(base64Data: string): Promise<string | null> {
  try {
    const res = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "glm-ocr:latest",
        prompt: OCR_PROMPT,
        images: [base64Data],
        stream: false,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.response ?? null;
  } catch {
    return null;
  }
}

async function tryMaas(base64Data: string, apiKey: string): Promise<string | null> {
  const dataUri = `data:image/png;base64,${base64Data}`;
  const res = await fetch(MAAS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: "glm-ocr", file: dataUri }),
    signal: AbortSignal.timeout(300_000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GLM-OCR cloud API error ${res.status}: ${body.slice(0, 500)}`);
  }
  const data = await res.json();
  if (typeof data.md_results === "string") return data.md_results;
  if (data.data && typeof data.data.md_results === "string") return data.data.md_results;
  return null;
}

export async function POST(request: NextRequest) {
  const { imageBase64, apiKey: clientKey } = await request.json();

  if (!imageBase64) {
    return NextResponse.json({ error: "No image data provided" }, { status: 400 });
  }

  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");

  // Quick health check: is the MLX server process alive?
  let mlxAlive = false;
  try {
    const ping = await fetch("http://localhost:8080/", {
      signal: AbortSignal.timeout(3000),
    });
    mlxAlive = ping.ok || ping.status === 404 || ping.status === 405;
  } catch {
    // not reachable
  }

  let ollamaAlive = false;
  if (!mlxAlive) {
    try {
      const ping = await fetch("http://localhost:11434/", {
        signal: AbortSignal.timeout(3000),
      });
      ollamaAlive = ping.ok || ping.status === 404;
    } catch {
      // not reachable
    }
  }

  try {
    // 1. Try local MLX server first
    if (mlxAlive) {
      const mlxResult = await tryMlx(base64Data);
      if (mlxResult) {
        return NextResponse.json({ text: mlxResult, backend: "mlx" });
      }
    }

    // 2. Try local Ollama
    if (ollamaAlive) {
      const ollamaResult = await tryOllama(base64Data);
      if (ollamaResult) {
        return NextResponse.json({ text: ollamaResult, backend: "ollama" });
      }
    }

    // 3. Fall back to cloud MaaS API (needs API key)
    const apiKey = clientKey || process.env.ZHIPU_API_KEY;
    if (!apiKey) {
      // Give a specific error based on what we found
      let errorMsg: string;
      if (!mlxAlive && !ollamaAlive) {
        errorMsg =
          "MLX server is not responding (it may have crashed after processing pages).\n\n" +
          "Check the terminal where you ran ./start.sh for errors.\n" +
          "To restart: press R in the terminal, or stop and re-run ./start.sh";
      } else if (mlxAlive) {
        errorMsg =
          "MLX server is running but returned empty results for this page. " +
          "Try again, or use a different engine (Tesseract or Gemini).";
      } else {
        errorMsg =
          "Ollama is running but returned empty results. " +
          "Try a different engine.";
      }
      return NextResponse.json({ error: errorMsg }, { status: 500 });
    }

    const maasResult = await tryMaas(base64Data, apiKey);
    if (maasResult) {
      return NextResponse.json({ text: maasResult, backend: "cloud" });
    }

    return NextResponse.json({ error: "GLM-OCR returned no text" }, { status: 500 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
