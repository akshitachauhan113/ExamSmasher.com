export type LlmProvider = "gemini" | "openai";

export interface LlmConfig {
  provider: LlmProvider;
  key: string;
  model: string;
}

/**
 * Detects which AI provider is configured.
 * Priority: Gemini (free tier) -> OpenAI.
 * Override the model with the LLM_MODEL env var if a default is retired.
 */
export function getLlmConfig(): LlmConfig | null {
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();

  if (geminiKey) {
    return {
      provider: "gemini",
      key: geminiKey,
      model: process.env.LLM_MODEL?.trim() || "gemini-2.5-flash",
    };
  }
  if (openaiKey) {
    return {
      provider: "openai",
      key: openaiKey,
      model: process.env.LLM_MODEL?.trim() || "gpt-4o-mini",
    };
  }
  return null;
}

export function hasYouTubeKey(): boolean {
  return Boolean(process.env.YOUTUBE_API_KEY?.trim());
}

function abortAfter(ms: number): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

/** Pulls the first parseable JSON object out of a possibly messy LLM reply. */
export function extractJson<T>(raw: string): T {
  const stripped = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();

  const attempts: string[] = [stripped];
  const firstBrace = stripped.indexOf("{");
  const lastBrace = stripped.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    attempts.push(stripped.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      /* try next */
    }
  }
  throw new Error("AI returned a response that was not valid JSON.");
}

interface GenerateOptions {
  system?: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  /** Ask the model for machine-readable JSON instead of free text. */
  jsonMode?: boolean;
}

/** An image the model can read, already base64-encoded. */
export interface VisionImage {
  mimeType: string;
  base64: string;
}

const VISION_OPTIONS: Required<
  Pick<GenerateOptions, "temperature" | "maxOutputTokens" | "timeoutMs">
> = {
  temperature: 0.1,
  maxOutputTokens: 4096,
  timeoutMs: 90_000,
};

/**
 * Sends a prompt to the configured AI and returns raw text.
 * Throws a human-readable error when nothing is configured or the call fails.
 */
export async function generateText(
  prompt: string,
  options: GenerateOptions = {},
): Promise<string> {
  const config = getLlmConfig();
  if (!config) {
    throw new Error(
      "No AI key configured. Add GEMINI_API_KEY (or OPENAI_API_KEY) to your .env.local file.",
    );
  }

  const {
    system,
    temperature = 0.2,
    maxOutputTokens = 4096,
    timeoutMs = 60_000,
    jsonMode = false,
  } = options;

  return config.provider === "gemini"
    ? callGemini(config, prompt, { system, temperature, maxOutputTokens, timeoutMs, jsonMode })
    : callOpenAI(config, prompt, { system, temperature, maxOutputTokens, timeoutMs, jsonMode });
}

/**
 * Reads one or more images (e.g. a photo of a printed syllabus) and returns
 * the model's text answer. Gemini is preferred; OpenAI works too.
 */
export async function generateVisionText(
  prompt: string,
  images: VisionImage[],
  options: GenerateOptions = {},
): Promise<string> {
  const config = getLlmConfig();
  if (!config) {
    throw new Error(
      "No AI key configured. Add GEMINI_API_KEY (or OPENAI_API_KEY) to your .env.local file.",
    );
  }
  if (images.length === 0) throw new Error("No image was provided to read.");

  const {
    system,
    temperature = VISION_OPTIONS.temperature,
    maxOutputTokens = VISION_OPTIONS.maxOutputTokens,
    timeoutMs = VISION_OPTIONS.timeoutMs,
    jsonMode = false,
  } = options;

  return config.provider === "gemini"
    ? callGemini(config, prompt, { system, temperature, maxOutputTokens, timeoutMs, jsonMode }, images)
    : callOpenAI(config, prompt, { system, temperature, maxOutputTokens, timeoutMs, jsonMode }, images);
}

export async function generateJSON<T>(
  prompt: string,
  options: GenerateOptions = {},
): Promise<T> {
  const raw = await generateText(prompt, { ...options, jsonMode: true });
  return extractJson<T>(raw);
}

interface CallOptions {
  system?: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
  jsonMode: boolean;
}

async function callGemini(
  config: LlmConfig,
  prompt: string,
  opts: CallOptions,
  images?: VisionImage[],
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    config.model,
  )}:generateContent?key=${encodeURIComponent(config.key)}`;

  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  for (const image of images ?? []) {
    parts.push({
      inline_data: { mime_type: image.mimeType, data: image.base64 },
    });
  }

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: opts.temperature,
      maxOutputTokens: opts.maxOutputTokens,
      ...(opts.jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  };
  if (opts.system) {
    body.systemInstruction = { parts: [{ text: opts.system }] };
  }

  const { signal, done } = abortAfter(opts.timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    throw new Error(
      `Could not reach the AI service (${config.model}). ${errorText(err)}`,
    );
  } finally {
    done();
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message =
      (data as { error?: { message?: string } })?.error?.message ?? res.statusText;
    throw new Error(`AI request failed (${res.status}): ${message}`);
  }

  const candidate = (data as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  })?.candidates?.[0];

  const text = candidate?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text.trim()) {
    const blockReason = (data as { promptFeedback?: { blockReason?: string } })
      ?.promptFeedback?.blockReason;
    throw new Error(
      blockReason
        ? `AI refused the request: ${blockReason}`
        : `AI (${config.model}) returned an empty response.`,
    );
  }
  return text;
}

async function callOpenAI(
  config: LlmConfig,
  prompt: string,
  opts: CallOptions,
  images?: VisionImage[],
): Promise<string> {
  const messages: Array<{ role: string; content: unknown }> = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });

  if (images && images.length > 0) {
    const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
    for (const image of images) {
      content.push({
        type: "image_url",
        image_url: { url: `data:${image.mimeType};base64,${image.base64}` },
      });
    }
    messages.push({ role: "user", content });
  } else {
    messages.push({ role: "user", content: prompt });
  }

  const { signal, done } = abortAfter(opts.timeoutMs);
  let res: Response;
  try {
    res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.key}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: opts.temperature,
        max_tokens: opts.maxOutputTokens,
        ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
        messages,
      }),
      signal,
    });
  } catch (err) {
    throw new Error(`Could not reach OpenAI (${config.model}). ${errorText(err)}`);
  } finally {
    done();
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const message =
      (data as { error?: { message?: string } })?.error?.message ?? res.statusText;
    throw new Error(`AI request failed (${res.status}): ${message}`);
  }

  const text =
    (data as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0]
      ?.message?.content ?? "";
  if (!text.trim()) throw new Error(`AI (${config.model}) returned an empty response.`);
  return text;
}

function errorText(err: unknown): string {
  if (err instanceof Error) {
    return err.name === "AbortError" ? "Request timed out." : err.message;
  }
  return String(err);
}
