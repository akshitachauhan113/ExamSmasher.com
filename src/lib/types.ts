export type Importance = "core" | "important" | "bonus";
export type Difficulty = "beginner" | "intermediate" | "advanced";

/** A single topic extracted from the user's syllabus by the AI. */
export interface Topic {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  importance: Importance;
  difficulty: Difficulty;
  estimatedMinutes: number;
  chapter?: string;
}

/**
 * Which engine produced a result.
 *
 * "ai"  — the in-browser model actually generated it.
 * "rules" — deterministic, built from the student's own text.
 *
 * Every surface that shows generated material also shows this, so nothing is
 * ever presented as model output when it was not.
 */
export type EngineSource = "ai" | "rules";

/**
 * One honest YouTube search suggestion.
 *
 * No video metadata is fetched or invented — this is just a link to
 * YouTube's own results page for a query we built from the syllabus. What the
 * student sees after clicking is whatever YouTube actually returns.
 */
export interface VideoSearch {
  /** Short label, e.g. "Topic", "Unit", "Keywords". */
  label: string;
  /** The query string we built. */
  query: string;
  /** https://www.youtube.com/results?search_query=… */
  url: string;
}

export interface TopicResult {
  topic: Topic;
  /** Search links for this topic — suggestions, never claimed matches. */
  searches: VideoSearch[];
  /** How the queries were built (e.g. ["topic", "unit", "keywords"]). */
  queries: string[];
  /** True when the topic was skipped because the student already studied it. */
  skipped?: boolean;
  error?: string;
}

export interface AnalyzeResponse {
  ok: boolean;
  subject?: string;
  topics?: Topic[];
  truncated?: boolean;
  /** Which engine split the syllabus — shown in the UI, never guessed. */
  source?: EngineSource;
  error?: string;
}

/* --------------------------- three levels of notes --------------------------- */
/** Level 1 — Detailed: proper explanations in paragraphs (concept clarity). */
export interface DetailedSection {
  heading: string;
  paragraphs: string[];
}

/** Level 2 — Short: dense one-line bullets (fast revision). */
export interface NotesSection {
  heading: string;
  bullets: string[];
}

/** Level 3 — Flashcards: active recall / self-testing. */
export interface Flashcard {
  q: string;
  a: string;
}

/** All three levels for one topic, generated in a single AI call. */
export interface NotesBundle {
  detailed: DetailedSection[];
  notes: NotesSection[];
  cards: Flashcard[];
}

/** Notes for one topic, plus a cheap "how much is already saved" hint. */
export interface NotesResponse {
  ok: boolean;
  detailed?: DetailedSection[];
  notes?: NotesSection[];
  cards?: Flashcard[];
  source?: EngineSource;
  error?: string;
}

/** Which language study material is written in — the student picks one. */
export type NotesLang = "english" | "hinglish";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResponse {
  ok: boolean;
  reply?: string;
  source?: EngineSource;
  error?: string;
}

/** One planned day in the daily planner. */
export interface PlanItem {
  title: string;
  minutes: number;
  type?: "video" | "practice" | "revision";
  videoTitle?: string;
  videoUrl?: string;
}

export interface PlanDay {
  day: number;
  focus: string;
  items: PlanItem[];
}

export interface PlanResponse {
  ok: boolean;
  days?: PlanDay[];
  tips?: string[];
  markdown?: string;
  source?: EngineSource;
  error?: string;
}

/* ------------------------------- exam mode -------------------------------- */

/** One question lifted out of a real previous-year paper. */
export interface PyqQuestion {
  id: string;
  /** Year printed on the paper, e.g. "2023". */
  paperYear: string;
  /** What exam it came from, e.g. "End Semester" / "Mid Term". */
  paperLabel: string;
  /** Section / unit grouping if the paper had one, e.g. "Section B". */
  section?: string;
  /** Question number as printed, e.g. "Q4" or "3(b)". */
  number?: string;
  marks?: number;
  text: string;
  type: "objective" | "short" | "long" | "numerical" | "proof" | "other";
  /** Syllabus topic this question belongs to (filled in by the trend pass). */
  topicId?: string;
  /** How many papers asked a question like this one. */
  repeatCount?: number;
  /** True when this is a fresh variant AI built from a real repeating pattern. */
  isVariant?: boolean;
}

/** One uploaded previous-year paper, already turned into questions. */
export interface PyqPaper {
  id: string;
  year: string;
  label: string;
  questionCount: number;
}

/* --------------------------- solved paper (PYQ + answers) --------------------------- */

export type QuestionDifficulty = "easy" | "medium" | "hard";

/** One solved question: model answer sitting right under its question. */
export interface SolutionEntry {
  /** 1-based index of the question in the list the client sent. */
  index: number;
  /** Markdown answer, written the way an examiner wants to see it. */
  answer: string;
  difficulty: QuestionDifficulty;
  /** True when the pattern behind this question keeps repeating in exams. */
  important: boolean;
}

/** Every question of one paper, solved and tagged. */
export interface SolvedPaper {
  label: string;
  year: string;
  entries: SolutionEntry[];
}

export interface SolutionsResponse {
  ok: boolean;
  papers?: SolvedPaper[];
  source?: EngineSource;
  error?: string;
}

/* ------------------- engine responses that used to live in routes ------------------- */

/** Questions read out of the uploaded previous-year papers. */
export interface PapersResponse {
  ok: boolean;
  questions?: PyqQuestion[];
  papers?: PyqPaper[];
  dropped?: number;
  source?: EngineSource;
  error?: string;
}

/** A practice paper plus the pattern it was built from. */
export interface MockTestResponse {
  ok: boolean;
  markdown?: string;
  /** Structure actually detected — echoed back so the UI can state the match. */
  structure?: { sections: number; totalMarks: number; years: string };
  source?: EngineSource;
  error?: string;
}

/** One model answer, written for a single real past question. */
export interface AnswerResponse {
  ok: boolean;
  answer?: string;
  source?: EngineSource;
  error?: string;
}

/** Whole-syllabus notes as one continuous Markdown document. */
export interface FullNotesResponse {
  ok: boolean;
  markdown?: string;
  sections?: number;
  source?: EngineSource;
  error?: string;
}

/** How a single topic showed up across the uploaded papers. */
export interface TopicExamSignal {
  topicId: string;
  /** Total marks this topic has carried across all papers. */
  totalMarks: number;
  /** How many of the uploaded papers asked about it. */
  appearances: number;
  /** 0-100 — how safe it is to bet your revision time on this topic. */
  examScore: number;
  trend: "repeating" | "important" | "occasional" | "rare";
  /** Real past questions on this topic, most recent first. */
  questions: PyqQuestion[];
}

/** A topic placed on the exam plan, with its ROI-based priority. */
export interface ExamTopic {
  topic: Topic;
  signal: TopicExamSignal;
  /** 1 = highest return per minute spent studying. */
  priority: number;
  /** How hard this topic is to actually learn. */
  band: "must" | "should" | "if-time";
  /** Minutes this topic deserves under the student's time budget. */
  minutes: number;
}

export interface ExamPlanResponse {
  ok: boolean;
  subject?: string;
  papers?: PyqPaper[];
  topics?: ExamTopic[];
  /** Highest-frequency real questions, newest first. */
  expected?: PyqQuestion[];
  /** Honest note about what the analysis could and could not verify. */
  notes?: string[];
  totalMarks?: number;
  /** Which engine mapped questions onto topics (the counts are always real). */
  source?: EngineSource;
  error?: string;
}

/** One MCQ in a generated quiz. */
export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  /** Index of the correct option. */
  answer: number;
  explanation: string;
  topicId?: string;
  difficulty?: "easy" | "medium" | "hard";
}

export interface QuizResponse {
  ok: boolean;
  questions?: QuizQuestion[];
  source?: EngineSource;
  error?: string;
}
