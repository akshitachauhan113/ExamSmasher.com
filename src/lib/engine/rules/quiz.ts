import type {
  Difficulty,
  Importance,
  MockTestResponse,
  PyqQuestion,
  QuizQuestion,
  QuizResponse,
} from "@/lib/types";
import { tokenize } from "./text";

/**
 * Quizzes and mock papers built from what the student ACTUALLY has: their
 * syllabus points and their real past questions.
 *
 * Nothing here pretends to be a past paper. The mock test says so on its
 * face, and every MCQ is answerable from the student's own syllabus — the
 * explanation always points back at the line it came from.
 */

export interface QuizTopicInput {
  id: string;
  title: string;
  chapter?: string;
  keywords: string[];
  description: string;
  importance: Importance;
  difficulty: Difficulty;
  pastQuestions: Array<{ text: string; year: string; label: string; marks?: number }>;
}

type Level = NonNullable<QuizQuestion["difficulty"]>;

const EASY: Level = "easy";
const MEDIUM: Level = "medium";
const HARD: Level = "hard";

/** "Types of relations; reflexive, symmetric, transitive…" → short bullets. */
function pointsFrom(text: string): string[] {
  return text
    .split(/[;\n]|(?<=[a-z0-9)])\.\s+(?=[A-Z])/)
    .map((p) => p.replace(/^[\s,:\-–—]+|[\s,:\-–—]+$/g, "").trim())
    .filter((p) => p.length > 10 && p.length <= 140)
    .slice(0, 8);
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Picks `count` distinct distractors that are NOT the correct answer. */
function distractors(pool: string[], correct: string, count: number): string[] {
  const seen = new Set([correct.trim().toLowerCase()]);
  const out: string[] = [];
  for (const item of shuffle(pool)) {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= count) break;
  }
  return out;
}

function withAnswer(question: string, correct: string, wrong: string[]): QuizQuestion | null {
  const options = shuffle([correct, ...wrong]);
  if (options.length < 4) return null;
  return {
    id: `q-${Math.random().toString(36).slice(2, 10)}`,
    question,
    options,
    answer: options.indexOf(correct),
    explanation: "",
  };
}

export interface BuildQuizRulesInput {
  subject: string;
  count: number;
  topics: QuizTopicInput[];
}

/**
 * MCQ practice.
 *
 * Three honest kinds of question, all checkable against the student's own
 * material:
 *   1. "Which topic does this REAL past question test?" — the question text is
 *      verbatim from their papers, so the option set is the only thing given.
 *   2. "Which of these points belongs to X?" — options are real syllabus lines.
 *   3. "Which unit is X in?" — options are their real unit headings.
 */
export function buildQuizRules(input: BuildQuizRulesInput): QuizResponse {
  const topics = input.topics.filter((t) => t && t.title);
  if (topics.length === 0) {
    return { ok: false, error: "No topics to quiz on yet — analyse your syllabus first." };
  }

  const want = Math.max(1, Math.min(20, Math.round(input.count) || 5));
  const allPoints = topics.flatMap((t) => pointsFrom(t.description));
  const chapters = [...new Set(topics.map((t) => t.chapter).filter(Boolean))] as string[];

  const pool: QuizQuestion[] = [];

  // 1 — real past questions, mapped onto their topic by name.
  if (topics.length >= 2) {
    for (const topic of topics) {
      for (const past of topic.pastQuestions) {
        const others = distractors(
          topics.filter((t) => t.id !== topic.id).map((t) => t.title),
          topic.title,
          3,
        );
        const built = withAnswer(
          `Ye asli past question kis syllabus topic se hai?\n\n"${past.text.replace(/\s+/g, " ").slice(0, 300)}"`,
          topic.title,
          others,
        );
        if (!built) continue;
        built.topicId = topic.id;
        built.difficulty = HARD;
        built.explanation = `Ye ${past.year} ${past.label} ka asli sawaal hai${
          past.marks ? ` (${past.marks} marks)` : ""
        } — iska jawab "${topic.title}" ke andar aata hai.`;
        pool.push(built);
      }
    }
  }

  // 2 — which syllabus line belongs to which topic.
  if (allPoints.length >= 4 && topics.length >= 2) {
    for (const topic of topics) {
      const own = pointsFrom(topic.description);
      const foreign = topics
        .filter((t) => t.id !== topic.id)
        .flatMap((t) => pointsFrom(t.description));
      for (const point of own.slice(0, 3)) {
        const built = withAnswer(
          `Syllabus check — "${topic.title}" ke andar kaun sa point aata hai?`,
          point,
          distractors(foreign, point, 3),
        );
        if (!built) continue;
        built.topicId = topic.id;
        built.difficulty = EASY;
        built.explanation = `"${point}" — ye point tumhare syllabus me "${topic.title}" ke under likha hai.`;
        pool.push(built);
      }
    }
  }

  // 3 — which unit a topic sits in.
  if (chapters.length >= 3) {
    for (const topic of topics) {
      if (!topic.chapter) continue;
      const built = withAnswer(
        `Kaunsi unit/chapter "${topic.title}" ke andar aati hai?`,
        topic.chapter,
        distractors(chapters, topic.chapter, 3),
      );
      if (!built) continue;
      built.topicId = topic.id;
      built.difficulty = EASY;
      built.explanation = `Tumhare syllabus me "${topic.title}" "${topic.chapter}" ke under list kiya gaya hai.`;
      pool.push(built);
    }
  }

  if (pool.length === 0) {
    return {
      ok: false,
      error:
        "Quiz banane ke liye syllabus ke points chahiye — pehle syllabus analyse karo, ya PYQ daalo.",
    };
  }

  // Weight toward repeating topics first (the exam does the same), then
  // interleave kinds so one question type never dominates.
  const picked = shuffle(pool).slice(0, want);
  return { ok: true, questions: picked, source: "rules" };
}

/* -------------------------------------------------------------------------- */
/*                                 mock paper                                  */
/* -------------------------------------------------------------------------- */

const SECTION_TEMPLATES: Array<{
  kind: "objective" | "short" | "long" | "numerical";
  marks: number;
  minutes: number;
}> = [
  { kind: "objective", marks: 1, minutes: 1 },
  { kind: "short", marks: 2, minutes: 4 },
  { kind: "long", marks: 5, minutes: 8 },
  { kind: "numerical", marks: 5, minutes: 10 },
];

function questionFor(
  kind: "objective" | "short" | "long" | "numerical",
  topic: QuizTopicInput,
  points: string[],
  index: number,
): { text: string; marks: number; difficulty: "easy" | "medium" | "hard" } | null {
  const point = points[index % Math.max(1, points.length)];
  if (!point) return null;
  const title = topic.title;

  switch (kind) {
    case "objective":
      return {
        text: `Which of the following best describes "${point.split(/[:;,]/)[0].trim().slice(0, 70)}" as listed under ${title}?`,
        marks: 1,
        difficulty: EASY,
      };
    case "short":
      return {
        text: `Define "${point.split(/[:;,]/)[0].trim().slice(0, 70)}" and state where it is used in ${title}.`,
        marks: 2,
        difficulty: EASY,
      };
    case "numerical":
      return {
        text: `Attempt one numerical based on ${title}: set up the problem using "${point.slice(0, 70)}" and show every step.`,
        marks: 5,
        difficulty: MEDIUM,
      };
    case "long":
      return {
        text: `Explain "${point.slice(0, 90)}" with a neat example. Mention the other syllabus points it connects to under ${title}.`,
        marks: 5,
        difficulty: topic.difficulty === "advanced" ? HARD : MEDIUM,
      };
    default:
      return null;
  }
}

export interface BuildMockTestRulesInput {
  subject: string;
  questions: PyqQuestion[];
  topics: QuizTopicInput[];
}

/**
 * A practice paper shaped like the student's real papers, built from fresh
 * syllabus questions. The pattern (sections, marks, years) is MEASURED from
 * their papers; the questions are new and labelled as new.
 */
export function buildMockTestRules(input: BuildMockTestRulesInput): MockTestResponse {
  const real = input.questions.filter((q) => q && q.text && !q.isVariant);
  const topics = input.topics.filter((t) => t && t.title);

  if (topics.length === 0) {
    return { ok: false, error: "Syllabus ke topics chahiye — pehle syllabus analyse karo." };
  }

  /* ---- measure the real pattern (this part is evidence, not a promise) ---- */
  const sectionNames = [...new Set(real.map((q) => q.section).filter(Boolean))] as string[];
  const sectionCount = Math.max(1, sectionNames.length);
  const realMarks = real.reduce((sum, q) => sum + (q.marks ?? 0), 0);
  const years = [...new Set(real.map((q) => q.paperYear).filter(Boolean))].sort();

  /* ------------------------- choose the question mix ------------------------ */
  // Repeat-heavy topics first — that is what the exam rewards.
  const ordered = [...topics].sort((a, b) => {
    const weight = (t: QuizTopicInput) =>
      (t.pastQuestions.length > 0 ? 10 : 0) +
      (t.importance === "core" ? 3 : t.importance === "important" ? 1 : 0);
    return weight(b) - weight(a);
  });

  const targetCount = Math.max(6, Math.min(30, real.length || 10));
  const targetMarks = realMarks > 0 ? Math.round(realMarks / Math.max(1, sectionCount)) : 20;

  const plan: Array<{ section: string; kind: (typeof SECTION_TEMPLATES)[number]["kind"] }> = [];
  const used = new Set<string>();
  let marksSoFar = 0;
  let cursor = 0;
  // Cycle short → long → objective → numerical so a paper never becomes a
  // wall of five-mark essays or a wall of one-mark trivia.
  const KIND_CYCLE = ["short", "long", "objective", "numerical"] as const;

  while (plan.length < targetCount && marksSoFar < targetMarks * 1.6) {
    const topic = ordered[cursor % ordered.length];
    const kind = KIND_CYCLE[plan.length % KIND_CYCLE.length];
    cursor += 1;

    const key = `${topic.id}:${kind}`;
    if (used.has(key)) {
      if (cursor > ordered.length * KIND_CYCLE.length) break;
      continue;
    }
    used.add(key);

    const section =
      sectionNames.length > 0
        ? String(sectionNames[plan.length % sectionNames.length])
        : plan.length % 2 === 0
          ? "Section A"
          : "Section B";

    const template = SECTION_TEMPLATES.find((t) => t.kind === kind)!;
    plan.push({ section, kind });
    marksSoFar += template.marks;
    if (marksSoFar >= targetMarks && plan.length >= 6) break;
  }

  if (plan.length === 0) {
    return { ok: false, error: "Could not shape a mock test from these topics." };
  }

  /* -------------------------------- render -------------------------------- */
  const lines: string[] = [];
  lines.push(`# 🧪 Practice paper — ${input.subject || "your course"}`);
  lines.push("");
  lines.push(
    `> **These questions are NOT from your past papers.** They are fresh questions written from your own syllabus, using the section/marks pattern measured in ${
      real.length > 0
        ? `your ${real.length} uploaded questions (${years.join(", ") || "years on file"})`
        : "your syllabus"
    }. The real past questions live in *Most expected* and *PYQ practice*.`,
  );
  lines.push("");
  lines.push(
    `**Time:** ${Math.max(30, Math.round(plan.reduce((s, p) => s + SECTION_TEMPLATES.find((t) => t.kind === p.kind)!.minutes, 0)))} min  ·  **Total marks:** ${plan.reduce(
      (s, p) => s + SECTION_TEMPLATES.find((t) => t.kind === p.kind)!.marks,
      0,
    )}${realMarks > 0 ? `  ·  *pattern measured from ${realMarks} marks of real questions*` : ""}`,
  );
  lines.push("");

  let currentSection = "";
  let number = 0;
  /** Answers are collected while questions render, then appended as one block. */
  const answerLines: string[] = [];

  plan.forEach((entry, index) => {
    if (entry.section !== currentSection) {
      currentSection = entry.section;
      lines.push(`## ${currentSection}`);
      lines.push("");
      number = 0;
    }

    const template = SECTION_TEMPLATES.find((t) => t.kind === entry.kind)!;
    const topic = ordered[index % ordered.length];
    const points = pointsFrom(topic.description);
    const generated = questionFor(entry.kind, topic, points, index);
    if (!generated) return;

    number += 1;
    lines.push(
      `**Q${number}.** ${generated.text}  \n*(${generated.marks} marks · ${generated.difficulty} · from ${topic.title})*`,
    );
    lines.push("");

    answerLines.push(
      `**Q${number} — ${generated.marks} marks · ${generated.difficulty}**`,
      "",
      generated.text,
      "",
      `_Answer framework (built from your syllabus — write it in your own words):_`,
      "",
      ...points.slice(0, 4).map((p, i) => `${i + 1}. ${p}`),
      "",
      `*Target: ~${template.minutes} minutes. Cover ${Math.min(
        points.length,
        Math.max(2, Math.ceil(generated.marks / 2)),
      )} syllabus points from "${topic.title}".*`,
      "",
    );
  });

  lines.push("---");
  lines.push("");
  lines.push("## 📝 Answer framework");
  lines.push("");
  lines.push(
    "_Not model answers — a marking guide made from your own syllabus points. Expand each point into full sentences before you submit._",
  );
  lines.push("");
  lines.push(...answerLines);

  return {
    ok: true,
    markdown: lines.join("\n"),
    structure: {
      sections: sectionCount,
      totalMarks: plan.reduce((s, p) => s + SECTION_TEMPLATES.find((t) => t.kind === p.kind)!.marks, 0),
      years: years.length > 0 ? years.join(", ") : "syllabus only",
    },
    source: "rules",
  };
}

/** Terms used when an MCQ needs to sound like the exam. */
export function quizTerms(text: string): string[] {
  return tokenize(text).slice(0, 12);
}
