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

/* ------------------- Phase 4 · complete syllabus structure ------------------- */

/** One topic line read from the syllabus, with its own sub-items. */
export interface SyllabusTopicEntry {
  id: string;
  title: string;
  detail?: string;
  /** Child items listed under this topic (bullets, deeper indents). */
  subtopics: string[];
  /** Set when the line reads like a definition/concept statement. */
  isDefinition?: boolean;
}

/** One unit/chapter of the syllabus, in the order it appears. */
export interface SyllabusUnitEntry {
  id: string;
  label: string;
  topics: SyllabusTopicEntry[];
}

/** A line we could not read confidently — shown as-is, never guessed at. */
export interface UnclearLine {
  unit: string;
  text: string;
}

/** Complete, uncapped structure extracted from the combined syllabus text. */
export interface SyllabusAnalysis {
  ok: boolean;
  subject?: string;
  units: SyllabusUnitEntry[];
  totalUnits: number;
  totalTopics: number;
  totalSubtopics: number;
  unclearLines: UnclearLine[];
  /** Exact duplicate lines removed (distinct topics are always kept). */
  duplicatesRemoved: number;
  source?: EngineSource;
  error?: string;
}

/* ---------------------- Phase 4 · PYQ evidence (real papers) ---------------------- */

/** One real appearance of a question, with its source paper. */
export interface EvidenceOccurrence {
  questionId: string;
  paperLabel: string;
  paperYear: string;
  number?: string;
  text: string;
  marks?: number;
}

/** A repeated ask: identical wording (exact) or same concept (similar). */
export interface RepeatedQuestionGroup {
  kind: "exact" | "similar";
  occurrences: EvidenceOccurrence[];
  /** Words the similar-phrased questions share (empty for exact groups). */
  sharedTerms?: string[];
}

/** How one syllabus topic showed up across the uploaded papers. */
export interface TopicFrequency {
  topicId: string;
  /** Questions mapped to this topic (wording repeats folded in). */
  questionCount: number;
  /** Distinct papers that asked about it. */
  papersAppeared: number;
  totalMarks: number;
  years: string[];
}

export interface UnitDistribution {
  unit: string;
  questionCount: number;
  papersAppeared: number;
  totalMarks: number;
}

export interface YearRow {
  year: string;
  questionCount: number;
  topicsTouched: number;
}

export interface MarksSummary {
  withMarks: number;
  total: number;
  distribution: Array<{ marks: number; count: number }>;
}

/** Everything counted from the uploaded papers — nothing inferred. */
export interface PyqEvidence {
  ok: boolean;
  papersAnalyzed: number;
  questionsAnalyzed: number;
  singlePaper: boolean;
  /** True when at least two papers carry a recognizable 4-digit year. */
  yearsIdentifiable: boolean;
  /** Papers whose year field held no recognizable year. */
  papersWithoutYear: number;
  repeats: RepeatedQuestionGroup[];
  exactCount: number;
  similarCount: number;
  topicFrequency: TopicFrequency[];
  unitDistribution: UnitDistribution[];
  years: YearRow[];
  marks: MarksSummary | null;
  /** Topics asked about in two or more different papers. */
  crossPaperTopics: TopicFrequency[];
  /** Parsed questions that matched no syllabus topic. */
  unmappedQuestions: number;
  notes: string[];
  error?: string;
}

/* --------------------- Phase 4 · smart exam priority (evidence) --------------------- */

export type SmartPriority = "high" | "medium" | "low" | "unobserved";

export interface TopicPriorityReason {
  topicId: string;
  priority: SmartPriority;
  /** One short sentence carrying the real numbers behind the label. */
  reason: string;
  appearances: number;
  papersAppeared: number;
  totalMarks: number;
}

export interface SmartPriorityResult {
  ok: boolean;
  /** False when no papers were uploaded — labels are unavailable, not guessed. */
  hasPapers: boolean;
  topics: TopicPriorityReason[];
  counts: { high: number; medium: number; low: number; unobserved: number };
  notes: string[];
  error?: string;
}

/* --------------------- Phase 5 · video recommendations --------------------- */

export type RecommendationMode = "complete" | "smart";
export type RecommendationKind = "unit" | "topic";

/**
 * ONE honest YouTube search suggestion covering several syllabus topics.
 *
 * There is no video here — no title, channel, thumbnail, duration or URL of
 * any actual video. `query` is what we would search for, `url` opens
 * YouTube's own results page, and `topicIds` are the topics the student is
 * EXPECTED to cover with whichever lecture they pick. Nothing more is claimed.
 */
export interface VideoRecommendation {
  /** Stable across rebuilds — doubles as the watched-progress key. */
  id: string;
  kind: RecommendationKind;
  /** Honest card heading ("Unit lecture search — Unit III: Calculus"). */
  title: string;
  /** Short chip: "Full unit lecture" / "Full lecture" / "Priority lecture". */
  label: string;
  /** The query we built from the syllabus wording. */
  query: string;
  /** https://www.youtube.com/results?search_query=… */
  url: string;
  /** Unit (chapter) this recommendation belongs to. */
  unit: string;
  /** Topics this search is INTENDED to cover — student ticks each one. */
  topicIds: string[];
  /** Smart mode only — the priority class this group serves. */
  priority?: SmartPriority;
}

export interface NoRecReason {
  topicId: string;
  /** Why no search suggestion could honestly be built for this topic. */
  reason: string;
}

export interface RecommendationPlan {
  ok: boolean;
  mode: RecommendationMode;
  /** Ordered: syllabus order (complete), High → Low (smart). */
  recommendations: VideoRecommendation[];
  /** Topics with NO recommendation — listed, never silently dropped. */
  noRec: NoRecReason[];
  /** Topics skipped because the student already marked them studied. */
  studiedTopicIds: string[];
  notes: string[];
  /** Inputs fingerprint — lets a reload reuse the cached plan. */
  signature: string;
}

/**
 * One REAL YouTube video matched to a syllabus search (server-fetched).
 *
 * Every field comes from the YouTube Data API — nothing is invented. The
 * coverage numbers are an ESTIMATE from the video's title + description
 * (it reads text, it does not watch the video) and the UI labels them so.
 */
export interface VideoMatch {
  /** The real 11-character YouTube video id. */
  id: string;
  title: string;
  channel: string;
  durationSec: number;
  views: number;
  /** Real thumbnail from YouTube's CDN (i.ytimg.com). */
  thumb: string;
  /** https://www.youtube.com/watch?v=… — the real video URL. */
  url: string;
  /** Publish date, "YYYY-MM-DD" ("" when unknown). */
  published: string;
  /** Combined quality score, 0–100 (rank, views, duration, title, coverage). */
  score: number;
  /** ESTIMATE: % of the student's syllabus topics mentioned in title+description. */
  coveragePct: number;
  /** Syllabus topics the video's title+description mentioned. */
  matchedTopics: string[];
}

/** POST /api/videos request body. */
export interface VideoSuggestionsRequest {
  /** One entry per recommendation card: card id → the search query. */
  queries: { key: string; query: string }[];
  /** The student's FULL syllabus — coverage % is measured against these. */
  topics: { title: string; keywords: string[]; subtopics?: string[] }[];
}

/** POST /api/videos response. */
export interface VideoSuggestionsResponse {
  ok: boolean;
  /** key (card id) → ranked top videos. */
  results?: Record<string, VideoMatch[]>;
  /** Set when ok=false: "no-key" | "quota" | "upstream" | "bad-request" | "throttled". */
  reason?: string;
}

/* ------------------------ full-course playlist (server) ------------------------ */

/** One video INSIDE a discovered course playlist, in YouTube's own order. */
export interface CoursePlaylistVideo {
  videoId: string;
  title: string;
  position: number;
}

/** One syllabus topic mapped onto the playlist video that teaches it. */
export interface CoursePlaylistTopicMap {
  topicId: string;
  videoId: string;
  videoTitle: string;
}

/**
 * An EXISTING YouTube course playlist that genuinely covers the syllabus.
 * Every field is what the YouTube Data API returned — a playlist is only
 * ever described by its real metadata, and `coverage` only maps topics onto
 * playlist videos that really exist in it.
 */
export interface CoursePlaylist {
  id: string;
  title: string;
  channelTitle: string;
  thumbnail: string;
  videoCount: number;
  /** https://www.youtube.com/playlist?list=… */
  url: string;
  videos: CoursePlaylistVideo[];
  coverage: CoursePlaylistTopicMap[];
  /** ESTIMATE: % of the student's topics found in the playlist's video titles. */
  coveragePercent: number;
}

/** POST /api/playlists request body. */
export interface CoursePlaylistRequest {
  subject: string;
  topics: { id: string; title: string; keywords: string[] }[];
  syllabus?: string;
}

/** POST /api/playlists response. `playlist: null` = nothing credible found. */
export interface CoursePlaylistResponse {
  ok: boolean;
  playlist?: CoursePlaylist | null;
  /** Set when ok=false: "no-key" | "quota" | "upstream" | "bad-request" | "throttled". */
  reason?: string;
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
