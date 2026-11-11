import { withAi } from "@/lib/ai/run";
import { getAiStatus } from "@/lib/ai/status";
import type {
  AnalyzeResponse,
  AnswerResponse,
  ChatResponse,
  ExamPlanResponse,
  FullNotesResponse,
  MockTestResponse,
  NotesGenerationResponse,
  NotesLang,
  NotesResponse,
  PapersResponse,
  PlanResponse,
  QuizResponse,
  SolutionsResponse,
  SyllabusAnalysis,
  Topic,
  TopicResult,
} from "@/lib/types";
import {
  answerAi,
  chatAi,
  fullNotesAi,
  mapQuestionsAi,
  mockTestAi,
  parsePapersAi,
  planAi,
  quizAi,
  solutionsAi,
  topicNotesAi,
} from "./ai";
import { buildAnswerRules, buildChatRules, buildSolutionsRules } from "./rules/answers";
import type { AnswerRulesInput, ChatRulesInput, SolutionPaperInput, SolutionsRulesInput } from "./rules/answers";
import { buildExamPlanRules } from "./rules/examplan";
import { buildPyqEvidence } from "./rules/evidence";
import type { PyqEvidenceInput } from "./rules/evidence";
import { buildFullNotesRules, buildTopicNotesRules, sliceSyllabusToUnit } from "./rules/notes";
import { buildPlanRules, daysToMarkdown } from "./rules/plan";
import type { PlanPick, PlanRulesInput } from "./rules/plan";
import { mapQuestionsToTopics, parsePapersRules } from "./rules/pyq";
import type { ParsePapersRulesInput } from "./rules/pyq";
import { buildSmartPriority } from "./rules/priority";
import type { SmartPriorityInput } from "./rules/priority";
import { buildMockTestRules, buildQuizRules } from "./rules/quiz";
import type { BuildMockTestRulesInput, QuizTopicInput } from "./rules/quiz";
import { buildSearchLinks } from "./rules/search";
import type { SearchLinksInput } from "./rules/search";
import { analyzeSyllabusFull, analyzeSyllabusRules, syllabusToTopics } from "./rules/syllabus";

/**
 * The single entry point every component talks to.
 *
 * Each feature is a pair: a rule-based builder that always works (instant,
 * offline, no key) and — for most features — a browser-model writer. `withAi`
 * decides which one actually ran and the result carries `source`, which the UI
 * shows. The rules path is never a mock-up: it is a real answer built from the
 * student's own text, labelled as such.
 */

/**
 * How long a call will wait for the model to finish downloading before
 * answering with the rule engine instead.
 *
 * During a first download these are always a no-op (a 270 MB model will not
 * arrive in a few seconds) — they only pay off when the model is seconds away
 * from ready, or on later visits where it is cached.
 */
const WAIT = {
  /** Structure over prose: instant answers win. */
  structural: 0,
  /** Long-form writing: worth a short grace period. */
  prose: 4_000,
  /** A chat reply: a little longer, but never block the user. */
  chat: 6_000,
} as const;

/* -------------------------------------------------------------------------- */
/*                                 1 · syllabus                                 */
/* -------------------------------------------------------------------------- */

export interface AnalyzeInput {
  syllabus: string;
  subject?: string;
}

/**
 * The syllabus structure is ALWAYS parsed by the deterministic rules engine.
 *
 * Phase 4's contract — uncapped extraction, preserved hierarchy, exact-only
 * dedupe and honest "unclear" marking — needs an auditable parser, and every
 * surface must show identical counts. A small browser model can rewrite
 * wording elsewhere (notes, answers, solutions) but never this structure.
 */
export async function analyzeSyllabus(input: AnalyzeInput): Promise<AnalyzeResponse> {
  return analyzeSyllabusRules(input);
}

/** Complete unit → topic → subtopic structure, straight from the rules. */
export function analyzeFullSyllabus(input: AnalyzeInput): SyllabusAnalysis {
  return analyzeSyllabusFull(input);
}

export { syllabusToTopics };

/* -------------------------------------------------------------------------- */
/*                            1b · PYQ evidence + priority                      */
/* -------------------------------------------------------------------------- */

/** Everything counted from the uploaded papers (repeats, frequencies…). */
export { buildPyqEvidence };
export type { PyqEvidenceInput };

/** High / Medium / Low labels with the evidence behind each one. */
export { buildSmartPriority };
export type { SmartPriorityInput };

/* -------------------------------------------------------------------------- */
/*                               2 · past papers                                */
/* -------------------------------------------------------------------------- */

export type PapersInput = ParsePapersRulesInput;

/**
 * Papers are machine-printed: numbered, sectioned, full of "Q4." and
 * "(6 marks)". The regex parser reads them verbatim, which a small model
 * cannot be trusted to do — so rules run first, and the model only gets a
 * shot when the parser found nothing at all.
 */
export async function parsePapers(input: PapersInput): Promise<PapersResponse> {
  const rules = parsePapersRules(input);
  if (rules.ok) return rules;
  if (getAiStatus().phase !== "ready") return rules;

  try {
    const papers = (input.papers ?? [])
      .map((paper, index) => ({
        id: typeof paper.id === "string" && paper.id ? paper.id : `p${index + 1}`,
        year: typeof paper.year === "string" && paper.year.trim() ? paper.year.trim() : `Paper ${index + 1}`,
        label: typeof paper.label === "string" && paper.label.trim() ? paper.label.trim() : "Question paper",
      }))
      .filter((_, index) => (input.papers?.[index]?.text ?? "").trim().length >= 40);

    const texts: Record<string, string> = {};
    (input.papers ?? []).forEach((paper, index) => {
      const id = typeof paper.id === "string" && paper.id ? paper.id : `p${index + 1}`;
      if (typeof paper.text === "string") texts[id] = paper.text;
    });

    const ai = await parsePapersAi({ subject: input.subject, papers, texts });
    if (ai.ok) return ai;
    return rules;
  } catch {
    return rules;
  }
}

/* -------------------------------------------------------------------------- */
/*                              3 · exam plan                                   */
/* -------------------------------------------------------------------------- */

export interface ExamPlanInput {
  subject?: string;
  topics: Topic[];
  questions: Array<import("@/lib/types").PyqQuestion>;
  totalMinutes?: number;
}

/**
 * Only the question → topic MAPPING may come from the model. Every number the
 * student sees afterwards is counted from their real papers by `exam.ts`.
 */
export async function buildExamPlan(input: ExamPlanInput): Promise<ExamPlanResponse> {
  const rules = () => buildExamPlanRules(input);

  const { value } = await withAi(
    async () => {
      const mapped = await mapQuestionsAi(input.topics, input.questions);
      const result = buildExamPlanRules({ ...input, questions: mapped });
      if (!result.ok) return rules();
      return { ...result, source: "ai" as const };
    },
    rules,
    { waitMs: WAIT.structural, timeoutMs: 90_000 },
  );
  return value;
}

/** Keyword mapping, exported for callers that must stay synchronous. */
export { mapQuestionsToTopics };

/* -------------------------------------------------------------------------- */
/*                                  4 · notes                                    */
/* -------------------------------------------------------------------------- */

export interface TopicNotesInput {
  topic: Topic;
  subject?: string;
  syllabus?: string;
  language?: NotesLang;
  /** Real past questions on this topic — quoted in the notes, never invented. */
  examQuestions?: string[];
}

/**
 * Asks the server route for model-written notes. Returns null (silently, so
 * the caller falls through) when there is no key, the route fails or the
 * network is down — the key never leaves the server either way.
 */
async function serverTopicNotes(input: TopicNotesInput): Promise<NotesResponse | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: "topic",
        subject: input.subject ?? "Course",
        syllabus: input.syllabus ?? "",
        language: input.language === "hinglish" ? "hinglish" : "english",
        topic: {
          title: input.topic.title,
          description: input.topic.description,
          keywords: input.topic.keywords,
          chapter: input.topic.chapter,
        },
        examQuestions: input.examQuestions ?? [],
      }),
      signal: AbortSignal.timeout(80_000),
      cache: "no-store",
    });
    if (!res.ok) return null; // includes 503 no-key → straight to the fallbacks
    const data = (await res.json()) as NotesGenerationResponse;
    if (!data.ok || !Array.isArray(data.detailed) || data.detailed.length === 0) return null;
    return {
      ok: true,
      detailed: data.detailed,
      notes: data.notes,
      cards: data.cards,
      source: "ai",
      via: "server",
    };
  } catch {
    return null;
  }
}

export async function topicNotes(input: TopicNotesInput): Promise<NotesResponse> {
  // 1) the server-side model (a real key, high quality, key stays private)
  const server = await serverTopicNotes(input);
  if (server) return server;

  // 2) the in-browser model if it happens to be ready, else the rules —
  //    either way the footer label matches what actually wrote the notes.
  const rules = () => buildTopicNotesRules(input);
  const { value } = await withAi(
    () => topicNotesAi(input),
    rules,
    { waitMs: WAIT.prose, timeoutMs: 90_000 },
  );
  return value.source === "ai" ? { ...value, via: "browser" } : value;
}

export interface FullNotesInput {
  syllabus: string;
  subject: string;
  language?: NotesLang;
  topics: Topic[];
  /** When set, only this unit's syllabus lines are used (unit-wise notes). */
  unit?: string;
}

/** Server-side document notes (whole syllabus or one unit) or null. */
async function serverDocumentNotes(input: FullNotesInput): Promise<FullNotesResponse | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: "document",
        subject: input.subject,
        syllabus: input.syllabus,
        language: input.language === "hinglish" ? "hinglish" : "english",
        unit: input.unit,
        topicTitles: input.topics.map((t) => ({ title: t.title, chapter: t.chapter })),
      }),
      signal: AbortSignal.timeout(120_000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as NotesGenerationResponse;
    if (!data.ok || !data.markdown) return null;
    return { ok: true, markdown: data.markdown, source: "ai", via: "server" };
  } catch {
    return null;
  }
}

export async function fullNotes(input: FullNotesInput): Promise<FullNotesResponse> {
  // Unit-wise: scope EVERY engine (server, browser, rules) to that unit's
  // own syllabus lines first — never silently fall back to the whole course.
  let scoped = input;
  if (input.unit) {
    const sliced = sliceSyllabusToUnit(input.syllabus, input.unit);
    if (!sliced) {
      return {
        ok: false,
        error: `Unit "${input.unit}" ke syllabus lines nahi mile — syllabus dobara analyse karo.`,
      };
    }
    scoped = {
      ...input,
      syllabus: sliced,
      topics: input.topics.filter((t) => t.chapter === input.unit),
    };
  }

  const server = await serverDocumentNotes(scoped);
  if (server) return server;

  const rules = () => buildFullNotesRules(scoped);
  const { value } = await withAi(() => fullNotesAi(scoped), rules, {
    waitMs: WAIT.prose,
    timeoutMs: 180_000,
  });
  return value.source === "ai" ? { ...value, via: "browser" } : value;
}

/* -------------------------------------------------------------------------- */
/*                            5 · quiz + mock paper                             */
/* -------------------------------------------------------------------------- */

export interface QuizInput {
  subject: string;
  count: number;
  topics: QuizTopicInput[];
}

export async function buildQuiz(input: QuizInput): Promise<QuizResponse> {
  const rules = () => buildQuizRules(input);
  const { value } = await withAi(
    () =>
      quizAi({
        subject: input.subject,
        count: input.count,
        topics: input.topics.map((t) => ({
          id: t.id,
          title: t.title,
          pastQuestions: t.pastQuestions.map((p) => p.text),
        })),
      }),
    rules,
    { waitMs: WAIT.prose, timeoutMs: 120_000 },
  );
  return value;
}

export type MockTestInput = BuildMockTestRulesInput;

export async function buildMockTest(input: MockTestInput): Promise<MockTestResponse> {
  const rules = () => buildMockTestRules(input);

  const { value } = await withAi(
    async () => {
      // Measure the pattern first — the model must match reality, not guess it.
      const measured = buildMockTestRules(input);
      const sectionNames = [
        ...new Set(input.questions.map((q) => q.section).filter(Boolean)),
      ] as string[];
      const years = [...new Set(input.questions.map((q) => q.paperYear).filter(Boolean))].sort();

      const result = await mockTestAi({
        subject: input.subject,
        structure: {
          sections: sectionNames.length || 2,
          totalMarks: measured.structure?.totalMarks ?? 40,
          years: years.join(", ") || "syllabus only",
        },
        realQuestions: input.questions.filter((q) => q.text && !q.isVariant).map((q) => q.text),
        topics: input.topics.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
        })),
      });
      if (!result.ok) return rules();
      return { ...result, structure: measured.structure ?? result.structure };
    },
    rules,
    { waitMs: WAIT.prose, timeoutMs: 180_000 },
  );
  return value;
}

/* -------------------------------------------------------------------------- */
/*                       6 · solutions + single answer                          */
/* -------------------------------------------------------------------------- */

export interface SolutionsInput {
  subject?: string;
  syllabus?: string;
  papers: SolutionPaperInput[];
  topics?: Topic[];
  bands?: Map<string, import("@/lib/types").ExamTopic["band"]>;
}

export async function buildSolutions(input: SolutionsInput): Promise<SolutionsResponse> {
  const rules = () => buildSolutionsRules(input as SolutionsRulesInput);

  const { value } = await withAi(
    async () => {
      const result = await solutionsAi({
        subject: input.subject ?? "",
        syllabus: input.syllabus ?? "",
        papers: input.papers.map((paper) => ({
          label: paper.label,
          year: paper.year,
          questions: paper.questions.map((question) => ({
            index: question.index,
            text: question.text,
            marks: question.marks,
            topicTitle: input.topics?.find((t) => t.id === question.topicId)?.title,
          })),
        })),
      });
      if (!result.ok) return rules();

      // Merge: keep the rule engine's difficulty/important tags where the model
      // did not provide them, so no entry is ever half-filled.
      const fallback = rules();
      if (!fallback.ok || !fallback.papers) return result;
      return {
        ...result,
        papers: result.papers!.map((paper, index) => {
          const base = fallback.papers!.find((p) => p.label === paper.label) ?? fallback.papers![index];
          if (!base) return paper;
          return {
            ...paper,
            entries: paper.entries.map((entry) => {
              const twin = base.entries.find((e) => e.index === entry.index);
              return twin
                ? { ...entry, difficulty: entry.difficulty ?? twin.difficulty, important: entry.important || twin.important }
                : entry;
            }),
          };
        }),
      };
    },
    rules,
    { waitMs: WAIT.prose, timeoutMs: 240_000 },
  );
  return value;
}

export type { AnswerRulesInput, ChatRulesInput, SolutionsRulesInput };

export async function buildAnswer(input: AnswerRulesInput): Promise<AnswerResponse> {
  const rules = () => buildAnswerRules(input);
  const { value } = await withAi(() => answerAi(input), rules, {
    waitMs: WAIT.prose,
    timeoutMs: 120_000,
  });
  return value;
}

/* -------------------------------------------------------------------------- */
/*                                7 · study coach                                */
/* -------------------------------------------------------------------------- */

export async function buildChat(input: ChatRulesInput): Promise<ChatResponse> {
  const rules = () => buildChatRules(input);
  const { value } = await withAi(
    () =>
      chatAi({
        message: input.message,
        history: input.history ?? [],
        subject: input.subject ?? "",
        topics: (input.topics ?? []).map((t) => ({
          title: t.title,
          description: t.description,
        })),
        syllabus: input.syllabus ?? "",
      }),
    rules,
    { waitMs: WAIT.chat, timeoutMs: 90_000 },
  );
  return value;
}

/* -------------------------------------------------------------------------- */
/*                              8 · study plan                                   */
/* -------------------------------------------------------------------------- */

export interface PlanInput {
  subject: string;
  picks: PlanPick[];
  totalDays: number;
}

export async function buildPlan(input: PlanInput): Promise<PlanResponse> {
  const rules = () => buildPlanRules(input as PlanRulesInput);

  const { value } = await withAi(
    async () => {
      const result = await planAi({
        subject: input.subject,
        picks: input.picks.map((p) => ({
          title: p.title,
          minutes: p.minutes ?? 20,
          importance: p.importance ?? "important",
          videoTitle: p.videoTitle,
          videoUrl: p.videoUrl,
        })),
        totalDays: input.totalDays,
      });
      if (!result.ok || !result.days?.length) return rules();
      // Render the model's own days with the deterministic renderer, so the
      // downloadable Markdown always matches the days shown on screen.
      return {
        ...result,
        markdown: daysToMarkdown(
          result.days,
          result.tips ?? [],
          input.subject,
          input.totalDays,
        ),
      };
    },
    rules,
    { waitMs: WAIT.prose, timeoutMs: 120_000 },
  );
  return value;
}

/* -------------------------------------------------------------------------- */
/*                          9 · YouTube search links                            */
/* -------------------------------------------------------------------------- */

/**
 * Never touches YouTube. Builds a link to YouTube's own results page and
 * labels it as a suggestion — the student sees whatever YouTube returns.
 */
export function topicSearches(input: SearchLinksInput): TopicResult {
  return buildSearchLinks(input);
}

export type { QuizTopicInput, SearchLinksInput, PlanPick };
