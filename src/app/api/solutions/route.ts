import { generateText, getLlmConfig } from "@/lib/llm";
import { mapWithConcurrency } from "@/lib/videos";
import { buildSolutionsPrompt } from "@/lib/prompts";
import type { QuestionDifficulty, SolutionEntry, SolutionsResponse } from "@/lib/types";

const MAX_PAPERS = 6;
const MAX_QUESTIONS_PER_PAPER = 40;
/** Long answers do not fit 8 at a time without cutting off mid-paper. */
const BATCH_SIZE = 8;

interface PaperBody {
  label?: unknown;
  year?: unknown;
  questions?: Array<{ text?: unknown; marks?: unknown; number?: unknown }>;
}

const DIFFICULTIES = new Set<QuestionDifficulty>(["easy", "medium", "hard"]);

/**
 * The solved form of every uploaded paper: each question with its model
 * answer directly attached, plus easy/medium/hard and important tags — so the
 * page can show a solved paper instead of a separate answer key.
 *
 * The model answers in a plain-text block format (NOT JSON) because the
 * answers are full of LaTeX, and Gemini's JSON mode mangles LaTeX backslashes
 * into invalid JSON. Blocks are parsed here.
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
    // preserved so the solved paper lines up with the sheet the student holds.
    const solved = await mapWithConcurrency(papers, 2, async (paper) => {
      const entries: SolutionEntry[] = [];

      for (let offset = 0; offset < paper.questions.length; offset += BATCH_SIZE) {
        const batch = paper.questions.slice(offset, offset + BATCH_SIZE);
        const text = await solveBatch(subject, {
          label: paper.label,
          year: paper.year,
          questions: batch,
        });

        for (const block of parseAnswerBlocks(text)) {
          // The model numbers blocks 1..batch.length — translate to the
          // paper-wide position the client sent us.
          if (block.index < 1 || block.index > batch.length || !block.answer) continue;
          entries.push({
            index: offset + block.index,
            answer: block.answer.slice(0, 6000),
            difficulty: DIFFICULTIES.has(block.difficulty) ? block.difficulty : "medium",
            important: block.important,
          });
        }
      }

      return { label: paper.label, year: paper.year, entries };
    });

    const usable = solved.filter((paper) => paper.entries.length > 0);
    if (usable.length === 0) {
      return Response.json(
        { ok: false, error: "Solutions khali aa gaye — ek baar dobara try karo." },
        { status: 502 },
      );
    }

    const response: SolutionsResponse = { ok: true, papers: usable };
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

/** One batch of ONE paper's questions -> the model's raw block-format reply. */
async function solveBatch(
  subject: string,
  paper: {
    label: string;
    year: string;
    questions: Array<{ text: string; marks?: number; number?: string }>;
  },
): Promise<string> {
  const { system, prompt } = buildSolutionsPrompt({ subject, paper });
  return generateText(prompt, {
    system,
    temperature: 0.2,
    maxOutputTokens: 8192,
    timeoutMs: 120_000,
  });
}

interface AnswerBlock {
  index: number;
  answer: string;
  difficulty: QuestionDifficulty;
  important: boolean;
}

/**
 * Splits the reply on "###ANSWER n | difficulty=x | important=y" header lines.
 * The body keeps every character verbatim — LaTeX included — so nothing is
 * lost to escaping on the way back to the page.
 */
function parseAnswerBlocks(text: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  // Match a header line, capture the three fields, then everything until the
  // next header (or end of reply).
  const header = /^###ANSWER\s+(\d+)\s*\|?\s*difficulty\s*=\s*(\w+)\s*\|?\s*important\s*=\s*(\w+)/gim;
  const matches = [...text.matchAll(header)];
  if (matches.length === 0) return blocks;

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const index = Number(match[1]);
    const difficultyRaw = (match[2] ?? "").toLowerCase();
    const importantRaw = (match[3] ?? "").toLowerCase();

    const bodyStart = match.index! + match[0].length;
    const bodyEnd = i + 1 < matches.length ? matches[i + 1].index! : text.length;
    const answer = text.slice(bodyStart, bodyEnd).trim();

    blocks.push({
      index,
      answer,
      difficulty: (DIFFICULTIES.has(difficultyRaw as QuestionDifficulty)
        ? difficultyRaw
        : "medium") as QuestionDifficulty,
      important: importantRaw === "yes" || importantRaw === "true",
    });
  }

  return blocks;
}
