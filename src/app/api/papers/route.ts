import { generateJSON, getLlmConfig } from "@/lib/llm";
import { normalizeParsedQuestions, type PaperInput } from "@/lib/exam";
import { buildParsePapersPrompt } from "@/lib/prompts";
import type { PyqPaper, PyqQuestion } from "@/lib/types";

const MAX_PAPERS = 6;
const MAX_PAPER_CHARS = 12_000;

interface PapersResponse {
  ok: boolean;
  questions?: PyqQuestion[];
  papers?: PyqPaper[];
  dropped?: number;
  error?: string;
}

/**
 * Reads previous-year papers and returns their questions, structured and
 * traceable to the paper each one came from. Nothing is invented — if a paper
 * is unreadable it contributes zero questions and says so.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    subject?: unknown;
    papers?: Array<{ id?: unknown; year?: unknown; label?: unknown; text?: unknown }>;
  } | null;

  const rawPapers = Array.isArray(body?.papers) ? body.papers : [];
  if (rawPapers.length === 0) {
    return Response.json(
      { ok: false, error: "Send at least one paper with its extracted text." },
      { status: 400 },
    );
  }
  if (rawPapers.length > MAX_PAPERS) {
    return Response.json(
      { ok: false, error: `Upload at most ${MAX_PAPERS} papers at a time.` },
      { status: 400 },
    );
  }

  const config = getLlmConfig();
  if (!config) {
    return Response.json(
      {
        ok: false,
        error: "Reading papers needs an AI key. Open “API Keys” and add GEMINI_API_KEY.",
      },
      { status: 503 },
    );
  }

  const subject = typeof body?.subject === "string" ? body.subject.trim().slice(0, 80) : "";

  const papers: PaperInput[] = [];
  const usable: Array<PaperInput & { text: string }> = [];

  rawPapers.forEach((raw, index) => {
    const text = typeof raw?.text === "string" ? raw.text.trim() : "";
    if (text.length < 40) return;

    const id = typeof raw.id === "string" && raw.id ? raw.id : `p${index + 1}`;
    const year =
      typeof raw.year === "string" && raw.year.trim()
        ? raw.year.trim().slice(0, 12)
        : `Paper ${index + 1}`;
    const label =
      typeof raw.label === "string" && raw.label.trim()
        ? raw.label.trim().slice(0, 40)
        : "Question paper";

    const entry = { id, year, label };
    papers.push(entry);
    usable.push({ ...entry, text: text.slice(0, MAX_PAPER_CHARS) });
  });

  if (papers.length === 0) {
    return Response.json(
      { ok: false, error: "None of the papers had readable text — try clearer photos." },
      { status: 422 },
    );
  }

  try {
    const { system, prompt } = buildParsePapersPrompt({
      subject,
      papers: usable,
    });

    const parsed = await generateJSON<{ questions?: unknown[] }>(prompt, {
      system,
      temperature: 0,
      maxOutputTokens: 16_384,
      timeoutMs: 120_000,
    });

    const { questions, papers: counted, dropped } = normalizeParsedQuestions(
      parsed.questions,
      papers,
    );

    if (questions.length === 0) {
      return Response.json(
        {
          ok: false,
          error:
            "No questions could be read from these papers. If they are photos, try a straight-on shot with even lighting — blurry scans read as garbage.",
        },
        { status: 422 },
      );
    }

    const response: PapersResponse = {
      ok: true,
      questions,
      papers: counted,
      dropped,
    };
    return Response.json(response);
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not read the papers." },
      { status: 502 },
    );
  }
}
