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

/** Raw metadata for one YouTube video, straight from the Data API. */
export interface VideoCandidate {
  id: string;
  title: string;
  description: string;
  channelTitle: string;
  channelId: string;
  publishedAt: string;
  thumbnail: string;
  durationSeconds: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  hasCaptions: boolean;
  embeddable: boolean;
}

/** A candidate after deterministic (non-AI) scoring. */
export interface ScoredVideo {
  video: VideoCandidate;
  heuristicScore: number;
  aiScore: number | null;
  score: number;
  relevance: number;
  quality: number;
  reasons: string[];
  matchType: "transcript" | "metadata";
  transcriptSnippet?: string;
  aiSummary?: string;
  trustedChannel: boolean;
  /** True when this exact video sits inside the recommended full-course playlist. */
  inCoursePlaylist?: boolean;
  rank: number;
}

export interface TopicResult {
  topic: Topic;
  videos: ScoredVideo[];
  candidatesConsidered: number;
  queries: string[];
  aiUsed?: boolean;
  /** True when the topic was skipped because the student already studied it. */
  skipped?: boolean;
  error?: string;
}

export interface AnalyzeResponse {
  ok: boolean;
  subject?: string;
  topics?: Topic[];
  truncated?: boolean;
  provider?: string;
  error?: string;
}

export interface VideosResponse {
  ok: boolean;
  result?: TopicResult;
  error?: string;
}

export interface HealthResponse {
  youtube: boolean;
  llm: "gemini" | "openai" | null;
  model: string | null;
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
  error?: string;
}

/** Which language study material is written in — the student picks one. */
export type NotesLang = "english" | "hinglish";

/** AI summary of one video, based on its transcript when available. */
export interface VideoSummary {
  bullets: string[];
  fit?: string;
  level?: "beginner" | "intermediate" | "advanced";
}

export interface SummaryResponse {
  ok: boolean;
  summary?: VideoSummary;
  transcriptAvailable?: boolean;
  error?: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResponse {
  ok: boolean;
  reply?: string;
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
  error?: string;
}

/* --------------------------- full-course playlists --------------------------- */

/** One video sitting inside a playlist, in playlist order. */
export interface PlaylistVideo {
  videoId: string;
  title: string;
  position: number;
}

/** One topic mapped onto the playlist video that teaches it. */
export interface PlaylistCoverage {
  topicId: string;
  videoId: string;
  videoTitle: string;
}

/** A single "complete course" playlist, as found on YouTube. */
export interface PlaylistCandidate {
  id: string;
  title: string;
  channelTitle: string;
  thumbnail: string;
  /** Total videos YouTube reports for the playlist. */
  videoCount: number;
  url: string;
}

/** The chosen playlist plus how much of the student's syllabus it covers. */
export interface CoursePlaylist extends PlaylistCandidate {
  /** Videos we actually pulled from the playlist (capped). */
  videos: PlaylistVideo[];
  /** One entry per covered topic: topicId -> the playlist video that teaches it. */
  coverage: PlaylistCoverage[];
  /** 0-100 — share of the student's topics this playlist actually teaches. */
  coveragePercent: number;
  /** How the coverage was worked out. */
  method: "ai" | "keyword";
  /** Runner-up playlists so the student can switch if they dislike the pick. */
  alternatives?: PlaylistCandidate[];
}

export interface PlaylistResponse {
  ok: boolean;
  playlist?: CoursePlaylist | null;
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
}

export interface QuizResponse {
  ok: boolean;
  questions?: QuizQuestion[];
  error?: string;
}
