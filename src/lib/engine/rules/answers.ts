import type {
  AnswerResponse,
  ChatMessage,
  ChatResponse,
  ExamTopic,
  PyqQuestion,
  SolutionEntry,
  SolutionsResponse,
  SolvedPaper,
  Topic,
} from "@/lib/types";
import { possibleQuestions, topicBlock } from "./notes";
import { overlapScore, splitSentences, tokenize } from "./text";

/**
 * Answers, worked solutions and the study coach — all built from the
 * student's own syllabus and their own past papers.
 *
 * The honest rule here: we can say WHAT to cover and HOW to structure an
 * answer, because both come straight from the syllabus. We cannot recite a
 * textbook definition we have never read, so we never pretend to.
 */

const MAX_POINTS = 8;

function pointsFor(syllabus: string, topic: Topic | undefined, fallback: string): string[] {
  const block = topic ? topicBlock(syllabus, topic) : [];
  const joined = block.join(" ").replace(/^\s*[\d.]+/, "");
  const points = joined
    .split(/[;\n]|(?<=[a-z0-9)])\.\s+(?=[A-Z(])/)
    .map((p) => p.replace(/^[\s,:\-–—]+|[\s,:\-–—]+$/g, "").trim())
    .filter((p) => p.length > 10 && p.length <= 160);

  if (points.length > 0) return points.slice(0, MAX_POINTS);
  if (fallback.trim().length > 10) {
    return fallback
      .split(/[;\n]/)
      .map((p) => p.trim())
      .filter((p) => p.length > 10)
      .slice(0, MAX_POINTS);
  }
  return [];
}

function findTopic(topics: Topic[], topicTitle?: string): Topic | undefined {
  if (!topicTitle) return undefined;
  const needle = topicTitle.toLowerCase();
  return (
    topics.find((t) => t.title.toLowerCase() === needle) ??
    topics.find((t) => t.title.toLowerCase().includes(needle) || needle.includes(t.title.toLowerCase()))
  );
}

/* -------------------------------------------------------------------------- */
/*                              one model answer                               */
/* -------------------------------------------------------------------------- */

export interface AnswerRulesInput {
  question: string;
  subject?: string;
  topicTitle?: string;
  marks?: number;
  year?: string;
  /** Full syllabus, so the framework can quote the student's own points. */
  syllabus?: string;
  topics?: Topic[];
}

function structureFor(marks: number | undefined, topicTitle: string): string[] {
  const m = marks ?? 4;
  if (m <= 2) {
    return [
      "2-3 lines total: name the concept, then one line on what it means.",
      `One short example — it is worth more than a second definition here.`,
      `Stop. Do not pad: "${topicTitle}" is a 2-mark question for a reason.`,
    ];
  }
  if (m <= 4) {
    return [
      "One-line definition in the first sentence (examiners read only that line).",
      "Then 3 bullet points — one syllabus point each.",
      "Close with a single worked example or a diagram.",
    ];
  }
  if (m <= 8) {
    return [
      "Split the answer into 3 short headed sections.",
      "Section 1: what it is. Section 2: the mechanism/result. Section 3: why it matters.",
      "Use a diagram, derivation or table wherever the syllabus asks for one.",
      "End with one example that ties the three sections together.",
    ];
  }
  return [
    "Introduction: 2 lines stating what you are answering and why it matters.",
    "Three to four headed body sections — use the syllabus points as your headings so nothing is missed.",
    "A derivation, diagram or comparison table inside the largest section.",
    "Conclusion: 4-5 lines that restate the result in one sentence.",
  ];
}

/** An answer FRAMEWORK from the syllabus — labelled as exactly that. */
export function buildAnswerRules(input: AnswerRulesInput): AnswerResponse {
  const question = (input.question ?? "").replace(/\s+/g, " ").trim();
  if (question.length < 5) return { ok: false, error: "No question was sent." };

  const topic = findTopic(input.topics ?? [], input.topicTitle);
  const points = pointsFor(input.syllabus ?? "", topic, topic?.description ?? "");
  const title = topic?.title ?? input.topicTitle ?? input.subject ?? "this topic";
  const asking = splitSentences(question)[0] ?? question;

  const lines: string[] = [];
  lines.push(
    "> **Answer framework — built from your syllabus, not a verified textbook answer.** Expand each point into your own words before submitting.",
  );
  lines.push("");
  lines.push(`### What the question is asking`);
  lines.push("");
  lines.push(
    `${asking.length > 240 ? `${asking.slice(0, 240)}…` : asking}${
      input.year ? ` *(Asked in ${input.year}.)*` : ""
    }`,
  );
  lines.push("");

  if (points.length > 0) {
    lines.push(`### Cover these points (from your syllabus${topic ? ` — ${title}` : ""})`);
    lines.push("");
    points.forEach((point, i) => lines.push(`${i + 1}. ${point}`));
    lines.push("");
  } else {
    lines.push(`### What to cover`);
    lines.push("");
    lines.push(
      `Your syllabus has no section matching "${title}", so there is nothing honest to quote here. Open your class notes for this one and use the structure below.`,
    );
    lines.push("");
  }

  lines.push(`### How to write it for ${input.marks ?? "?"} marks`);
  lines.push("");
  structureFor(input.marks, title).forEach((step) => lines.push(`- ${step}`));
  lines.push("");

  lines.push(`### Examiner checklist`);
  lines.push("");
  lines.push("- Did you define the term before using it?");
  if (points.length > 0) {
    lines.push(`- Are all ${points.length} syllabus points covered at least once?`);
  }
  lines.push("- Is every formula in LaTeX-style notation with units?");
  lines.push("- Did you answer the exact question asked, not the nearby one?");
  lines.push("");

  if (topic && topic.keywords.length > 0) {
    lines.push(`### Key terms to name`);
    lines.push("");
    lines.push(topic.keywords.slice(0, 6).join(" · "));
  }

  return { ok: true, answer: lines.join("\n"), source: "rules" };
}

/* -------------------------------------------------------------------------- */
/*                            solved paper (all papers)                        */
/* -------------------------------------------------------------------------- */

export interface SolutionQuestionInput {
  /** 1-based index inside the paper's question list. */
  index: number;
  text: string;
  marks?: number;
  number?: string;
  type?: PyqQuestion["type"];
  topicId?: string;
  repeatCount?: number;
}

export interface SolutionPaperInput {
  label: string;
  year: string;
  questions: SolutionQuestionInput[];
}

export interface SolutionsRulesInput {
  subject?: string;
  papers: SolutionPaperInput[];
  topics?: Topic[];
  /** Full syllabus so each answer framework can quote the student's points. */
  syllabus?: string;
  /** topicId → Must / Might / Can skip, from the exam plan. */
  bands?: Map<string, ExamTopic["band"]>;
}

function difficultyOf(question: SolutionQuestionInput): SolutionEntry["difficulty"] {
  const marks = question.marks ?? 0;
  if (question.type === "objective" || (marks > 0 && marks <= 2)) return "easy";
  if (question.type === "proof" || question.type === "numerical" || marks >= 8) return "hard";
  if (question.type === "long" || marks >= 5) return "medium";
  return question.text.split(/\s+/).length > 40 ? "medium" : "easy";
}

export function buildSolutionsRules(input: SolutionsRulesInput): SolutionsResponse {
  const papers = (input.papers ?? []).filter((p) => Array.isArray(p.questions) && p.questions.length > 0);
  if (papers.length === 0) {
    return { ok: false, error: "No questions were sent — read your papers first." };
  }

  const topics = input.topics ?? [];
  const bands = input.bands ?? new Map<string, ExamTopic["band"]>();

  const solved: SolvedPaper[] = papers.map((paper) => ({
    label: paper.label,
    year: paper.year,
    entries: paper.questions.map((question) => {
      const topic = topics.find((t) => t.id === question.topicId);
      const built = buildAnswerRules({
        question: question.text,
        subject: input.subject,
        topicTitle: topic?.title,
        marks: question.marks,
        year: paper.year,
        syllabus: input.syllabus ?? "",
        topics,
      });

      const band = question.topicId ? bands.get(question.topicId) : undefined;
      const important =
        (question.repeatCount ?? 1) > 1 || band === "must";

      return {
        index: question.index,
        answer:
          built.answer ??
          "Could not build a framework for this question — check that the syllabus and papers are for the same subject.",
        difficulty: difficultyOf(question),
        important,
      };
    }),
  }));

  return { ok: true, papers: solved, source: "rules" };
}

/* -------------------------------------------------------------------------- */
/*                                study coach                                  */
/* -------------------------------------------------------------------------- */

export interface ChatRulesInput {
  message: string;
  history?: ChatMessage[];
  subject?: string;
  topics?: Topic[];
  syllabus?: string;
  /** Real past questions from the exam plan, so the coach can quote them. */
  pastQuestions?: PyqQuestion[];
}

const STRATEGY_RE =
  /\b(tonight|today|tomorrow|plan|schedule|routine|start|begin|revise|revision|kahan se|kaise|shuru|kitna time|how much time|days? left|last minute|crash)\b/i;
const PRACTICE_RE =
  /\b(practice|sawaal|question|questions|quiz|problem|pyq|past paper|previous year|test|solve)\b/i;
const EXPLAIN_RE =
  /\b(explain|samjha|samjhao|kya hai|what is|define|difference|batao|bata|why|kaise hota|how does)\b/i;

function bestTopicMatch(topics: Topic[], message: string): { topic: Topic; score: number } | null {
  const terms = tokenize(message);
  if (terms.length === 0) return null;

  let best: { topic: Topic; score: number } | null = null;
  for (const topic of topics) {
    const score =
      overlapScore(message, tokenize(topic.title), 4) +
      overlapScore(message, topic.keywords.flatMap((k) => tokenize(k)), 2) +
      overlapScore(message, tokenize(topic.description), 1);
    if (!best || score > best.score) best = { topic, score };
  }
  return best && best.score >= 2 ? best : null;
}

function topicCard(topic: Topic, questions: PyqQuestion[]): string[] {
  const out: string[] = [];
  out.push(
    `**${topic.title}**${topic.chapter ? ` — ${topic.chapter}` : ""} · ${topic.difficulty} · ~${topic.estimatedMinutes} min`,
  );
  out.push("");
  if (topic.description) {
    out.push(`Syllabus me iske andar ye hai:`);
    out.push("");
    topic.description
      .split(/[;\n]/)
      .map((p) => p.trim())
      .filter((p) => p.length > 8)
      .slice(0, 5)
      .forEach((p) => out.push(`- ${p}`));
    out.push("");
  }
  if (questions.length > 0) {
    out.push(`Papers me is par ye aaya hai:`);
    out.push("");
    questions.slice(0, 3).forEach((q) =>
      out.push(`- ${q.text.replace(/\s+/g, " ").slice(0, 180)} *(${q.paperYear}${q.marks ? `, ${q.marks} marks` : ""})*`),
    );
    out.push("");
  } else {
    out.push(`Abhi tak kisi purane paper me ye topic nahi mila — isliye importance syllabus se hi maani gayi hai.`);
    out.push("");
  }
  const possible = possibleQuestions(topic, topic.description.split(/[;\n]/).filter((p) => p.length > 10));
  if (possible.length > 0) {
    out.push(`Practice ke liye:`);
    possible.slice(0, 3).forEach((q) => out.push(`- ${q}`));
    out.push("");
  }
  out.push(`YouTube search (naye tab me khulega):`);
  out.push("");
  const query = encodeURIComponent(`${topic.title} tutorial`);
  out.push(`- [YouTube results](https://www.youtube.com/results?search_query=${query})`);
  return out;
}

function strategyCard(topics: Topic[], subject: string): string[] {
  const weight: Record<Topic["importance"], number> = { core: 0, important: 1, bonus: 2 };
  const ordered = [...topics].sort((a, b) => weight[a.importance] - weight[b.importance]);
  const picks = ordered.slice(0, 3);

  if (picks.length === 0) {
    return [
      `Abhi tak syllabus analyse nahi hua — pehle Step 1 complete karo, phir plan bana dunga.`,
    ];
  }

  const out: string[] = [];
  out.push(`**Aaj ke liye 30-minute plan**${subject ? ` — ${subject}` : ""}:`);
  out.push("");
  let left = 30;
  picks.forEach((topic, i) => {
    const minutes = Math.max(5, Math.min(left, i === 0 ? 15 : i === 1 ? 10 : 5));
    left -= minutes;
    out.push(
      `${i + 1}. **${topic.title}** — ${minutes} min (${
        i === 0 ? "syllabus points padho" : i === 1 ? "ek practice question banao" : "kal ke liye revise"
      })`,
    );
  });
  out.push("");
  out.push(
    `Har topic ke end me tick laga do — progress isi device par save hota hai. Pehle core topics, phir important, bonus me sirf time ho toh.`,
  );
  return out;
}

export function buildChatRules(input: ChatRulesInput): ChatResponse {
  const message = (input.message ?? "").trim();
  if (!message) return { ok: false, error: "Empty message." };

  const topics = input.topics ?? [];
  const match = bestTopicMatch(topics, message);

  if (match && EXPLAIN_RE.test(message)) {
    return {
      ok: true,
      reply: [
        `**${match.topic.title}** samajhne ka tareeka:`,
        "",
        `1. Syllabus ki har line ko ek-ek term samjho — "${match.topic.description.slice(0, 120)}"`,
        `2. Har term ka apne shabdon me definition likho (2 line se zyada nahi).`,
        `3. Ek example banao jo teeno terms ko jodta ho.`,
        "",
        `Level: ${match.topic.difficulty} · Priority: ${match.topic.importance} · ~${match.topic.estimatedMinutes} min`,
        "",
        ...topicCard(match.topic, (input.pastQuestions ?? []).filter((q) => q.topicId === match.topic.id)).slice(1),
      ].join("\n"),
      source: "rules",
    };
  }

  if (PRACTICE_RE.test(message)) {
    const pool = (input.pastQuestions ?? []).filter((q) => q.text && !q.isVariant);
    if (pool.length > 0) {
      const top = match ? pool.filter((q) => q.topicId === match.topic.id) : [];
      const list = (top.length > 0 ? top : pool).slice(0, 5);
      return {
        ok: true,
        reply: [
          `Tumhare asli papers se ${list.length} sawaal:`,
          "",
          ...list.map(
            (q, i) =>
              `${i + 1}. ${q.text.replace(/\s+/g, " ").slice(0, 220)} *(${q.paperYear} ${
                q.paperLabel
              }${q.marks ? `, ${q.marks} marks` : ""})*`,
          ),
          "",
          `Har sawaal ka answer framework topic panel ke **PYQ practice** section me milega.`,
        ].join("\n"),
        source: "rules",
      };
    }
    return {
      ok: true,
      reply: [
        `Abhi tak koi past paper upload nahi hua, isliye asli sawaal nahi de sakta.`,
        "",
        `Isi waqt ke liye: syllabus ke top3 topics par ye practice questions bana lo —`,
        "",
        ...topics.slice(0, 3).flatMap((t) =>
          possibleQuestions(t, t.description.split(/[;\n]/).filter((p) => p.length > 10))
            .slice(0, 2)
            .map((q) => `- ${q}`),
        ),
        "",
        `Asli PYQ pattern ke liye **Step 2** me apne purane papers daal do.`,
      ].join("\n"),
      source: "rules",
    };
  }

  if (STRATEGY_RE.test(message) || match === null) {
    const card = strategyCard(topics, input.subject ?? "");
    if (match) card.push("", ...topicCard(match.topic, []));
    card.push(
      "",
      `_Browser AI model abhi loaded nahi hai, isliye ye jawab sirf tumhare syllabus aur papers se bana hai._`,
    );
    return { ok: true, reply: card.join("\n"), source: "rules" };
  }

  return {
    ok: true,
    reply: topicCard(match.topic, (input.pastQuestions ?? []).filter((q) => q.topicId === match.topic.id)).join("\n"),
    source: "rules",
  };
}
