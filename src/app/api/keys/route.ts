/**
 * Lets the UI write API keys into `.env.local` and validate them, so nobody
 * ever has to edit a file by hand.
 *
 * Safety rules:
 *   - development only (production reads keys from the host environment),
 *   - only a whitelist of known variable names can be written,
 *   - values are validated and never echoed back to the client.
 */

const ALLOWED = new Set([
  "YOUTUBE_API_KEY",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "LLM_MODEL",
]);
const MAX_VALUE_CHARS = 500;
const TEST_TIMEOUT_MS = 45_000;

interface SaveBody {
  action: "save";
  values: Record<string, string>;
  /** Variable names to empty out (whitelist still applies). */
  clear?: string[];
}
interface TestBody {
  action: "test";
  kind: "youtube" | "gemini" | "openai";
  key: string;
}
type Body = SaveBody | TestBody;

export async function POST(request: Request): Promise<Response> {
  let body: Partial<Body>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Send JSON in the request body." }, { status: 400 });
  }

  if (body.action === "save") {
    const save = body as SaveBody;
    return saveValues(save.values, save.clear);
  }
  if (body.action === "test") {
    const test = body as TestBody;
    if (test.kind !== "youtube" && test.kind !== "gemini" && test.kind !== "openai") {
      return Response.json({ ok: false, error: "Unknown key type." }, { status: 400 });
    }
    return testKey(test.kind, test.key ?? "");
  }

  return Response.json({ ok: false, error: "Unknown action." }, { status: 400 });
}

/* ------------------------------- save ---------------------------------- */

async function saveValues(
  values: Record<string, string>,
  clear: string[] = [],
): Promise<Response> {
  if (process.env.NODE_ENV === "production") {
    return Response.json(
      {
        ok: false,
        error:
          "Keys can only be changed in local development. On a deployed site, set them in the host's environment variables.",
      },
      { status: 403 },
    );
  }

  if (!values || typeof values !== "object") {
    return Response.json({ ok: false, error: "Nothing to save." }, { status: 400 });
  }

  const updates = new Map<string, string>();
  for (const [name, raw] of Object.entries(values)) {
    if (!ALLOWED.has(name)) continue; // silently ignore anything not whitelisted

    const value = String(raw ?? "").trim();
    if (!value) continue; // empty means "leave as is"

    if (value.length > MAX_VALUE_CHARS) {
      return Response.json(
        { ok: false, error: `${name} is too long to be an API key.` },
        { status: 400 },
      );
    }
    if (/[\r\n]/.test(value)) {
      return Response.json(
        { ok: false, error: `${name} must be a single line.` },
        { status: 400 },
      );
    }
    updates.set(name, value);
  }

  const clearing = (Array.isArray(clear) ? clear : []).filter(
    (name) => ALLOWED.has(name) && !updates.has(name),
  );

  if (updates.size === 0 && clearing.length === 0) {
    return Response.json({ ok: false, error: "Paste at least one key first." }, { status: 400 });
  }

  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const file = path.join(process.cwd(), ".env.local");

    let current = "";
    try {
      current = await fs.readFile(file, "utf8");
    } catch {
      current = "# ExamSmasher - API keys (local only, never commit this file)\n";
    }

    // What each whitelisted variable should read as: a new value, or "" to clear.
    const setters = new Map<string, string>();
    for (const [name, value] of updates) setters.set(name, value);
    for (const name of clearing) setters.set(name, "");

    const lines = current.split(/\r?\n/);
    const pending = new Map(setters);

    const rewritten = lines.map((line) => {
      const match = /^\s*([A-Z0-9_]+)\s*=/.exec(line);
      if (!match) return line;
      const name = match[1];
      if (!pending.has(name)) return line;
      pending.delete(name);
      return `${name}=${setters.get(name)}`;
    });

    // Any variable that had no line yet gets appended.
    for (const [name, value] of pending) rewritten.push(`${name}=${value}`);

    const output = rewritten.join("\n").replace(/\n*$/, "\n");
    await fs.writeFile(file, output, "utf8");

    // Apply immediately too — Next dev reloads env files on its own, but this
    // makes the very next request see the change with zero delay.
    for (const [name, value] of updates) process.env[name] = value;
    for (const name of clearing) delete process.env[name];

    const saved = [...updates.keys(), ...clearing];
    return Response.json({ ok: true, saved, message: `Saved ${saved.join(", ")}.` });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: err instanceof Error ? `Could not write .env.local: ${err.message}` : "Write failed.",
      },
      { status: 500 },
    );
  }
}

/* -------------------------------- test --------------------------------- */

async function testKey(kind: "youtube" | "gemini" | "openai", rawKey: string): Promise<Response> {
  const key = rawKey.trim();
  if (!key) {
    return Response.json({ ok: false, message: "Pehle key paste karo, phir Test dabao." });
  }
  if (/[\r\n\s]/.test(key)) {
    return Response.json({
      ok: false,
      message: "Key me space ya newline lag rahi hai — dobara copy karo.",
    });
  }

  try {
    if (kind === "youtube") return await testYouTube(key);
    if (kind === "gemini") return await testGemini(key);
    return await testOpenAI(key);
  } catch (err) {
    return Response.json({
      ok: false,
      message: err instanceof Error ? err.message : "Network error while testing the key.",
    });
  }
}

async function testYouTube(key: string): Promise<Response> {
  // videos.list costs 1 quota unit (search costs 100) — same auth check.
  const url =
    "https://www.googleapis.com/youtube/v3/videos?part=id&id=jNQXAC9IVRw&key=" +
    encodeURIComponent(key);

  const res = await fetchWithTimeout(url);
  if (res.ok) {
    return Response.json({ ok: true, message: "YouTube key valid — video search chalega ✅" });
  }

  const detail = await readErrorDetail(res);
  return Response.json({ ok: false, message: friendlyYouTubeError(res.status, detail) });
}

function friendlyYouTubeError(status: number, detail: string): string {
  const text = detail.toLowerCase();
  if (text.includes("not valid") || text.includes("keyinvalid") || text.includes("api key not")) {
    return "YouTube key galat lag rahi hai — console se dobara copy karo.";
  }
  if (text.includes("has not been used") || text.includes("is not enabled")) {
    return "Key sahi hai, par YouTube Data API abhi enable nahi hai. Neeche wale link se Enable karo.";
  }
  if (text.includes("quota")) return "Key valid hai, bas aaj ki quota khatam ho gayi.";
  if (status === 403) return "YouTube ne403 diya — key check karo ya API enable karo.";
  return `YouTube test fail: ${detail || `HTTP ${status}`}`;
}

async function testGemini(key: string): Promise<Response> {
  const models = [
    ...new Set(
      [
        process.env.LLM_MODEL?.trim(),
        "gemini-flash-lite-latest",
        "gemini-flash-latest",
        "gemini-3.8-flash",
      ].filter((model): model is string => Boolean(model)),
    ),
  ];
  let lastDetail = "";

  for (const model of models) {
    const res = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        model,
      )}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Reply with the single word: ok" }] }],
          generationConfig: { maxOutputTokens: 8, temperature: 0 },
        }),
      },
    );

    if (res.ok) {
      return Response.json({ ok: true, message: `Gemini key valid — AI analysis chalega ✅` });
    }

    lastDetail = await readErrorDetail(res);
    const text = lastDetail.toLowerCase();

    // These mean the key authenticated fine — only the model is missing.
    if (
      text.includes("not found") ||
      text.includes("is not a valid model") ||
      text.includes("no longer available") ||
      text.includes("please update your code to use models/")
    ) {
      continue;
    }

    if (text.includes("API key not valid") || text.includes("keyinvalid")) {
      return Response.json({
        ok: false,
        message: "Gemini key galat lag rahi hai — AI Studio se dobara copy karo.",
      });
    }
    if (text.includes("quota") || text.includes("resource_exhausted")) {
      return Response.json({ ok: true, message: "Gemini key valid (abhi quota limit aa rahi hai)." });
    }
    if (res.status === 503 || text.includes("high demand") || text.includes("overloaded")) {
      // The key already authenticated — only the model backend is busy.
      return Response.json({
        ok: true,
        message: "Gemini key valid ✅ — model abhi high demand me hai, thodi der baad test karo.",
      });
    }
    if (text.includes("not been used") || text.includes("not enabled")) {
      return Response.json({
        ok: false,
        message: "Key sahi hai, par Generative Language API enable nahi hai.",
      });
    }
    return Response.json({ ok: false, message: `Gemini test fail: ${lastDetail}` });
  }

  return Response.json({
    ok: true,
    message: `Gemini key valid (model "${models[0]}" abhi available nahi lag raha).`,
  });
}

async function testOpenAI(key: string): Promise<Response> {
  const res = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
      max_tokens: 1,
    }),
  });

  if (res.ok) {
    return Response.json({ ok: true, message: "OpenAI key valid ✅" });
  }

  const detail = await readErrorDetail(res);
  if (res.status === 401 || detail.toLowerCase().includes("invalid api key")) {
    return Response.json({ ok: false, message: "OpenAI key galat lag rahi hai." });
  }
  return Response.json({ ok: false, message: `OpenAI test fail: ${detail || `HTTP ${res.status}`}` });
}

/* ------------------------------- helpers ------------------------------- */

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    throw new Error(
      aborted
        ? "Key test timed out — internet connection check karo."
        : "Could not reach the API — internet connection check karo.",
    );
  } finally {
    clearTimeout(timer);
  }
}

async function readErrorDetail(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as {
      error?: { message?: string; errors?: Array<{ reason?: string }> };
      error_description?: string;
    };
    const reason = data.error?.errors?.[0]?.reason;
    return data.error?.message || data.error_description || reason || "";
  } catch {
    return "";
  }
}
