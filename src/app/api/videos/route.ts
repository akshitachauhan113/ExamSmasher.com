import { getLlmConfig } from "@/lib/llm";
import type { Difficulty, Importance, Topic, VideosResponse } from "@/lib/types";
import { analyzeTopic } from "@/lib/videos";

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    topic?: Partial<Topic>;
    language?: unknown;
    subject?: unknown;
    limit?: unknown;
  } | null;

  const topic = normalizeTopic(body?.topic);
  if (!topic) {
    return Response.json(
      { ok: false, error: "Send a valid `topic` object with at least a title." },
      { status: 400 },
    );
  }

  const languageCode =
    typeof body?.language === "string" && body.language.trim()
      ? body.language.trim()
      : "en";
  const subject = typeof body?.subject === "string" ? body.subject.trim().slice(0, 80) : "";
  const limit = Number.isFinite(Number(body?.limit))
    ? Math.min(10, Math.max(1, Math.round(Number(body?.limit))))
    : 4;

  const useAi = Boolean(getLlmConfig());

  const result = await analyzeTopic(topic, {
    languageCode,
    subject,
    limit,
    useAi,
  });

  const response: VideosResponse = { ok: true, result };
  return Response.json(response);
}

function normalizeTopic(raw: Partial<Topic> | undefined | null): Topic | null {
  if (!raw || typeof raw.title !== "string" || raw.title.trim().length < 2) return null;

  const importance: Importance =
    raw.importance === "core" || raw.importance === "bonus" || raw.importance === "important"
      ? raw.importance
      : "important";
  const difficulty: Difficulty =
    raw.difficulty === "beginner" || raw.difficulty === "advanced" || raw.difficulty === "intermediate"
      ? raw.difficulty
      : "intermediate";

  return {
    id: typeof raw.id === "string" ? raw.id : "t1",
    title: raw.title.trim().slice(0, 120),
    description: typeof raw.description === "string" ? raw.description.slice(0, 400) : "",
    keywords: Array.isArray(raw.keywords)
      ? raw.keywords
          .filter((k): k is string => typeof k === "string")
          .map((k) => k.trim().slice(0, 60))
          .filter(Boolean)
          .slice(0, 8)
      : [],
    importance,
    difficulty,
    estimatedMinutes: Number.isFinite(Number(raw.estimatedMinutes))
      ? Math.min(240, Math.max(5, Math.round(Number(raw.estimatedMinutes))))
      : 20,
    chapter: typeof raw.chapter === "string" ? raw.chapter.slice(0, 60) : undefined,
  };
}
