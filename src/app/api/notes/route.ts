import { generateJSON, getLlmConfig } from "@/lib/llm";
import { buildNotesPrompt } from "@/lib/prompts";
import type {
  DetailedSection,
  Flashcard,
  NotesResponse,
  NotesSection,
  Topic,
} from "@/lib/types";

const MAX_CARDS = 16;
const MAX_SECTIONS = 6;
const MAX_PARAGRAPHS = 4;

interface RawSection {
  heading?: unknown;
  bullets?: unknown;
}

interface RawDetailedSection {
  heading?: unknown;
  paragraphs?: unknown;
}

interface RawCard {
  q?: unknown;
  a?: unknown;
}

function asString(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Level 2 — short dense bullets (fast revision). */
function normalizeSections(raw: unknown): NotesSection[] {
  return (Array.isArray(raw) ? raw : [])
    .map((section: RawSection) => ({
      heading: asString(section?.heading, 120),
      bullets: Array.isArray(section?.bullets)
        ? section.bullets
            .filter((b): b is string => typeof b === "string" && b.trim().length > 0)
            .map((b) => b.trim().slice(0, 220))
            .slice(0, 8)
        : [],
    }))
    .filter((section) => section.heading && section.bullets.length > 0)
    .slice(0, MAX_SECTIONS);
}

/** Level 1 — detailed paragraphs (concept clarity, first-time learning). */
function normalizeDetailed(raw: unknown): DetailedSection[] {
  return (Array.isArray(raw) ? raw : [])
    .map((section: RawDetailedSection) => ({
      heading: asString(section?.heading, 120),
      paragraphs: Array.isArray(section?.paragraphs)
        ? section.paragraphs
            .filter(
              (p): p is string => typeof p === "string" && p.trim().length > 20,
            )
            .map((p) => p.trim().slice(0, 900))
            .slice(0, MAX_PARAGRAPHS)
        : [],
    }))
    .filter((section) => section.heading && section.paragraphs.length > 0)
    .slice(0, MAX_SECTIONS);
}

/** Level 3 — flashcards (active recall). */
function normalizeCards(raw: unknown): Flashcard[] {
  return (Array.isArray(raw) ? raw : [])
    .map((card: RawCard) => ({
      q: asString(card?.q, 240),
      a: asString(card?.a, 320),
    }))
    .filter((card) => card.q && card.a)
    .slice(0, MAX_CARDS);
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    topic?: Partial<Topic>;
    subject?: unknown;
    syllabus?: unknown;
    language?: unknown;
  } | null;

  const title = typeof body?.topic?.title === "string" ? body.topic.title.trim() : "";
  if (!title) {
    return Response.json(
      { ok: false, error: "Send a `topic` object with a title." },
      { status: 400 },
    );
  }

  const config = getLlmConfig();
  if (!config) {
    return Response.json(
      {
        ok: false,
        error: "Notes need an AI key. Open “API Keys” in the header and add GEMINI_API_KEY.",
      },
      { status: 503 },
    );
  }

  const topic: Topic = {
    id: body?.topic?.id ?? `t-${Date.now()}`,
    title,
    description: typeof body?.topic?.description === "string" ? body.topic.description : "",
    keywords: Array.isArray(body?.topic?.keywords)
      ? body.topic?.keywords?.filter((k): k is string => typeof k === "string").slice(0, 8) ?? []
      : [],
    importance: body?.topic?.importance ?? "important",
    difficulty: body?.topic?.difficulty ?? "intermediate",
    estimatedMinutes: Number(body?.topic?.estimatedMinutes) || 20,
    chapter: typeof body?.topic?.chapter === "string" ? body.topic.chapter : undefined,
  };

  const { system, prompt } = buildNotesPrompt({
    topic,
    subject: typeof body?.subject === "string" ? body.subject.slice(0, 80) : undefined,
    syllabus: typeof body?.syllabus === "string" ? body.syllabus : undefined,
    language: body?.language === "hinglish" ? "hinglish" : "english",
  });

  try {
    const parsed = await generateJSON<{
      detailed?: RawDetailedSection[];
      notes?: RawSection[];
      cards?: RawCard[];
    }>(prompt, {
      system,
      temperature: 0.3,
      // Three levels in one shot — needs more room than the old two-level reply.
      maxOutputTokens: 16384,
      timeoutMs: 90_000,
    });

    const detailed = normalizeDetailed(parsed.detailed);
    const notes = normalizeSections(parsed.notes);
    const cards = normalizeCards(parsed.cards);

    if (notes.length === 0 && detailed.length === 0) {
      return Response.json(
        { ok: false, error: "The AI returned empty notes — try generating again." },
        { status: 502 },
      );
    }

    const json: NotesResponse = { ok: true, detailed, notes, cards };
    return Response.json(json);
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Note generation failed." },
      { status: 502 },
    );
  }
}
