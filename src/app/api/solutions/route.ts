import { generateText, getLlmConfig } from "@/lib/llm";
import { mapWithConcurrency } from "@/lib/videos";
import { buildSolutionsPrompt } from "@/lib/prompts";

const MAX_PAPERS = 6;
const MAX_QUESTIONS_PER_PAPER = 40;
/** Long answers do not fit 25 at a time without cutting off mid-paper. */
const BATCH_SIZE = 8;

interface SolutionsResponse {
  ok: boolean;
  markdown?: string;
  error?: string;
}

interface PaperBody {
  label?: unknown;
  year?: unknown;
  questions?: Array<{ text?: unknown; marks?: unknown; number?: unknown }>;
}

/**
 * The complete answer key for every uploaded paper, in the order each paper
 * printed its questions.
 *
 * Papers run in parallel, questions inside a paper run in batches of 8 — enough
 * concurrency to be quick, small enough that an answer is never truncated
 * mid-question.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    subject?: unknown;
    papers?: PaperBody[];
  } | null;

  const config = getLlmConfig();
  if (!config) {
    return Response.json(
      {
        ok: false,
        error: "Solutions ke liye AI key chahiye — “API Keys” se GEMINI_API_KEY daalo.",
      },
      { status: 503 },
    );
  }

  const subject =
    typeof body?.subject === "string" && body.subject.trim()
      ? body.subject.trim().slice(0, 80)
      : "this course";

  const papers = (Array.isArray(body?.papers) ? body.papers : [])
    .slice(0, MAX_PAPERS)
    .map((paper) => {
      const questions = (Array.isArray(paper?.questions) ? paper.questions : [])
        .map((q) => ({
          text: typeof q?.text === "string" ? q.text.trim().slice(0, 900) : "",
          marks:
            Number.isFinite(Number(q?.marks)) && Number(q?.marks) > 0
              ? Math.round(Number(q.marks))
              : undefined,
          number: typeof q?.number === "string" ? q.number.trim().slice(0, 20) : undefined,
        }))
        .filter((q) => q.text.length > 5)
        .slice(0, MAX_QUESTIONS_PER_PAPER);

      return {
        label: typeof paper?.label === "string" && paper.label.trim() ? paper.label.trim().slice(0, 40) : "Question paper",
        year: typeof paper?.year === "string" ? paper.year.trim().slice(0, 12) : "",
        questions,
      };
    })
    .filter((paper) => paper.questions.length > 0);

  if (papers.length === 0) {
    return Response.json(
      {
        ok: false,
        error:
          "Solutions banane ke liye sawaal chahiye — pehle PYQ papers upload karke “Read questions” chalao.",
      },
      { status: 400 },
    );
  }

  try {
    // Papers first, batches inside each — order of questions within a paper is
    // preserved so the key lines up with the sheet the student is holding.
    const perPaper = await mapWithConcurrency(papers, 2, async (paper) => {
      const batches: Array<{ text: string; marks?: number; number?: string }[]> = [];
      for (let i = 0; i < paper.questions.length; i += BATCH_SIZE) {
        batches.push(paper.questions.slice(i, i + BATCH_SIZE));
      }

      const parts = await mapWithConcurrency(batches, 2, (questions) =>
        writeSolutions(subject, { label: paper.label, year: paper.year, questions }),
      );

      const heading = `## 📝 ${paper.label} ${paper.year} — solutions (${paper.questions.length} questions)`;
      return [heading, ...parts].join("\n\n");
    });

    const markdown = perPaper
      .join("\n\n---\n\n")
      .replace(/\n{4,}/g, "\n\n\n")
      .trim();

    if (!markdown) {
      return Response.json(
        { ok: false, error: "Solutions khali aa gaye — ek baar dobara try karo." },
        { status: 502 },
      );
    }

    const response: SolutionsResponse = { ok: true, markdown };
    return Response.json(response);
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Solutions banate waqt dikkat aa gayi.",
      },
      { status: 502 },
    );
  }
}

async function writeSolutions(
  subject: string,
  paper: {
    label: string;
    year: string;
    questions: Array<{ text: string; marks?: number; number?: string }>;
  },
): Promise<string> {
  const { system, prompt } = buildSolutionsPrompt({ subject, paper });
  const out = await generateText(prompt, {
    system,
    temperature: 0.2,
    maxOutputTokens: 8192,
    timeoutMs: 120_000,
  });
  return out.trim();
}
