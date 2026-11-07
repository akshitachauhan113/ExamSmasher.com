import type {
  ExamPlanResponse,
  SmartPriority,
  SmartPriorityResult,
  Topic,
  TopicPriorityReason,
} from "@/lib/types";

/**
 * Smart Exam Preparation — High / Medium / Low, each with the evidence
 * that earned it.
 *
 * Rules (deterministic, shown to the student in the notes):
 *   - Labels come ONLY from the uploaded papers: how many papers asked the
 *     topic, how many marks it carried, how often the wording repeated.
 *   - A topic with NO observed questions is "unobserved" — never "low".
 *     Absence of evidence is not evidence of low importance.
 *   - With a single paper, cross-paper frequency is meaningless, so labels
 *     lean on repeats-within-paper and marks instead, and the UI says so.
 */

export interface SmartPriorityInput {
  topics: Topic[];
  /** The built plan — its signals are the same counts PYQ Analysis shows. */
  plan: ExamPlanResponse | null;
}

function yearsOf(plan: ExamPlanResponse, topicId: string): string[] {
  const entry = plan.topics?.find((t) => t.topic.id === topicId);
  if (!entry) return [];
  return [
    ...new Set(
      entry.signal.questions.map((q) => q.paperYear).filter((year) => /\d{4}/.test(year)),
    ),
  ];
}

function questionCountOf(plan: ExamPlanResponse, topicId: string): number {
  const entry = plan.topics?.find((t) => t.topic.id === topicId);
  if (!entry) return 0;
  return entry.signal.questions.reduce((sum, q) => sum + (q.repeatCount ?? 1), 0);
}

function marksKnownOf(plan: ExamPlanResponse, topicId: string): boolean {
  const entry = plan.topics?.find((t) => t.topic.id === topicId);
  if (!entry) return false;
  return entry.signal.questions.some((q) => typeof q.marks === "number" && q.marks > 0);
}

function decide(
  appearances: number,
  totalMarks: number,
  questionCount: number,
  marksKnown: boolean,
  totalPapers: number,
): SmartPriority {
  if (appearances === 0) return "unobserved";

  if (totalPapers <= 1) {
    // One paper: every observed topic "appears once" — frequency means
    // nothing, so repeats and marks carry the decision instead.
    if (questionCount >= 2 || (marksKnown && totalMarks >= 8)) return "high";
    if (questionCount === 1 && marksKnown && totalMarks <= 5) return "low";
    return "medium";
  }

  const half = Math.ceil(totalPapers / 2);
  if (appearances >= half || (marksKnown && totalMarks >= 15)) return "high";
  if (appearances === 1 && marksKnown && totalMarks <= 6) return "low";
  return "medium";
}

function reasonFor(
  priority: SmartPriority,
  input: {
    appearances: number;
    totalPapers: number;
    totalMarks: number;
    marksKnown: boolean;
    questionCount: number;
    years: string[];
    repeats: number;
  },
): string {
  const years = input.years.length > 0 ? ` (${input.years.join(", ")})` : "";
  const marks = input.marksKnown ? `${input.totalMarks} marks total` : "marks not printed";
  const repeatNote =
    input.repeats > 0 ? ` · wording repeated ${input.repeats}×` : "";

  switch (priority) {
    case "unobserved":
      return "Not observed in the uploaded papers — absence of evidence, not low importance. Still cover it in Complete Syllabus.";
    case "high":
      return `Asked in ${input.appearances}/${input.totalPapers} papers${years} · ${marks} · ${input.questionCount} question${input.questionCount > 1 ? "s" : ""}${repeatNote}.`;
    case "medium":
      return `Asked in ${input.appearances}/${input.totalPapers} papers${years} · ${marks} — worth revising after the high-priority block.`;
    case "low":
      return `Asked only ${input.appearances}× in ${input.totalPapers} papers${years} · ${marks} — weakest observed evidence, keep it for last.`;
  }
}

export function buildSmartPriority(input: SmartPriorityInput): SmartPriorityResult {
  const plan = input.plan;
  const totalPapers = plan?.papers?.length ?? 0;

  const notes: string[] = [];

  if (!plan || totalPapers === 0 || input.topics.length === 0) {
    return {
      ok: true,
      hasPapers: false,
      topics: [],
      counts: { high: 0, medium: 0, low: 0, unobserved: 0 },
      notes: [
        "PYQ-based prioritisation is unavailable until at least one previous-year paper is uploaded — nothing is labelled without evidence.",
        "Complete Syllabus Preparation works right now and covers every topic.",
      ],
    };
  }

  const counts = { high: 0, medium: 0, low: 0, unobserved: 0 };
  const topics: TopicPriorityReason[] = [];

  for (const entry of plan.topics ?? []) {
    const signal = entry.signal;
    const marksKnown = marksKnownOf(plan, entry.topic.id);
    const questionCount = questionCountOf(plan, entry.topic.id);
    const repeats = signal.questions.reduce((sum, q) => sum + (q.repeatCount ?? 1) - 1, 0);
    const years = yearsOf(plan, entry.topic.id);

    const priority = decide(
      signal.appearances,
      signal.totalMarks,
      questionCount,
      marksKnown,
      totalPapers,
    );
    counts[priority] += 1;

    topics.push({
      topicId: entry.topic.id,
      priority,
      reason: reasonFor(priority, {
        appearances: signal.appearances,
        totalPapers,
        totalMarks: signal.totalMarks,
        marksKnown,
        questionCount,
        years,
        repeats,
      }),
      appearances: signal.appearances,
      papersAppeared: signal.appearances,
      totalMarks: signal.totalMarks,
    });
  }

  if (totalPapers === 1) {
    notes.push(
      "Only one paper was analysed — labels come from repeats and marks within that single paper, not from a multi-year trend.",
    );
  } else {
    notes.push(
      `Priority is computed from your ${totalPapers} uploaded papers: cross-paper frequency, marks carried and repeated wording.`,
    );
  }
  if (counts.unobserved > 0) {
    notes.push(
      `${counts.unobserved} topic${counts.unobserved > 1 ? "s were" : " was"} not observed in these papers — listed separately, never as low priority.`,
    );
  }

  return { ok: true, hasPapers: true, topics, counts, notes };
}
