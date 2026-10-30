import { generateJSON, getLlmConfig } from "@/lib/llm";
import { buildQuizPrompt } from "@/lib/prompts";
import type { QuizQuestion, QuizResponse, Topic } from "@/lib/types";

const MAX_QUESTIONS = 20;
const MIN_QUESTIONS = 3;

/**
 * Builds a practice quiz from the student's REAL past questions, so practice
 * matches what their exam actually asks rather than a generic question bank.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    subject?: unknown;
    count?: unknown;
    topics?: Array<Partial<Topic> & { pastQuestions?: string[] }>;
  } | null;

  const config = getLlmConfig();
  if (!config) {
    return Response.json(
      { ok: false, error: "Quizzes need an AI key. Open “API Keys” and add GEMINI_API_KEY." },
      { status: 503 },
    );
  }

  const rawTopics = Array.isArray(body?.topics) ? body.topics : [];
  const topics = rawTopics
    .filter((t) => typeof t?.id === "string" && typeof t?.title === "string")
    .map((t) => ({
      id: t.id as string,
      title: (t.title as string).slice(0, 120),
      pastQuestions: Array.isArray(t.pastQuestions)
        ? t.pastQuestions
            .filter((q): q is string => typeof q === "string" && q.trim().length > 5)
            .map((q) => q.trim().slice(0, 300))
            .slice(0, 6)
        : [],
    }))
    .filter((t) => t.title.length > 1);

  if (topics.length === 0) {
    return Response.json(
      { ok: false, error: "Send the topics you want to be quizzed on." },
      { status: 400 },
    );
  }

  const requested = Number(body?.count);
  const count = Math.min(
    MAX_QUESTIONS,
    Math.max(MIN_QUESTIONS, Number.isFinite(requested) ? Math.round(requested) : 8),
  );

  const subject = typeof body?.subject === "string" ? body.subject.trim().slice(0, 80) : "";

  try {
    const { system, prompt } = buildQuizPrompt({ subject, topics, count });
    const parsed = await generateJSON<{ questions?: unknown[] }>(prompt, {
      system,
      temperature: 0.4,
      maxOutputTokens: 8192,
      timeoutMs: 90_000,
    });

    const questions = normalizeQuiz(parsed.questions);
    if (questions.length === 0) {
      return Response.json(
        { ok: false, error: "The AI returned no usable questions — try again." },
        { status: 502 },
      );
    }

    const response: QuizResponse = { ok: true, questions };
    return Response.json(response);
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Quiz generation failed." },
      { status: 502 },
    );
  }
}

interface RawQuizQuestion {
  id?: unknown;
  question?: unknown;
  options?: unknown;
  answer?: unknown;
  explanation?: unknown;
  topicId?: unknown;
}

/**
 * Drops anything malformed rather than showing a broken quiz: a question with
 * fewer than two options, or an answer index pointing outside the options,
 * would silently mark correct answers wrong.
 */
function normalizeQuiz(raw: unknown): QuizQuestion[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: QuizQuestion[] = [];

  for (const item of list) {
    const q = item as RawQuizQuestion;
    const text = typeof q?.question === "string" ? q.question.trim() : "";
    const options = Array.isArray(q?.options)
      ? q.options
          .filter((o): o is string => typeof o === "string" && o.trim().length > 0)
          .map((o) => o.trim().slice(0, 200))
          .slice(0, 6)
      : [];
    const answer = Number(q?.answer);

    if (text.length < 8) continue;
    if (options.length < 2) continue;
    if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) continue;

    out.push({
      id: typeof q.id === "string" && q.id ? q.id.slice(0, 40) : `q${out.length + 1}`,
      question: text.slice(0, 400),
      options,
      answer,
      explanation:
        typeof q.explanation === "string" ? q.explanation.trim().slice(0, 400) : "",
      topicId: typeof q.topicId === "string" && q.topicId ? q.topicId.slice(0, 40) : undefined,
    });
  }

  return out;
}
