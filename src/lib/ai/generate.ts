import { loadBrowserModel } from "./model";
import { getAiStatus } from "./status";
import { extractAssistantText, looksLikeText } from "./text";

/**
 * Thin wrappers around the loaded pipeline.
 *
 * Everything here throws `AiUnavailableError` when the model is not usable —
 * callers catch that and fall back to the rule-based engine. Nothing is ever
 * fabricated to look like a model answer.
 */

export class AiUnavailableError extends Error {
  constructor(message = "The browser AI model is not available.") {
    super(message);
    this.name = "AiUnavailableError";
  }
}

export interface GenerateOptions {
  system?: string;
  /** 0 = deterministic (better for extraction/JSON). */
  temperature?: number;
  maxTokens?: number;
  /** Hard ceiling so a slow WASM run cannot hang the UI forever. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT = 45_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s.`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Runs one chat completion. Resolves to the assistant's text.
 * Throws `AiUnavailableError` when no model is loaded.
 */
export async function generateText(
  prompt: string,
  options: GenerateOptions = {},
): Promise<string> {
  if (getAiStatus().phase === "error" || getAiStatus().phase === "unsupported") {
    throw new AiUnavailableError();
  }

  const pipe = await loadBrowserModel();
  if (!pipe) throw new AiUnavailableError();

  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (options.system) messages.push({ role: "system", content: options.system });
  messages.push({ role: "user", content: prompt });

  const run = pipe(messages, {
    max_new_tokens: options.maxTokens ?? 700,
    do_sample: (options.temperature ?? 0) > 0,
    temperature: options.temperature ?? 0,
    top_p: 0.95,
    repetition_penalty: 1.1,
  });

  const output = await withTimeout(
    run as Promise<Array<{ generated_text: unknown }>>,
    options.timeoutMs ?? DEFAULT_TIMEOUT,
    "Model generation",
  );

  // One reader for every pipeline shape, shared with the loader's helpers.
  const text = extractAssistantText(output).trim();
  if (!text) throw new Error("The model returned an empty answer.");
  // A broken GPU session can emit punctuation soup — never show it as an answer.
  if (!looksLikeText(text)) {
    throw new Error("The model returned an unreadable answer.");
  }
  return text;
}

/**
 * Asks the model for JSON and parses it. Throws rather than returning a
 * half-parsed object — callers fall back to the rule-based engine.
 */
export async function generateJson<T>(
  prompt: string,
  options: GenerateOptions = {},
): Promise<T> {
  const text = await generateText(prompt, {
    ...options,
    maxTokens: options.maxTokens ?? 1400,
  });
  return parseJsonLoose<T>(text);
}

/**
 * Pulls the first balanced JSON object/array out of a reply. Small models
 * love wrapping answers in prose or ``` fences, so be forgiving — but never
 * invent a value when nothing parses.
 */
export function parseJsonLoose<T>(raw: string): T {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

  const start = text.search(/[[{]/);
  if (start === -1) throw new Error("No JSON found in the model reply.");

  const opener = text[start];
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let end = -1;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === opener) depth += 1;
    else if (ch === closer) {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  if (end === -1) throw new Error("Unbalanced JSON in the model reply.");
  return JSON.parse(text.slice(start, end + 1)) as T;
}
