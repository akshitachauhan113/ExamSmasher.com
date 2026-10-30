import type {
  ExamTopic,
  PyqPaper,
  PyqQuestion,
  Topic,
  TopicExamSignal,
} from "./types";

/**
 * Exam-mode core: turns real past questions into an honest trend, then turns
 * that trend into a study order that respects a student who is short on time.
 *
 * Everything here is DETERMINISTIC. The AI only maps a question onto a topic;
 * counts, marks, repetition and priority are all computed from those real
 * mappings, so "this repeats" always means "it is in N actual papers".
 */

let uid = 0;
function nextId(prefix: string): string {
  uid += 1;
  return `${prefix}-${Date.now().toString(36)}-${uid}`;
}

/* -------------------------------------------------------------------------- */
/*                              normalising input                              */
/* -------------------------------------------------------------------------- */

interface RawParsedQuestion {
  paperId?: unknown;
  number?: unknown;
  section?: unknown;
  marks?: unknown;
  type?: unknown;
  text?: unknown;
}

const QUESTION_TYPES = new Set(["objective", "short", "long", "numerical", "proof", "other"]);

export interface PaperInput {
  id: string;
  year: string;
  label: string;
}

/** Cleans one AI-parsed question. Returns null when there is no usable text. */
function normalizeQuestion(
  raw: RawParsedQuestion,
  papers: Map<string, PyqPaper>,
): PyqQuestion | null {
  const text = typeof raw?.text === "string" ? raw.text.trim().replace(/\s+/g, " ") : "";
  if (text.length < 6) return null;

  const paperId = typeof raw.paperId === "string" ? raw.paperId : "";
  const paper = papers.get(paperId);

  const type =
    typeof raw.type === "string" && QUESTION_TYPES.has(raw.type)
      ? (raw.type as PyqQuestion["type"])
      : "other";

  const marks =
    Number.isFinite(Number(raw.marks)) && Number(raw.marks) > 0
      ? Math.min(100, Math.round(Number(raw.marks)))
      : undefined;

  return {
    id: nextId("q"),
    paperYear: paper?.year ?? "",
    paperLabel: paper?.label ?? "",
    section:
      typeof raw.section === "string" && raw.section.trim()
        ? raw.section.trim().slice(0, 40)
        : undefined,
    number:
      typeof raw.number === "string" && raw.number.trim()
        ? raw.number.trim().slice(0, 20)
        : undefined,
    marks,
    text: text.slice(0, 700),
    type,
  };
}

export interface NormalizedPapers {
  questions: PyqQuestion[];
  /** Same list as input, with questionCount filled in per paper. */
  papers: PyqPaper[];
  /** How many parsed rows had no usable text (OCR garbage, headers, ...). */
  dropped: number;
}

/** Cleans the whole AI reply for one or more papers. */
export function normalizeParsedQuestions(
  raw: unknown,
  papers: PaperInput[],
): NormalizedPapers {
  const paperMap = new Map<string, PyqPaper>(
    papers.map((p) => [p.id, { ...p, questionCount: 0 }]),
  );

  const list = Array.isArray(raw) ? raw : [];
  const questions: PyqQuestion[] = [];
  let dropped = 0;

  for (const item of list) {
    const q = normalizeQuestion(item as RawParsedQuestion, paperMap);
    if (q) questions.push(q);
    else dropped += 1;
  }

  for (const paper of paperMap.values()) {
    paper.questionCount = questions.filter((q) => q.paperYear === paper.year).length;
  }

  return { questions, papers: [...paperMap.values()], dropped };
}

/* -------------------------------------------------------------------------- */
/*                              trend computation                              */
/* -------------------------------------------------------------------------- */

/** Groups near-identical wording so real repetition becomes visible. */
function fingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(
      /\b(and|the|of|a|an|to|in|for|with|is|are|was|were|explain|define|what|how|why|write|short|note|notes|describe|attempt|any)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 2)
    .sort()
    .join(" ");
}

/**
 * Builds one exam signal per topic straight from the real questions.
 * `appearances` counts distinct PAPERS, not questions — a topic asked twice in
 * one paper is not the same as a topic asked in two different years.
 */
export function computeSignals(
  topics: Topic[],
  questions: PyqQuestion[],
  totalPapers: number,
): Map<string, TopicExamSignal> {
  const signals = new Map<string, TopicExamSignal>(
    topics.map((topic) => [topic.id, emptySignal(topic.id)]),
  );

  for (const question of questions) {
    const signal = question.topicId ? signals.get(question.topicId) : undefined;
    if (!signal) continue;
    signal.questions.push(question);
    signal.totalMarks += question.marks ?? 0;
  }

  const papers = Math.max(1, totalPapers);

  for (const signal of signals.values()) {
    // Collapse duplicate wording so one paper stuffing the same question
    // three times cannot fake a strong trend.
    const seen = new Map<string, number>();
    signal.questions = signal.questions.filter((q) => {
      const fp = fingerprint(q.text);
      const hits = seen.get(fp) ?? 0;
      seen.set(fp, hits + 1);
      if (hits > 0) {
        q.repeatCount = (q.repeatCount ?? 1) + 1;
        return false;
      }
      return true;
    });

    signal.appearances = new Set(
      signal.questions.map((q) => `${q.paperLabel}|${q.paperYear}`),
    ).size;

    signal.examScore = scoreExam(signal, papers);
    signal.trend = trendOf(signal, papers);

    // Recent papers first — their wording is the best predictor.
    signal.questions.sort((a, b) => (b.paperYear || "").localeCompare(a.paperYear || ""));
  }

  return signals;
}

/**
 * Exam safety score out of 100.
 *
 * Appearing across many papers matters most, then carrying real marks, then
 * having several distinct questions. A topic nobody asked about scores near
 * zero, which is exactly what a time-starved student needs to see.
 */
function scoreExam(signal: TopicExamSignal, totalPapers: number): number {
  const papers = Math.max(1, totalPapers);
  const appearanceRatio = clamp01(signal.appearances / papers);
  const marksScore = clamp01(signal.totalMarks / 40);
  const variety = clamp01(signal.questions.length / 4);
  const repeatBoost = clamp01(
    signal.questions.reduce((sum, q) => sum + (q.repeatCount ?? 1) - 1, 0) / 3,
  );

  return Math.round(
    100 *
      (0.5 * appearanceRatio + 0.25 * marksScore + 0.15 * variety + 0.1 * repeatBoost),
  );
}

function trendOf(
  signal: TopicExamSignal,
  totalPapers: number,
): TopicExamSignal["trend"] {
  if (signal.appearances === 0) return "rare";
  if (signal.appearances >= Math.max(2, Math.ceil(totalPapers * 0.75))) return "repeating";
  if (signal.appearances >= Math.ceil(totalPapers * 0.5) || signal.examScore >= 30) {
    return "important";
  }
  return "occasional";
}

/* -------------------------------------------------------------------------- */
/*                              priority ordering                              */
/* -------------------------------------------------------------------------- */

const EASE_WEIGHT: Record<Topic["difficulty"], number> = {
  beginner: 1,
  intermediate: 0.65,
  advanced: 0.35,
};

/**
 * The whole point of exam mode: study order by RETURN PER MINUTE.
 *
 * A topic that repeats every year and takes 15 minutes beats one that showed
 * up once in three papers and eats an hour. Exam weight dominates, but
 * learnability is weighted in because the student is short on time.
 */
export function scoreRoi(topic: Topic, signal: TopicExamSignal): number {
  const examPart = signal.examScore / 100;
  const easePart = EASE_WEIGHT[topic.difficulty] ?? 0.65;
  const timePart = clamp01(1 - Math.min(topic.estimatedMinutes, 90) / 90);
  const importancePart =
    topic.importance === "core" ? 1 : topic.importance === "important" ? 0.7 : 0.4;

  return 0.5 * examPart + 0.2 * easePart + 0.15 * timePart + 0.15 * importancePart;
}

function bandOf(
  rank: number,
  total: number,
  trend: TopicExamSignal["trend"],
): ExamTopic["band"] {
  if (trend === "repeating") return "must";
  const ratio = total <= 1 ? 0 : (rank - 1) / total;
  if (ratio < 0.4) return "must";
  if (ratio < 0.75) return "should";
  return "if-time";
}

/**
 * Builds the ordered exam plan. When the student passes a time budget, every
 * topic gets a slice of it weighted toward the top ranks — so the plan fits
 * the hours they actually have rather than an ideal schedule.
 */
export function buildExamTopics(
  topics: Topic[],
  signals: Map<string, TopicExamSignal>,
  totalMinutes?: number,
): ExamTopic[] {
  const scored = topics
    .map((topic) => ({ topic, signal: signals.get(topic.id) ?? emptySignal(topic.id) }))
    .sort((a, b) => scoreRoi(b.topic, b.signal) - scoreRoi(a.topic, a.signal));

  const total = scored.length;
  const hasBudget = typeof totalMinutes === "number" && totalMinutes > 0;

  // Earlier topics earn a bigger slice of the clock.
  const weights = scored.map((_, i) => 1 / (1 + i * 0.45));
  const weightSum = weights.reduce((sum, w) => sum + w, 0);

  return scored.map((entry, index) => ({
    topic: entry.topic,
    signal: entry.signal,
    priority: index + 1,
    band: bandOf(index + 1, total, entry.signal.trend),
    minutes: hasBudget
      ? Math.max(5, Math.round((totalMinutes * weights[index]) / weightSum))
      : entry.topic.estimatedMinutes,
  }));
}

function emptySignal(topicId: string): TopicExamSignal {
  return {
    topicId,
    totalMarks: 0,
    appearances: 0,
    examScore: 0,
    trend: "rare",
    questions: [],
  };
}

/**
 * "Most expected" = real questions, ranked by how reliable their pattern is.
 * Frequency first, then recency, then marks — a question that showed up in
 * every paper is the single safest thing to revise.
 */
export function rankExpected(questions: PyqQuestion[], limit = 12): PyqQuestion[] {
  return [...questions]
    .sort((a, b) => {
      const repeatDiff = (b.repeatCount ?? 1) - (a.repeatCount ?? 1);
      if (repeatDiff !== 0) return repeatDiff;
      const yearDiff = (b.paperYear || "").localeCompare(a.paperYear || "");
      if (yearDiff !== 0) return yearDiff;
      return (b.marks ?? 0) - (a.marks ?? 0);
    })
    .slice(0, limit);
}

/* -------------------------------------------------------------------------- */

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Short human labels, reused across the exam UI. */
export const BAND_LABEL: Record<ExamTopic["band"], string> = {
  must: "🎯 Must do",
  should: "👍 Should do",
  "if-time": "⏳ If you get time",
};

export const TREND_LABEL: Record<TopicExamSignal["trend"], string> = {
  repeating: "🔥 Repeats every year",
  important: "📌 Important",
  occasional: "🔹 Occasionally asked",
  rare: "⚪ Rarely asked",
};
