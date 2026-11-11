import { normalizeCards, normalizeDetailed, normalizeSections } from "@/lib/notesNormalize";
import type { NotesGenerationRequest, NotesGenerationResponse } from "@/lib/types";

/**
 * POST /api/notes — rich study notes written by a server-side model.
 *
 * The GEMINI_API_KEY lives ONLY in the server environment; the browser never
 * sees it. This is the same honest contract as /api/videos: a working key
 * returns genuinely generated notes (labelled via:"server"), and every
 * failure returns ok=false with a reason so the client falls back to the
 * rule-based engine instead of pretending a model wrote something.
 *
 * scope="topic" returns the full 12-element structure (intro, explanation,
 * definitions, key points, examples, features, advantages/disadvantages,
 * differences, exam questions, short answers, long answers, revision
 * summary) as structured sections; scope="document" returns one markdown
 * document for the whole syllabus or a single unit.
 *
 * Results are cached in-memory per content hash so a refresh or a retry on
 * the same syllabus never pays for the same generation twice.
 */

const THROTTLE_WINDOW_MS = 10 * 60 * 1000;
const THROTTLE_MAX = 30;
/** Per-attempt budgets — see generate() for the total deadline. The primary
 *  is the verified-working model and gets a long leash; the secondary is a
 *  rescue hatch (it is itself 503-prone on this key), so it gets a short one
 *  and hands the budget straight back to the primary when it fails. */
const PRIMARY_TIMEOUT_MS = 50_000;
const SECONDARY_TIMEOUT_MS = 18_000;
/** Total budget per generation; the client aborts at 80 s (topic) / 120 s
 *  (document), so the route must always answer first. */
const TOPIC_BUDGET_MS = 75_000;
const DOCUMENT_BUDGET_MS = 90_000;
/** 503/429 are "overloaded right now", not "broken": the answer comes back
 *  in ~2 s, so a SHORT backoff and several fast tries beat waiting. */
const RETRY_DELAY_MS = 800;
/** Consecutive primary failures before the secondary gets a turn. */
const PRIMARY_STRIKES = 2;
/** Safety valve on attempts — the deadline is the real limit, but a key that
 *  fails instantly on every call must not be hammered for the whole budget. */
const MAX_ATTEMPTS = 10;
/** No attempt starts with less budget left than this — better an honest
 *  reason now than a request that dies at the client's own 80/120 s abort. */
const MIN_ATTEMPT_MS = 6_000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 60;
const MAX_SYLLABUS_CHARS = 14_000;
const MAX_EXAM_QUESTIONS = 12;

/**
 * Model chain: the configured model first (default `gemini-3.5-flash-lite`,
 * verified to answer on this key in ~9 s), then `gemini-flash-latest` as a
 * secondary. `gemini-2.5-flash` 404s for new accounts, so it is not offered.
 * Returns [primary, secondary?].
 */
function modelCandidates(): [string, string | undefined] {
  const primary = process.env.LLM_MODEL?.trim() || "gemini-3.5-flash-lite";
  const secondary = "gemini-flash-latest";
  return primary === secondary ? [primary, undefined] : [primary, secondary];
}

class UpstreamError extends Error {}
class TimeoutError extends Error {}

/** ip → request timestamps inside the throttle window. */
const hits = new Map<string, number[]>();

function throttled(ip: string): boolean {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < THROTTLE_WINDOW_MS);
  if (list.length >= THROTTLE_MAX) {
    hits.set(ip, list);
    return true;
  }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 500) hits.clear();
  return false;
}

/** Content-hash cache — identical inputs are never generated twice. */
const cache = new Map<string, { at: number; response: NotesGenerationResponse }>();

function cacheGet(hash: string): NotesGenerationResponse | null {
  const entry = cache.get(hash);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(hash);
    return null;
  }
  return entry.response;
}

function cacheSet(hash: string, response: NotesGenerationResponse): void {
  cache.set(hash, { at: Date.now(), response });
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** Cheap stable hash for cache keys (FNV-1a, 32-bit). */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/* --------------------------------- prompts --------------------------------- */

const SECTION_LIST = `1 "Topic introduction" — what this topic is and where it sits in the course.
2 "Detailed explanation (easy language)" — explain every syllabus point like to a beginner, connected and in order.
3 "Important definitions" — each term the syllabus uses, with its meaning as the syllabus states it.
4 "Main concepts and key points" — the core points as short dense bullets-in-paragraphs.
5 "Examples" — illustrative examples built ONLY from syllabus wording; if none can be derived honestly, say in one line that the student should work one example from the textbook.
6 "Important features or characteristics" — properties, types, conditions the syllabus lists.
7 "Advantages and disadvantages" — include only if the syllabus points support it; otherwise omit this section entirely.
8 "Differences and comparisons" — include only if the syllabus lists two comparable things; otherwise omit this section entirely.
9 "Important exam questions" — REAL past questions first (when given below), then syllabus-shaped questions.
10 "Exam-ready short answers" — 2-4 line model answers to the section-9 questions, built from the syllabus points.
11 "Detailed answers for long questions" — full long-form answer skeletons (intro, points to cover, conclusion) for the big questions.
12 "Quick revision summary" — the whole topic compressed into 5-8 lines.`;

function topicPrompt(body: NotesGenerationRequest): string {
  const topic = body.topic!;
  const pyq = (body.examQuestions ?? []).filter(Boolean).slice(0, MAX_EXAM_QUESTIONS);
  return `You are an expert exam-notes writer. Write study notes for ONE syllabus topic.

STRICT RULES:
- Use ONLY the syllabus text provided. Do NOT invent facts, formulas, dates, authors or syllabus topics.
- Every definition, point and answer must be traceable to a syllabus line.
- Do NOT write empty or generic filler: each section must contain real content specific to this topic.
${body.language === "hinglish"
    ? "LANGUAGE: easy HINGLISH — explain like a friend would. Keep technical terms, law names and formulas in standard English."
    : "LANGUAGE: clear, simple English."}
EQUATIONS: write every formula in LaTeX — $...$ inline, $$...$$ on its own line.

Course: ${body.subject}
Topic: ${topic.title}
Unit/chapter: ${topic.chapter ?? "-"}
Topic description: ${topic.description || "-"}
Keywords: ${topic.keywords.join(", ") || "-"}
Syllabus lines for this topic:
"""${body.syllabus.slice(0, MAX_SYLLABUS_CHARS)}"""
${pyq.length > 0 ? `\nREAL past exam questions on this topic (must appear in section 9, and drive 10/11):\n${pyq.map((q) => `- ${q.replace(/\s+/g, " ").slice(0, 300)}`).join("\n")}\n` : ""}

Write EXACTLY these 12 sections in order as JSON — omit sections 7 and 8 only when genuinely inapplicable:
${SECTION_LIST}

Return ONLY this JSON shape:
{"detailed":[{"heading":"...","paragraphs":["..."]}],"notes":[{"heading":"Revision bullets","bullets":["..."]}],"cards":[{"q":"...","a":"..."}]}

notes: 1-2 sections of short revision bullets. cards: 6-10 flashcards.`;
}

function documentPrompt(body: NotesGenerationRequest): string {
  const scope = body.unit ? `ONLY the unit "${body.unit}"` : "the WHOLE syllabus";
  const topics = (body.topicTitles ?? [])
    .filter((t) => !body.unit || !t.chapter || t.chapter === body.unit)
    .slice(0, 80);
  return `You are an expert exam-notes writer. Write one continuous Markdown study document for ${scope}.

STRICT RULES:
- Use ONLY the syllabus text provided. Do NOT invent facts, formulas or topics.
- Real content only — no generic filler sections.
${body.language === "hinglish"
    ? "LANGUAGE: easy HINGLISH, technical terms in English."
    : "LANGUAGE: clear, simple English."}
EQUATIONS: LaTeX — $...$ inline, $$...$$ on its own line.

Structure: one "## " per unit/chapter, then "### What the syllabus asks for" (bullets), "### Detailed explanation" (short prose), "### Exam corner" (3 likely questions built from those bullets, and any REAL past questions supplied).
Start the document with a one-line note that it was built from the student's own syllabus.
${topics.length > 0 ? `\nExtracted topics in order:\n${topics.map((t) => `- ${t.title}${t.chapter ? ` (${t.chapter})` : ""}`).join("\n")}\n` : ""}
Course: ${body.subject}
Syllabus:
"""${body.syllabus.slice(0, MAX_SYLLABUS_CHARS)}"""

Reply with the Markdown document only.`;
}

/* --------------------------------- calling --------------------------------- */

interface GeminiPart {
  text?: string;
}

async function callGemini(
  model: string,
  key: string,
  prompt: string,
  jsonMode: boolean,
  timeoutMs: number,
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const payload = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: jsonMode ? 8192 : 4096,
      ...(jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new TimeoutError(`${model} went silent (no answer in ${Math.round(timeoutMs / 1000)}s)`);
    }
    throw new UpstreamError("network");
  }

  if (!res.ok) {
    // 404 = model not on this key, 503 = overloaded, 429 = rate limit — all
    // worth one retry on the next candidate. Anything else is final.
    if (res.status === 404 || res.status === 503 || res.status === 429) {
      throw new UpstreamError(`model-${res.status}`);
    }
    throw new UpstreamError(`http-${res.status}`);
  }

  const data = (await res.json().catch(() => null)) as {
    candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  } | null;
  const text = data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!text) throw new UpstreamError("empty-candidate");
  return text;
}

/**
 * Runs the attempt sequence under one total deadline.
 *
 * The order is adaptive rather than a fixed list: the primary model is
 * retried after fast transient failures (503 "high demand" spikes are the
 * common case and clear in ~2 s — a retry on the verified model wins far
 * more often than switching), the secondary gets a turn once the primary has
 * struck out twice, and control comes straight back to the primary when the
 * secondary fails, so a hung secondary can no longer eat the whole budget
 * while the working model sits unused. Every failure is logged server-side
 * and, if nothing answers, the last error is rethrown so the caller can
 * return an honest reason and the client falls back to the rule engine.
 */
async function generate(key: string, prompt: string, jsonMode: boolean): Promise<string> {
  const deadline = Date.now() + (jsonMode ? TOPIC_BUDGET_MS : DOCUMENT_BUDGET_MS);
  const [primary, secondary] = modelCandidates();
  let last: Error | null = null;
  let strikes = 0;
  let secondaryTurns = 0;
  let attempt = 0;

  while (attempt < MAX_ATTEMPTS && deadline - Date.now() >= MIN_ATTEMPT_MS) {
    attempt += 1;
    const useSecondary = Boolean(secondary) && strikes >= PRIMARY_STRIKES;
    const model = useSecondary ? secondary! : primary;
    const timeoutMs = Math.min(
      useSecondary ? SECONDARY_TIMEOUT_MS : PRIMARY_TIMEOUT_MS,
      deadline - Date.now(),
    );

    try {
      return await callGemini(model, key, prompt, jsonMode, timeoutMs);
    } catch (err) {
      last = err instanceof Error ? err : new UpstreamError("unknown");
      console.warn(
        `[api/notes] attempt ${attempt}/${MAX_ATTEMPTS} on ${model} failed: ${last.name}: ${last.message}`,
      );
      // Bad key / bad request — another attempt will not fix that.
      if (err instanceof UpstreamError && /^http-(400|401|403)$/.test(err.message)) throw err;

      if (useSecondary) {
        secondaryTurns += 1;
        strikes = 0; // back to the primary — it is the one known to answer
      } else {
        strikes += 1;
      }
      // The secondary has had its chance; past this point it only steals
      // budget from the model that actually answers.
      if (secondary && secondaryTurns >= 2) break;

      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }

  throw last ?? new UpstreamError("no-model");
}

/** Strips ```json fences a model may wrap around its answer. */
function parseJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

/* --------------------------------- parsing --------------------------------- */

function parseBody(raw: unknown): NotesGenerationRequest | { error: true } {
  if (!raw || typeof raw !== "object") return { error: true };
  const body = raw as Partial<NotesGenerationRequest>;
  if (body.scope !== "topic" && body.scope !== "document") return { error: true };
  if (typeof body.subject !== "string" || typeof body.syllabus !== "string") return { error: true };
  if (!body.syllabus.trim()) return { error: true };
  if (body.language !== "english" && body.language !== "hinglish") return { error: true };

  if (body.scope === "topic") {
    const topic = body.topic;
    if (!topic || typeof topic.title !== "string" || !topic.title.trim()) return { error: true };
    return {
      scope: "topic",
      subject: body.subject.slice(0, 120),
      syllabus: body.syllabus.slice(0, MAX_SYLLABUS_CHARS),
      language: body.language,
      topic: {
        title: topic.title.slice(0, 200),
        description: String(topic.description ?? "").slice(0, 600),
        keywords: Array.isArray(topic.keywords)
          ? topic.keywords.filter((k): k is string => typeof k === "string").slice(0, 20)
          : [],
        chapter: typeof topic.chapter === "string" ? topic.chapter.slice(0, 120) : undefined,
      },
      examQuestions: Array.isArray(body.examQuestions)
        ? body.examQuestions
            .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
            .slice(0, MAX_EXAM_QUESTIONS)
            .map((q) => q.slice(0, 400))
        : [],
    };
  }

  return {
    scope: "document",
    subject: body.subject.slice(0, 120),
    syllabus: body.syllabus.slice(0, MAX_SYLLABUS_CHARS),
    language: body.language,
    unit: typeof body.unit === "string" ? body.unit.slice(0, 160) : undefined,
    topicTitles: Array.isArray(body.topicTitles)
      ? body.topicTitles
          .filter((t): t is { title: string; chapter?: string } => Boolean(t) && typeof t.title === "string")
          .slice(0, 120)
          .map((t) => ({ title: t.title.slice(0, 200), chapter: t.chapter?.slice(0, 120) }))
      : [],
  };
}

/* ---------------------------------- POST ---------------------------------- */

export async function POST(request: Request): Promise<Response> {
  const json = (body: NotesGenerationResponse, status = 200): Response =>
    Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (throttled(ip)) return json({ ok: false, reason: "throttled" }, 429);

  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) return json({ ok: false, reason: "no-key" }, 503);

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return json({ ok: false, reason: "bad-request" }, 400);
  }
  const body = parseBody(rawBody);
  if ("error" in body) return json({ ok: false, reason: "bad-request" }, 400);

  const hash = fnv1a(JSON.stringify(body));
  const cached = cacheGet(hash);
  if (cached) return json(cached);

  try {
    if (body.scope === "topic") {
      const text = await generate(key, topicPrompt(body), true);
      const parsed = parseJson(text) as { detailed?: unknown; notes?: unknown; cards?: unknown };
      const detailed = normalizeDetailed(parsed?.detailed);
      const notes = normalizeSections(parsed?.notes);
      const cards = normalizeCards(parsed?.cards);
      if (detailed.length === 0) throw new UpstreamError("empty-notes");

      const response: NotesGenerationResponse = {
        ok: true,
        detailed,
        notes,
        cards,
        source: "ai",
        via: "server",
      };
      cacheSet(hash, response);
      return json(response);
    }

    const markdown = await generate(key, documentPrompt(body), false);
    if (markdown.length < 200) throw new UpstreamError("empty-document");
    const response: NotesGenerationResponse = {
      ok: true,
      markdown,
      source: "ai",
      via: "server",
    };
    cacheSet(hash, response);
    return json(response);
  } catch (err) {
    if (err instanceof TimeoutError) return json({ ok: false, reason: "timeout" }, 504);
    if (err instanceof UpstreamError) {
      if (/^http-(400|401|403)$/.test(err.message)) {
        return json({ ok: false, reason: "no-key" }, 503);
      }
      return json({ ok: false, reason: "upstream" }, 502);
    }
    return json({ ok: false, reason: "upstream" }, 502);
  }
}
