import { generateJSON, getLlmConfig } from "@/lib/llm";
import { buildNotesPrompt } from "@/lib/prompts";
import type { Flashcard, NotesResponse, NotesSection, Topic } from "@/lib/types";

const MAX_CARDS = 14;

interface RawSection {
  heading?: unknown;
  bullets?: unknown;
}

interface RawCard {
  q?: unknown;
  a?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    topic?: Partial<Topic>;
    subject?: unknown;
    syllabus?: unknown;
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
  });

  try {
    const parsed = await generateJSON<{ notes?: RawSection[]; cards?: RawCard[] }>(prompt, {
      system,
      temperature: 0.3,
      maxOutputTokens: 8192,
    });

    const notes: NotesSection[] = (Array.isArray(parsed.notes) ? parsed.notes : [])
      .map((section) => ({
        heading: typeof section.heading === "string" ? section.heading.trim().slice(0, 120) : "",
        bullets: Array.isArray(section.bullets)
          ? section.bullets
              .filter((b): b is string => typeof b === "string" && b.trim().length > 0)
              .map((b) => b.trim().slice(0, 220))
              .slice(0, 8)
          : [],
      }))
      .filter((section) => section.heading && section.bullets.length > 0);

    const cards: Flashcard[] = (Array.isArray(parsed.cards) ? parsed.cards : [])
      .map((card) => ({
        q: typeof card.q === "string" ? card.q.trim().slice(0, 240) : "",
        a: typeof card.a === "string" ? card.a.trim().slice(0, 320) : "",
      }))
      .filter((card) => card.q && card.a)
      .slice(0, MAX_CARDS);

    if (notes.length === 0) {
      return Response.json(
        { ok: false, error: "The AI returned empty notes — try generating again." },
        { status: 502 },
      );
    }

    const json: NotesResponse = { ok: true, notes, cards };
    return Response.json(json);
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Note generation failed." },
      { status: 502 },
    );
  }
}
