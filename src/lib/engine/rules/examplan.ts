import { buildExamTopics, computeSignals, rankExpected } from "@/lib/exam";
import type { ExamPlanResponse, PyqQuestion, Topic } from "@/lib/types";
import { distinctPapers, mapQuestionsToTopics } from "./pyq";

/**
 * Exam plan from REAL past papers.
 *
 * Nothing here is generated: the mapping is deterministic, and every number
 * the student sees — appearances, marks, repeat counts, priority, band — comes
 * out of `computeSignals` / `buildExamTopics`, which only ever count the
 * questions that were actually uploaded.
 */

export interface ExamPlanRulesInput {
  subject?: string;
  topics: Topic[];
  questions: PyqQuestion[];
  totalMinutes?: number;
}

export function buildExamPlanRules(input: ExamPlanRulesInput): ExamPlanResponse {
  const subject = (input.subject ?? "").trim().slice(0, 80);
  const topics = input.topics;
  const questions = input.questions.filter(
    (q) => Boolean(q) && typeof q.text === "string" && q.text.trim().length > 5,
  );

  if (topics.length === 0) {
    return { ok: false, error: "Extract topics from your syllabus first." };
  }
  if (questions.length === 0) {
    return { ok: false, error: "Upload at least one previous-year paper first." };
  }

  const totalMinutes =
    Number.isFinite(Number(input.totalMinutes)) && Number(input.totalMinutes) > 0
      ? Math.min(60 * 24 * 30, Math.round(Number(input.totalMinutes)))
      : undefined;

  const notes: string[] = [];
  const papers = distinctPapers(questions);

  if (papers.length < 2) {
    notes.push(
      "Only one paper was readable — trends are weak with a single year. Add 2-3 more papers for a reliable repeat pattern.",
    );
  }
  if (questions.length < 10) {
    notes.push(
      `Only ${questions.length} questions could be read, so priority is based on thin evidence.`,
    );
  }

  const mapped = mapQuestionsToTopics(topics, questions);

  const signals = computeSignals(topics, mapped, papers.length);
  const examTopics = buildExamTopics(topics, signals, totalMinutes);

  const covered = examTopics.filter((t) => t.signal.appearances > 0).length;
  if (covered === 0) {
    notes.push(
      "None of the extracted questions matched your syllabus topics — check that the syllabus and the papers are for the same subject.",
    );
  } else if (covered < topics.length * 0.5) {
    notes.push(
      `Only ${covered}/${topics.length} syllabus topics appear in these papers. The rest are marked rare — that is real evidence they are low-yield, but confirm the papers cover the full syllabus.`,
    );
  }

  // Real questions, ranked by how often their pattern actually repeated.
  const expected = rankExpected(mapped);

  notes.push(
    "Questions were matched to topics by keyword overlap (no model needed) — every count below is from your uploaded papers.",
  );
  notes.push(
    "“Most expected” lists your highest-frequency REAL past questions. It is a revision priority, not a prediction of the paper.",
  );

  return {
    ok: true,
    subject,
    papers,
    topics: examTopics,
    expected,
    notes,
    totalMarks: mapped.reduce((sum, q) => sum + (q.marks ?? 0), 0),
    source: "rules",
  };
}
