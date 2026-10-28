import { generateJSON, getLlmConfig } from "@/lib/llm";
import { buildAnalyzePrompt } from "@/lib/prompts";
import type { AnalyzeResponse, Difficulty, Importance, Topic } from "@/lib/types";

const MAX_SYLLABUS_CHARS = 24000;
const DEFAULT_MAX_TOPICS = 14;
const MAX_TOPICS = 20;

/**
 * Bigger syllabus -> proportionally more topics. Without this a whole
 * semester's syllabus could collapse into a handful of topics and the
 * student would only ever see a few videos.
 */
function autoMaxTopics(syllabus: string): number {
  const headings = (syllabus.match(/\b(unit|chapter|module|paper|lesson|topic)\b/gi) || []).length;
  const byLength = Math.ceil(syllabus.length / 500);
  const byHeadings = Math.ceil(headings * 1.4);
  return Math.min(MAX_TOPICS, Math.max(6, Math.max(byLength, byHeadings, DEFAULT_MAX_TOPICS - 4)));
}

interface RawTopic {
  title?: unknown;
  description?: unknown;
  keywords?: unknown;
  importance?: unknown;
  difficulty?: unknown;
  estimatedMinutes?: unknown;
  chapter?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    syllabus?: unknown;
    subject?: unknown;
    maxTopics?: unknown;
  } | null;

  if (!body || typeof body.syllabus !== "string") {
    return Response.json(
      { ok: false, error: "Send a JSON body with a `syllabus` string." },
      { status: 400 },
    );
  }

  const syllabus = body.syllabus.trim();
  if (syllabus.length < 20) {
    return Response.json(
      {
        ok: false,
        error: "Syllabus is too short — paste at least a few lines so topics can be extracted.",
      },
      { status: 400 },
    );
  }
  if (syllabus.length > MAX_SYLLABUS_CHARS) {
    return Response.json(
      {
        ok: false,
        error: `Syllabus is too long (${syllabus.length} chars). Keep it under ${MAX_SYLLABUS_CHARS} characters — trim fluff like page numbers and instructions.`,
      },
      { status: 400 },
    );
  }

  const config = getLlmConfig();
  if (!config) {
    return Response.json(
      {
        ok: false,
        error:
          "No AI key configured. Add GEMINI_API_KEY to .env.local (free at aistudio.google.com) and restart the server.",
      },
      { status: 401 },
    );
  }

  const subject = typeof body.subject === "string" ? body.subject.trim().slice(0, 80) : "";
  const maxTopics = clampInt(body.maxTopics, 3, MAX_TOPICS, autoMaxTopics(syllabus));

  const { system, prompt } = buildAnalyzePrompt({
    syllabus,
    subject,
    languageLabel: "English",
    maxTopics,
  });

  let parsed: { subject?: string; topics?: RawTopic[] };
  try {
    parsed = await generateJSON<{ subject?: string; topics?: RawTopic[] }>(prompt, {
      system,
      temperature: 0.2,
      maxOutputTokens: 12_288,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "The AI could not analyse this syllabus.";
    return Response.json({ ok: false, error: message }, { status: 502 });
  }

  const topics = normalizeTopics(parsed.topics ?? []);
  if (topics.length === 0) {
    return Response.json(
      {
        ok: false,
        error:
          "No topics could be extracted. Paste the actual syllabus content (chapter names, unit list) rather than a photo description or a link.",
      },
      { status: 422 },
    );
  }

  const response: AnalyzeResponse = {
    ok: true,
    subject: (subject || parsed.subject || "Your course").slice(0, 80),
    topics,
    truncated: topics.length >= maxTopics,
    provider: config.provider,
  };

  return Response.json(response);
}

function normalizeTopics(raw: RawTopic[]): Topic[] {
  const validImportance: Importance[] = ["core", "important", "bonus"];
  const validDifficulty: Difficulty[] = ["beginner", "intermediate", "advanced"];

  return raw
    .filter((t) => typeof t?.title === "string" && t.title.trim().length > 1)
    .map((t, index) => {
      const keywords = Array.isArray(t.keywords)
        ? (t.keywords as unknown[])
            .filter((k): k is string => typeof k === "string")
            .map((k) => k.trim().slice(0, 60))
            .filter(Boolean)
            .slice(0, 8)
        : [];

      const importance =
        typeof t.importance === "string" &&
        (validImportance as string[]).includes(t.importance)
          ? (t.importance as Importance)
          : "important";

      const difficulty =
        typeof t.difficulty === "string" &&
        (validDifficulty as string[]).includes(t.difficulty)
          ? (t.difficulty as Difficulty)
          : "intermediate";

      const minutes = clampInt(t.estimatedMinutes, 5, 240, 20);

      return {
        id: `t${index + 1}`,
        title: String(t.title).trim().slice(0, 120),
        description:
          typeof t.description === "string" && t.description.trim()
            ? t.description.trim().slice(0, 400)
            : "",
        keywords:
          keywords.length > 0
            ? keywords
            : String(t.title)
                .split(/\s+/)
                .slice(0, 5),
        importance,
        difficulty,
        estimatedMinutes: minutes,
        chapter:
          typeof t.chapter === "string" && t.chapter.trim()
            ? t.chapter.trim().slice(0, 60)
            : undefined,
      } satisfies Topic;
    })
    .slice(0, 40);
}

function clampInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}
