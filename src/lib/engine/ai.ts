import { generateJson, generateText } from "@/lib/ai/generate";
import type {
  AnalyzeResponse,
  AnswerResponse,
  ChatResponse,
  DetailedSection,
  Difficulty,
  EngineSource,
  ExamPlanResponse,
  Flashcard,
  FullNotesResponse,
  Importance,
  MockTestResponse,
  NotesLang,
  NotesResponse,
  NotesSection,
  PapersResponse,
  PlanDay,
  PlanItem,
  PlanResponse,
  PyqQuestion,
  QuizQuestion,
  QuizResponse,
  SolutionEntry,
  SolutionsResponse,
  SolvedPaper,
  Topic,
} from "@/lib/types";
import { normalizeParsedQuestions, type PaperInput } from "@/lib/exam";

/**
 * Every feature the in-browser model can write.
 *
 * Each function THROWS when the model returns something unusable — the
 * facade catches that and falls back to the rule-based engine, so a weak
 * generation degrades into an honest answer instead of a broken screen.
 *
 * Outputs are always re-normalised before they are shown: a 360M model will
 * happily omit a field, and a missing `importance` must become a sensible
 * default rather than `undefined` leaking into the UI.
 */

const MATH_RULE = `EQUATIONS: write every formula in LaTeX — $...$ inline, $$...$$ on its own line.`;

const LANGUAGE_RULE = (language?: NotesLang): string =>
  language === "hinglish"
    ? `LANGUAGE: easy HINGLISH — explain like a friend would. Keep technical terms, law names and formulas in standard English.`
    : `LANGUAGE: clear, simple English.`;

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const asString = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const IMPORTANCE: Importance[] = ["core", "important", "bonus"];
const DIFFICULTY: Difficulty[] = ["beginner", "intermediate", "advanced"];

/* -------------------------------------------------------------------------- */
/*                              1 · syllabus                                    */
/* -------------------------------------------------------------------------- */

export async function analyzeSyllabusAi(input: {
  syllabus: string;
  subject?: string;
  maxTopics: number;
}): Promise<AnalyzeResponse> {
  const prompt = `Split this syllabus into study topics.

RULES
- At most ${input.maxTopics} topics. One topic = one teachable chunk (a sub-unit, a chapter section, a named concept group).
- Use the syllabus's own wording for titles. Do not invent topics that are not listed.
- importance: "core" for exam-critical units, "important" for the middle, "bonus" for optional/extra.
- difficulty: "beginner" | "intermediate" | "advanced".
- estimatedMinutes: 10-90, realistic for a first pass.
- chapter: the unit/chapter heading this topic sits under (or "" ).
${input.subject ? `Subject: ${input.subject}` : ""}

Return ONLY this JSON shape:
{"subject":"...","topics":[{"title":"...","description":"...","keywords":["..."],"importance":"core","difficulty":"intermediate","estimatedMinutes":25,"chapter":""}]}

SYLLABUS
"""
${input.syllabus}
"""`;

  const parsed = await generateJson<{ subject?: unknown; topics?: unknown }>(prompt, {
    temperature: 0.2,
    maxTokens: 2000,
    timeoutMs: 90_000,
  });

  const raw = Array.isArray(parsed?.topics) ? parsed.topics : [];
  const drafts: Array<Topic | null> = raw.map((entry, index) => {
    const item = entry as Record<string, unknown>;
    const title = asString(item?.title, 120);
    if (title.length < 3) return null;
    const keywords = Array.isArray(item?.keywords)
      ? (item.keywords as unknown[])
          .map((k) => asString(k, 60))
          .filter(Boolean)
          .slice(0, 10)
      : [];
    const importance = IMPORTANCE.includes(item?.importance as Importance)
      ? (item.importance as Importance)
      : "important";
    const difficulty = DIFFICULTY.includes(item?.difficulty as Difficulty)
      ? (item.difficulty as Difficulty)
      : "intermediate";
    return {
      id: `t${index + 1}`,
      title,
      description: asString(item?.description, 400),
      keywords,
      importance,
      difficulty,
      estimatedMinutes: clampInt(item?.estimatedMinutes, 10, 90, 25),
      chapter: asString(item?.chapter, 60) || undefined,
    } satisfies Topic;
  });
  const topics = drafts.filter((t): t is Topic => t !== null).slice(0, input.maxTopics);

  if (topics.length === 0) throw new Error("Model returned no usable topics.");

  return {
    ok: true,
    subject: asString(parsed?.subject, 80) || input.subject || "",
    topics,
    truncated: topics.length >= input.maxTopics,
    source: "ai",
  };
}

/* -------------------------------------------------------------------------- */
/*                            2 · past papers                                  */
/* -------------------------------------------------------------------------- */

export async function parsePapersAi(input: {
  subject?: string;
  papers: PaperInput[];
  texts: Record<string, string>;
}): Promise<PapersResponse> {
  const blocks = input.papers
    .map(
      (paper) =>
        `PAPER id="${paper.id}" label="${paper.label}" year="${paper.year}"\n${(input.texts[paper.id] ?? "").slice(0, 7000)}`,
    )
    .join("\n\n---\n\n");

  const prompt = `Read these previous-year question papers and extract EVERY question exactly as printed.

RULES
- Keep the original wording. Do not paraphrase, answer or add questions.
- "number" as printed (e.g. "Q4", "3(b)").
- "section" if the paper groups questions (e.g. "Section B") else "".
- "marks" as a number, or omit it.
- "type": "objective" | "short" | "long" | "numerical" | "proof" | "other".
- Skip instructions, roll numbers and time allowed.
- If a paper is unreadable, return an empty array for it — never guess.

Return ONLY: {"papers":[{"id":"...","questions":[{"number":"","section":"","marks":0,"type":"short","text":"..."}]}]}

${blocks}`;

  const parsed = await generateJson<{ papers?: unknown }>(prompt, {
    temperature: 0,
    maxTokens: 3000,
    timeoutMs: 120_000,
  });

  const byId = new Map<string, Array<Record<string, unknown>>>();
  for (const entry of Array.isArray(parsed?.papers) ? parsed.papers : []) {
    const item = entry as { id?: unknown; questions?: unknown };
    const id = asString(item?.id, 40);
    if (!id || !Array.isArray(item.questions)) continue;
    byId.set(id, item.questions as Array<Record<string, unknown>>);
  }

  const raw: Array<Record<string, unknown>> = [];
  const papers: PaperInput[] = [];

  for (const paper of input.papers) {
    const questions = byId.get(paper.id) ?? [];
    if (questions.length === 0) continue;
    papers.push(paper);
    for (const q of questions) {
      const text = asString(q?.text, 1200);
      if (text.length < 6) continue;
      raw.push({
        paperId: paper.id,
        number: asString(q?.number, 20) || undefined,
        section: asString(q?.section, 40) || undefined,
        marks: clampInt(q?.marks, 0, 100, 0) || undefined,
        type: asString(q?.type, 20),
        text,
      });
    }
  }

  if (papers.length === 0) throw new Error("Model read no questions.");

  const { questions, papers: counted, dropped } = normalizeParsedQuestions(
    raw as Parameters<typeof normalizeParsedQuestions>[0],
    papers,
  );
  if (questions.length === 0) throw new Error("Model produced no usable questions.");

  return { ok: true, questions, papers: counted, dropped, source: "ai" };
}

/* -------------------------------------------------------------------------- */
/*                      3 · question → topic mapping                          */
/* -------------------------------------------------------------------------- */

/** Only the MAPPING is generated — every count is still computed from reality. */
export async function mapQuestionsAi(
  topics: Topic[],
  questions: PyqQuestion[],
): Promise<PyqQuestion[]> {
  const topicList = topics
    .map((t) => `${t.id}: ${t.title}${t.chapter ? ` (${t.chapter})` : ""} — ${t.keywords.slice(0, 6).join(", ")}`)
    .join("\n");

  const questionList = questions
    .map((q) => `${q.id}: ${q.text.replace(/\s+/g, " ").slice(0, 300)}`)
    .join("\n");

  const prompt = `Map each past question onto the syllabus topic it belongs to.

TOPICS
${topicList}

QUESTIONS
${questionList}

Rules: answer only from the list above; use "" when nothing fits (never force a fit).
Return ONLY: {"mapping":{"<questionId>":"<topicId>"}}`;

  const parsed = await generateJson<{ mapping?: unknown }>(prompt, {
    temperature: 0,
    maxTokens: Math.max(600, questions.length * 24),
    timeoutMs: 90_000,
  });

  const mapping = (parsed?.mapping ?? {}) as Record<string, unknown>;
  const valid = new Set(topics.map((t) => t.id));
  let applied = 0;

  const out = questions.map((q) => {
    const target = asString(mapping[q.id], 40);
    if (!target || !valid.has(target)) return q;
    applied += 1;
    return { ...q, topicId: q.topicId ?? target };
  });

  if (applied === 0) throw new Error("Model mapped nothing.");
  return out;
}

/* -------------------------------------------------------------------------- */
/*                                4 · notes                                     */
/* -------------------------------------------------------------------------- */

export async function topicNotesAi(input: {
  topic: Topic;
  subject?: string;
  syllabus?: string;
  language?: NotesLang;
}): Promise<NotesResponse> {
  const prompt = `Write study notes for ONE topic from the syllabus below.

STRICT: only explain what the syllabus itself lists. Do not invent facts, formulas or dates.
${MATH_RULE}
${LANGUAGE_RULE(input.language)}

Topic: ${input.topic.title}
Chapter: ${input.topic.chapter ?? "-"}
Syllabus lines for it: ${input.topic.description || "(see syllabus)"}

${input.subject ? `Course: ${input.subject}` : ""}
Syllabus excerpt:
"""${(input.syllabus ?? "").slice(0, 4000)}"""

Return ONLY:
{"detailed":[{"heading":"...","paragraphs":["..."]}],"notes":[{"heading":"...","bullets":["..."]}],"cards":[{"q":"...","a":"..."}]}

detailed: 3 sections (concept → syllabus points → how to study for the exam), 2-3 paragraphs each.
notes: 2 sections of short bullets.
cards: 6-10 question/answer flashcards.`;

  const parsed = await generateJson<{
    detailed?: unknown;
    notes?: unknown;
    cards?: unknown;
  }>(prompt, { temperature: 0.4, maxTokens: 1800, timeoutMs: 90_000 });

  const detailed = normalizeDetailed(parsed?.detailed);
  const notes = normalizeSections(parsed?.notes);
  const cards = normalizeCards(parsed?.cards);

  if (detailed.length === 0) throw new Error("Model returned no notes.");
  return { ok: true, detailed, notes, cards, source: "ai" };
}

export function normalizeDetailed(raw: unknown): DetailedSection[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const item = entry as { heading?: unknown; paragraphs?: unknown };
      const heading = asString(item?.heading, 120);
      const paragraphs = Array.isArray(item?.paragraphs)
        ? (item.paragraphs as unknown[]).map((p) => asString(p, 900)).filter(Boolean).slice(0, 5)
        : [];
      return heading && paragraphs.length > 0 ? { heading, paragraphs } : null;
    })
    .filter((s): s is DetailedSection => s !== null)
    .slice(0, 6);
}

export function normalizeSections(raw: unknown): NotesSection[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const item = entry as { heading?: unknown; bullets?: unknown };
      const heading = asString(item?.heading, 120);
      const bullets = Array.isArray(item?.bullets)
        ? (item.bullets as unknown[]).map((b) => asString(b, 300)).filter(Boolean).slice(0, 10)
        : [];
      return heading && bullets.length > 0 ? { heading, bullets } : null;
    })
    .filter((s): s is NotesSection => s !== null)
    .slice(0, 4);
}

export function normalizeCards(raw: unknown): Flashcard[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const item = entry as { q?: unknown; a?: unknown };
      const q = asString(item?.q, 300);
      const a = asString(item?.a, 500);
      return q && a ? { q, a } : null;
    })
    .filter((c): c is Flashcard => c !== null)
    .slice(0, 14);
}

/* -------------------------------------------------------------------------- */
/*                          5 · whole-syllabus notes                           */
/* -------------------------------------------------------------------------- */

export async function fullNotesAi(input: {
  syllabus: string;
  subject: string;
  language?: NotesLang;
}): Promise<FullNotesResponse> {
  const prompt = `Write one continuous Markdown study document for this whole syllabus.

STRICT: cover only what the syllabus lists — no invented facts.
${MATH_RULE}
${LANGUAGE_RULE(input.language)}

Structure: one "## " per unit/chapter, then "### What the syllabus asks for" (bullets), "### How to study this" (short prose), "### Exam corner" (3 likely questions built from those bullets).
Start the document with a one-line note that it was built from the student's own syllabus.

Course: ${input.subject}
Syllabus:
"""${input.syllabus.slice(0, 9000)}"""

Reply with the Markdown document only.`;

  const markdown = await generateText(prompt, {
    temperature: 0.4,
    maxTokens: 3000,
    timeoutMs: 180_000,
  });

  if (markdown.length < 200) throw new Error("Model returned an empty document.");
  return { ok: true, markdown, source: "ai" };
}

/* -------------------------------------------------------------------------- */
/*                             6 · quiz + mock                                 */
/* -------------------------------------------------------------------------- */

export async function quizAi(input: {
  subject: string;
  count: number;
  topics: Array<{ id: string; title: string; pastQuestions: string[] }>;
}): Promise<QuizResponse> {
  const list = input.topics
    .map(
      (t) =>
        `${t.id}: ${t.title}${t.pastQuestions.length ? `\n   real past questions: ${t.pastQuestions.join(" | ").slice(0, 400)}` : ""}`,
    )
    .join("\n");

  const prompt = `Write ${input.count} multiple-choice questions for: ${input.subject}

TOPICS
${list}

Rules:
- Exactly 4 options, exactly one correct.
- Prefer questions whose answer comes from a REAL past question above; mark topicId with the topic's id.
- explanation: 1-2 sentences saying why the answer is right.
- difficulty: "easy" | "medium" | "hard".

Return ONLY:
{"questions":[{"question":"...","options":["...","...","...","..."],"answer":0,"explanation":"...","topicId":"t1","difficulty":"medium"}]}`;

  const parsed = await generateJson<{ questions?: unknown }>(prompt, {
    temperature: 0.5,
    maxTokens: 2000,
    timeoutMs: 120_000,
  });

  const valid = new Set(input.topics.map((t) => t.id));
  const drafts: Array<QuizQuestion | null> = (
    Array.isArray(parsed?.questions) ? parsed.questions : []
  ).map((entry, index) => {
    const item = entry as Record<string, unknown>;
    const question = asString(item?.question, 500);
    const options = Array.isArray(item?.options)
      ? (item.options as unknown[]).map((o) => asString(o, 220)).filter(Boolean)
      : [];
    const answer = Number(item?.answer);
    if (question.length < 8 || options.length !== 4) return null;
    if (!Number.isInteger(answer) || answer < 0 || answer > 3) return null;
    const topicId = asString(item?.topicId, 40);
    return {
      id: `q-ai-${index}`,
      question,
      options,
      answer,
      explanation: asString(item?.explanation, 400),
      topicId: valid.has(topicId) ? topicId : undefined,
      difficulty: (["easy", "medium", "hard"] as const).includes(item?.difficulty as "easy")
        ? (item.difficulty as "easy" | "medium" | "hard")
        : "medium",
    } satisfies QuizQuestion;
  });
  const questions = drafts.filter((q): q is QuizQuestion => q !== null);

  if (questions.length === 0) throw new Error("Model returned no quiz questions.");
  return { ok: true, questions: questions.slice(0, input.count), source: "ai" };
}

export async function mockTestAi(input: {
  subject: string;
  structure: { sections: number; totalMarks: number; years: string };
  realQuestions: string[];
  topics: Array<{ id: string; title: string; description: string }>;
}): Promise<MockTestResponse> {
  const prompt = `Set ONE practice paper for "${input.subject}".

The pattern below was MEASURED from the student's real papers — match its section shape and marks.
IMPORTANT: these are FRESH questions written from the syllabus. Say so in a blockquote at the top.

MEASURED PATTERN: ${input.structure.sections} sections · ${input.structure.totalMarks} marks · years ${input.structure.years}

TOPICS (write questions only from these)
${input.topics.map((t) => `${t.title}: ${t.description.slice(0, 200)}`).join("\n")}

REAL questions (for tone, do NOT copy them)
${input.realQuestions.slice(0, 12).map((q) => `- ${q.replace(/\s+/g, " ").slice(0, 160)}`).join("\n")}

Then append a "## 📝 Answer framework" section: for each question, 3-5 bullet points the student must cover.
${MATH_RULE}

Reply with Markdown only.`;

  const markdown = await generateText(prompt, {
    temperature: 0.5,
    maxTokens: 3000,
    timeoutMs: 180_000,
  });

  if (markdown.length < 300) throw new Error("Model returned an empty paper.");
  return { ok: true, markdown, structure: input.structure, source: "ai" };
}

/* -------------------------------------------------------------------------- */
/*                          7 · solutions + answers                            */
/* -------------------------------------------------------------------------- */

export async function solutionsAi(input: {
  subject: string;
  syllabus: string;
  papers: Array<{
    label: string;
    year: string;
    questions: Array<{ index: number; text: string; marks?: number; topicTitle?: string }>;
  }>;
}): Promise<SolutionsResponse> {
  const prompt = `Write a concise model answer for each question below, for: ${input.subject}

For each: give the answer the way an examiner wants to see it (short headed answer, not an essay), plus
"difficulty": "easy"|"medium"|"hard" and "important": true when the question looks like a repeating pattern.

STRICT: only use what the syllabus below covers. If unsure, give the STRUCTURE of a good answer and say which syllabus points to fill in — never invent facts.
${MATH_RULE}

SYLLABUS
"""${input.syllabus.slice(0, 6000)}"""

QUESTIONS
${input.papers
  .map(
    (p) =>
      `PAPER ${p.label} ${p.year}\n${p.questions.map((q) => `idx=${q.index}${q.marks ? ` marks=${q.marks}` : ""}${q.topicTitle ? ` topic=${q.topicTitle}` : ""}: ${q.text.replace(/\s+/g, " ").slice(0, 400)}`).join("\n")}`,
  )
  .join("\n\n")}

Return ONLY:
{"papers":[{"label":"...","year":"...","entries":[{"index":1,"answer":"...","difficulty":"medium","important":true}]}]}`;

  const parsed = await generateJson<{ papers?: unknown }>(prompt, {
    temperature: 0.4,
    maxTokens: 4000,
    timeoutMs: 240_000,
  });

  const solved: SolvedPaper[] = [];
  for (const entry of Array.isArray(parsed?.papers) ? parsed.papers : []) {
    const item = entry as { label?: unknown; year?: unknown; entries?: unknown };
    const label = asString(item?.label, 60);
    const year = asString(item?.year, 20);
    const entries: SolutionEntry[] = (Array.isArray(item?.entries) ? item.entries : [])
      .map((raw) => {
        const e = raw as Record<string, unknown>;
        const answer = asString(e?.answer, 6000);
        const index = Math.round(Number(e?.index));
        if (!answer || !Number.isFinite(index) || index < 1) return null;
        return {
          index,
          answer,
          difficulty: (["easy", "medium", "hard"] as const).includes(e?.difficulty as "easy")
            ? (e.difficulty as "easy" | "medium" | "hard")
            : "medium",
          important: e?.important === true,
        } satisfies SolutionEntry;
      })
      .filter((e): e is SolutionEntry => e !== null);
    if (entries.length > 0) solved.push({ label, year, entries });
  }

  if (solved.length === 0) throw new Error("Model produced no solutions.");
  return { ok: true, papers: solved, source: "ai" };
}

export async function answerAi(input: {
  question: string;
  subject?: string;
  topicTitle?: string;
  marks?: number;
  year?: string;
  syllabus?: string;
}): Promise<AnswerResponse> {
  const prompt = `Write the model answer for this past question.

Question (${input.marks ?? "?"} marks, ${input.year ?? "year unknown"}): ${input.question}
${input.topicTitle ? `Syllabus topic: ${input.topicTitle}` : ""}
${input.subject ? `Course: ${input.subject}` : ""}

Rules: answer ONLY what is asked; use headings and steps; every formula in LaTeX; scale length to the marks
(2 marks = 3 lines, 8 marks = a full structured answer).
If the syllabus below does not cover it, say so in one line and give the STRUCTURE a good answer should have.
${MATH_RULE}

Syllabus:
"""${(input.syllabus ?? "").slice(0, 4000)}"""

Reply with the answer only.`;

  const answer = await generateText(prompt, {
    temperature: 0.3,
    maxTokens: 1600,
    timeoutMs: 120_000,
  });
  if (answer.length < 30) throw new Error("Model returned an empty answer.");
  return { ok: true, answer, source: "ai" };
}

/* -------------------------------------------------------------------------- */
/*                                  8 · chat                                    */
/* -------------------------------------------------------------------------- */

export async function chatAi(input: {
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  subject: string;
  topics: Array<{ title: string; description: string }>;
  syllabus: string;
}): Promise<ChatResponse> {
  const prompt = `You are a study coach for ${input.subject || "a student's course"}.

You may only use the syllabus and topics below. Never invent syllabus content, marks, dates or statistics.
Answer in the same language the student writes in (Hinglish if they write Hinglish). Be concrete and short —
give a next action, not a lecture. If you cannot answer from the material, say so plainly.

TOPICS
${input.topics.map((t) => `- ${t.title}: ${t.description.slice(0, 160)}`).join("\n")}

SYLLABUS (excerpt)
"""${input.syllabus.slice(0, 3000)}"""

Reply with the message only.`;

  const reply = await generateText(prompt, {
    system: "You are ExamSmasher's study coach. Ground every answer in the supplied syllabus.",
    temperature: 0.5,
    maxTokens: 700,
    timeoutMs: 90_000,
  });

  if (!reply.trim()) throw new Error("Empty reply.");
  return { ok: true, reply: reply.trim(), source: "ai" };
}

/* -------------------------------------------------------------------------- */
/*                                9 · plan                                      */
/* -------------------------------------------------------------------------- */

export async function planAi(input: {
  subject: string;
  picks: Array<{ title: string; minutes: number; importance: Importance; videoTitle?: string; videoUrl?: string }>;
  totalDays: number;
}): Promise<PlanResponse> {
  const prompt = `Build a ${input.totalDays}-day study plan for "${input.subject}".

Budget: at most 60 minutes per day. Cover EVERY topic exactly once before the last day; leave the final day for revision.
Each item needs a title, minutes (5-45), type ("video"|"practice"|"revision") and — for video items — videoTitle and videoUrl copied EXACTLY from the input below.

TOPICS (in priority order)
${input.picks
  .map(
    (p) =>
      `- ${p.title} | ${p.minutes} min | ${p.importance}${p.videoUrl ? ` | video: ${p.videoTitle} (${p.videoUrl})` : ""}`,
  )
  .join("\n")}

Return ONLY:
{"days":[{"focus":"...","items":[{"title":"...","minutes":20,"type":"video","videoTitle":"...","videoUrl":"..."}]}],"tips":["..."]}`;

  const parsed = await generateJson<{ days?: unknown; tips?: unknown }>(prompt, {
    temperature: 0.4,
    maxTokens: 2400,
    timeoutMs: 120_000,
  });

  const dayDrafts: Array<PlanDay | null> = (
    Array.isArray(parsed?.days) ? parsed.days : []
  ).map((entry, index) => {
    const item = entry as { focus?: unknown; items?: unknown };
    const itemDrafts: Array<PlanItem | null> = (
      Array.isArray(item?.items) ? item.items : []
    ).map((raw) => {
      const i = raw as Record<string, unknown>;
      const title = asString(i?.title, 200);
      if (!title) return null;
      const videoUrl = asString(i?.videoUrl, 400);
      return {
        title,
        minutes: clampInt(i?.minutes, 5, 240, 20),
        type: (["video", "practice", "revision"] as const).includes(i?.type as "video")
          ? (i.type as "video" | "practice" | "revision")
          : videoUrl
            ? "video"
            : "practice",
        videoTitle: asString(i?.videoTitle, 160) || undefined,
        videoUrl: videoUrl.startsWith("http") ? videoUrl : undefined,
      } satisfies PlanItem;
    });
    const items = itemDrafts.filter((i): i is PlanItem => i !== null);
    return items.length > 0
      ? { day: index + 1, focus: asString(item?.focus, 160), items }
      : null;
  });
  const days = dayDrafts.filter((d): d is PlanDay => d !== null).slice(0, input.totalDays);

  if (days.length === 0) throw new Error("Model returned an empty plan.");

  const tips = (Array.isArray(parsed?.tips) ? parsed.tips : [])
    .map((t) => asString(t, 240))
    .filter(Boolean)
    .slice(0, 8);

  return { ok: true, days, tips, source: "ai" };
}

/* -------------------------------------------------------------------------- */

/** So a caller can tell AI failures apart from genuine input errors. */
export type { EngineSource, ExamPlanResponse };
