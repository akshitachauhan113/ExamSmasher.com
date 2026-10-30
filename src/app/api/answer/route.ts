import { generateText, getLlmConfig } from "@/lib/llm";
import { buildAnswerPrompt } from "@/lib/prompts";

interface AnswerResponse {
  ok: boolean;
  answer?: string;
  error?: string;
}

/**
 * Writes a model answer for ONE real past question, scaled to its marks.
 * Used while practising PYQs so the student can compare their attempt against
 * what an examiner actually wants to see.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    question?: unknown;
    subject?: unknown;
    topicTitle?: unknown;
    marks?: unknown;
    year?: unknown;
  } | null;

  const question = typeof body?.question === "string" ? body.question.trim() : "";
  if (question.length < 8) {
    return Response.json(
      { ok: false, error: "Send the `question` text you want an answer for." },
      { status: 400 },
    );
  }

  const config = getLlmConfig();
  if (!config) {
    return Response.json(
      {
        ok: false,
        error: "Model answers need an AI key. Open “API Keys” and add GEMINI_API_KEY.",
      },
      { status: 503 },
    );
  }

  const marks = Number.isFinite(Number(body?.marks)) && Number(body?.marks) > 0
    ? Math.min(100, Math.round(Number(body?.marks)))
    : undefined;

  const { system, prompt } = buildAnswerPrompt({
    question: question.slice(0, 1200),
    subject: typeof body?.subject === "string" ? body.subject.slice(0, 80) : "",
    topicTitle:
      typeof body?.topicTitle === "string" ? body.topicTitle.slice(0, 120) : undefined,
    marks,
    year: typeof body?.year === "string" ? body.year.slice(0, 12) : undefined,
  });

  try {
    const answer = await generateText(prompt, {
      system,
      temperature: 0.3,
      maxOutputTokens: 2048,
      timeoutMs: 60_000,
    });

    if (!answer.trim()) {
      return Response.json(
        { ok: false, error: "The AI returned an empty answer — try again." },
        { status: 502 },
      );
    }

    const response: AnswerResponse = { ok: true, answer: answer.trim() };
    return Response.json(response);
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not write an answer." },
      { status: 502 },
    );
  }
}
