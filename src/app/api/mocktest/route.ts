import { generateText, getLlmConfig } from "@/lib/llm";
import { buildMockTestPrompt } from "@/lib/prompts";
import type { ExamTopic, PyqQuestion } from "@/lib/types";

const MAX_QUESTIONS = 60;

interface MockTestResponse {
  ok: boolean;
  markdown?: string;
  /** Structure actually detected — echoed back so the UI can state the match. */
  structure?: { sections: number; totalMarks: number; years: string };
  error?: string;
}

/**
 * Sets a practice paper that copies the SHAPE of the student's real papers —
 * sections, question counts, marks per question, question mix — while asking
 * fresh questions on whatever their papers keep returning to.
 *
 * The shape is derived deterministically from the uploaded questions, so
 * "same pattern" is a measured claim, not the model's opinion of one.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    subject?: unknown;
    questions?: PyqQuestion[];
    topics?: Array<Pick<ExamTopic, "topic" | "signal">>;
  } | null;

  const config = getLlmConfig();
  if (!config) {
    return Response.json(
      {
        ok: false,
        error: "Mock test ke liye AI key chahiye — “API Keys” se GEMINI_API_KEY daalo.",
      },
      { status: 503 },
    );
  }

  const subject =
    typeof body?.subject === "string" && body.subject.trim()
      ? body.subject.trim().slice(0, 80)
      : "this course";

  const questions = (Array.isArray(body?.questions) ? body.questions : [])
    .filter((q) => typeof q?.text === "string" && q.text.trim().length > 5)
    .slice(0, MAX_QUESTIONS);

  if (questions.length === 0) {
    return Response.json(
      {
        ok: false,
        error:
          "Mock test banane ke liye real sawaal chahiye — pehle PYQ papers padho, phir yahan aao.",
      },
      { status: 400 },
    );
  }

  const examTopics = (Array.isArray(body?.topics) ? body.topics : [])
    .filter((entry) => entry?.topic?.title)
    .map((entry) => ({
      title: entry.topic.title,
      trend: entry.signal?.trend ?? "rare",
      pastQuestions: (entry.signal?.questions ?? [])
        .filter((q) => q.isVariant !== true)
        .map((q) => q.text)
        .slice(0, 4),
    }));

  const structure = deriveStructure(questions);

  if (structure.totalMarks <= 0) {
    return Response.json(
      {
        ok: false,
        error:
          "In papers se koi marks pattern nahi nikla — marks likhe hue hain unhe padha nahi ja saka.",
      },
      { status: 422 },
    );
  }

  try {
    const { system, prompt } = buildMockTestPrompt({ subject, structure, topics: examTopics });
    const markdown = (
      await generateText(prompt, {
        system,
        temperature: 0.5,
        maxOutputTokens: 12_288,
        timeoutMs: 150_000,
      })
    ).trim();

    if (!markdown) {
      return Response.json(
        { ok: false, error: "Mock test khali aa gaya — ek baar dobara try karo." },
        { status: 502 },
      );
    }

    const response: MockTestResponse = {
      ok: true,
      markdown,
      structure: {
        sections: structure.sections.length,
        totalMarks: structure.totalMarks,
        years: structure.years,
      },
    };
    return Response.json(response);
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Mock test banate waqt dikkat aa gayi.",
      },
      { status: 502 },
    );
  }
}

/* -------------------------------------------------------------------------- */

interface SectionSpec {
  name: string;
  count: number;
  marksEach: number;
  type: string;
}

interface Structure {
  sections: SectionSpec[];
  totalMarks: number;
  years: string;
}

/**
 * Reads the exam's real shape out of the uploaded questions.
 *
 * Prefers the paper's own section labels. When a paper has none, it groups by
 * marks instead — which is still the student's real pattern, because a paper
 * that asks 2-mark then 6-mark then 10-mark questions has a shape regardless of
 * whether it labelled them "Section A".
 */
function deriveStructure(questions: PyqQuestion[]): Structure {
  const papers = new Set(questions.map((q) => `${q.paperLabel}|${q.paperYear}`));
  const perPaper = Math.max(1, papers.size);
  const years = [...new Set(questions.map((q) => q.paperYear).filter(Boolean))]
    .sort()
    .join(", ");

  const label =
    questions.find((q) => q.section?.trim())?.section?.trim() ?? "Section";

  let sections: SectionSpec[] = [];
  const printedSections = [
    ...new Set(questions.map((q) => q.section?.trim()).filter(Boolean)),
  ] as string[];

  if (printedSections.length >= 2) {
    sections = printedSections.map((name) => {
      const group = questions.filter((q) => q.section?.trim() === name);
      return {
        name: `${name}`,
        count: Math.max(1, Math.round(group.length / perPaper)),
        marksEach: mode(group.map((q) => q.marks).filter(isNumber)) ?? 5,
        type: dominantType(group),
      };
    });
  } else {
    const marks = questions.map((q) => q.marks).filter(isNumber);
    if (marks.length > 0) {
      sections = tiersFromMarks(marks).map((tier, index) => {
        const group = questions.filter(
          (q) => typeof q.marks === "number" && q.marks >= tier.min && q.marks <= tier.max,
        );
        const marksEach =
          tier.min === tier.max
            ? tier.min
            : Math.max(1, Math.round((tier.min + tier.max) / 2));

        return {
          name: `${label} ${String.fromCharCode(65 + index)} (${
            tier.min === tier.max ? `${marksEach} marks` : `${tier.min}-${tier.max} marks`
          } each)`,
          count: Math.max(1, Math.round(group.length / perPaper)),
          marksEach,
          type: dominantType(group),
        };
      });
    } else {
      // No marks anywhere — fall back to the question mix the papers show.
      sections = [
        {
          name: `${label} A`,
          count: Math.max(4, Math.round(questions.length / perPaper)),
          marksEach: 5,
          type: dominantType(questions),
        },
      ];
    }
  }

  const totalMarks = sections.reduce((sum, s) => sum + s.count * s.marksEach, 0);
  return { sections, totalMarks, years: years || "past papers" };
}

/** Collapses many distinct marks into at most four real exam sections. */
function tiersFromMarks(marks: number[]): Array<{ min: number; max: number }> {
  const distinct = [...new Set(marks)].sort((a, b) => a - b);
  if (distinct.length <= 4) return distinct.map((m) => ({ min: m, max: m }));

  const per = Math.ceil(distinct.length / 4);
  const tiers: Array<{ min: number; max: number }> = [];
  for (let i = 0; i < distinct.length; i += per) {
    const slice = distinct.slice(i, i + per);
    tiers.push({ min: slice[0] as number, max: slice[slice.length - 1] as number });
  }
  return tiers;
}

function dominantType(questions: PyqQuestion[]): string {
  const counts = new Map<string, number>();
  for (const q of questions) counts.set(q.type, (counts.get(q.type) ?? 0) + 1);

  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  // The map key came from PyqQuestion["type"], but Map<string> widened it.
  const type = (best?.[0] ?? "other") as PyqQuestion["type"];

  const words: Record<PyqQuestion["type"], string> = {
    objective: "1–2 mark objective / MCQ / true-false",
    short: "short answer, 2–4 lines",
    long: "long descriptive answer with points and diagram",
    numerical: "calculation / numerical with working",
    proof: "derivation / proof",
    other: "mixed descriptive",
  };
  return words[type];
}

function mode(values: number[]): number | null {
  if (values.length === 0) return null;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return best?.[0] ?? null;
}

function isNumber(n: number | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n);
}
