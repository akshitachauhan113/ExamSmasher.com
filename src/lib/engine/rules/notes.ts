import type {
  DetailedSection,
  Flashcard,
  FullNotesResponse,
  NotesLang,
  NotesResponse,
  NotesSection,
  Topic,
} from "@/lib/types";
import { lines } from "./text";

/**
 * Notes built strictly from the student's own syllabus.
 *
 * No facts are invented and nothing is claimed to be verified: every "key
 * point" below is a syllabus line the student pasted, every "possible
 * question" is a template over those lines, and every "past paper question"
 * is a real question the student's own papers contained. When a model is
 * available (server-side or in the browser) it writes the explanatory prose
 * instead — this builder is the guaranteed fallback, and the UI labels it as
 * rule-engine output so nobody mistakes a restructured syllabus for an AI
 * explanation.
 *
 * The topic builder emits the full 12-element study structure (intro,
 * explanation, definitions, key points, examples, features,
 * advantages/disadvantages, differences, exam questions, short answers,
 * long answers, revision summary) — a section is only skipped when the
 * syllabus genuinely has no material for it, never filled with filler.
 */

const MAX_SECTIONS = 14;
const MAX_PARAGRAPHS = 6;
const MAX_CARDS = 14;
const MAX_BULLETS = 8;

interface Copy {
  scopeHeading: string;
  pointsHeading: string;
  strategyHeading: string;
  scopeIntro: string;
  approach: string;
  cornerHeading: string;
  /* The 12-element structure. */
  explainHeading: string;
  definitionsHeading: string;
  conceptsHeading: string;
  examplesHeading: string;
  featuresHeading: string;
  prosConsHeading: string;
  differencesHeading: string;
  examQuestionsHeading: string;
  shortAnswersHeading: string;
  longAnswersHeading: string;
  revisionHeading: string;
  pastLabel: string;
  possibleLabel: string;
  answerPlan: (cover: string) => string;
}

function copyFor(lang: NotesLang): Copy {
  return lang === "hinglish"
    ? {
        scopeHeading: "Is topic ki shuruwat",
        pointsHeading: "Syllabus ke points",
        strategyHeading: "Exam ke liye kaise padhein",
        scopeIntro:
          "Ye topic syllabus ke hisaab se padhna hai — neeche di har line tumhare apne syllabus se li gayi hai, isliye kuch bhi bahar ka nahi hai.",
        approach:
          "Pehle har term ka matlab apne shabdon me likho, phir in points ko ek saath jodo aur ek do example ke saath practice karo. Do pass me padho: pehla samajhne ke liye, doosra revise karne ke liye.",
        cornerHeading: "Exam corner",
        explainHeading: "Aasan bhasha me samjho",
        definitionsHeading: "Zaroori paribhashaen",
        conceptsHeading: "Main concepts aur key points",
        examplesHeading: "Udaharan",
        featuresHeading: "Important features / characteristics",
        prosConsHeading: "Fayde aur nuksan",
        differencesHeading: "Fark aur comparison",
        examQuestionsHeading: "Important exam ke sawaal",
        shortAnswersHeading: "Exam-ready chhote jawab",
        longAnswersHeading: "Lambe sawaal ke detailed jawab",
        revisionHeading: "Quick revision summary",
        pastLabel: "Past paper ka sawaal",
        possibleLabel: "Sawaal ban sakta hai",
        answerPlan: (cover) => `Answer plan: ${cover} — isko apne 2-3 line me apne shabdon me likho.`,
      }
    : {
        scopeHeading: "Topic introduction",
        pointsHeading: "The syllabus points",
        strategyHeading: "How to study this for the exam",
        scopeIntro:
          "Everything below is taken from the syllabus you pasted — nothing here comes from outside your course.",
        approach:
          "Define each term in your own words first, then link the points together and work one example through end to end. Read it twice: once to understand, once to revise.",
        cornerHeading: "Exam corner",
        explainHeading: "Detailed explanation (easy language)",
        definitionsHeading: "Important definitions",
        conceptsHeading: "Main concepts and key points",
        examplesHeading: "Examples",
        featuresHeading: "Important features or characteristics",
        prosConsHeading: "Advantages and disadvantages",
        differencesHeading: "Differences and comparisons",
        examQuestionsHeading: "Important exam questions",
        shortAnswersHeading: "Exam-ready short answers",
        longAnswersHeading: "Detailed answers for long questions",
        revisionHeading: "Quick revision summary",
        pastLabel: "Past paper question",
        possibleLabel: "Likely question",
        answerPlan: (cover) => `Answer plan: ${cover} — write it out in your own 2-3 lines.`,
      };
}

/** Grabs the syllabus lines that actually belong to this topic. */
export function topicBlock(syllabus: string, topic: Topic): string[] {
  const all = lines(syllabus);
  if (all.length === 0) return [];

  const needle = topic.title.toLowerCase();
  const head = needle.split(/\s+/).slice(0, 4).join(" ");
  const chapter = (topic.chapter ?? "").toLowerCase();

  let start = all.findIndex((line) => {
    const low = line.toLowerCase();
    return low.includes(needle) || (head.length > 6 && low.includes(head));
  });
  if (start === -1 && chapter) {
    const chapterIndex = all.findIndex((line) => line.toLowerCase().includes(chapter));
    if (chapterIndex !== -1) start = chapterIndex;
  }
  if (start === -1) return [];

  const out: string[] = [];
  for (let i = start; i < all.length; i += 1) {
    const line = all[i];
    if (i > start && /^(unit|chapter|module|section|part)\b/i.test(line)) break;
    if (i > start && /^\d{1,3}\s*[.)\-–—]/.test(line) && out.length > 0) break;
    out.push(line);
    if (out.join(" ").length > 1200) break;
  }
  return out;
}

/** Turns the topic's syllabus text into individual, quotable points. */
function pointsFrom(block: string[], topic: Topic): string[] {
  const joined = block
    .join(" ")
    .replace(/^\s*(?:\d{1,3}\s*[.)\-–—]|[Qq]\d{1,3}\s*[.)])\s*/, "")
    .replace(/^(?:unit|chapter|module)\b[^:]*[:\-–—]?\s*/i, "");

  const raw = joined
    .split(/[;\n]|(?<=\.)\s+(?=[A-Z(])/)
    .map((part) => part.replace(/^\s*[:\-–—,]+|[\s,]+$/g, "").trim())
    .filter((part) => part.length > 8);

  const list = raw.length > 0 ? raw : [topic.description || topic.title];
  return list.slice(0, 14);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function firstWords(text: string, max: number): string {
  const words = text.split(/\s+/);
  return words.length <= max ? text : `${words.slice(0, max).join(" ").replace(/[.,;:]$/, "")}…`;
}

const EXAMPLE_RE = /\b(example|e\.g\.|for instance|illustrat|such as)\b/i;
const PROPERTY_RE =
  /\b(propert|properties|type|types|kind|characteristic|nature|classif|criteri|condition|law|principle|law)\w*\b/i;
const PRO_RE = /\b(advantag|merit|benefit|strength|pros|useful|helps|enables)\w*\b/i;
const CON_RE = /\b(disadvantag|demerit|limitation|weakness|cons|drawback|hinders?)\w*\b/i;
const DIFF_RE = /\b(differ|compar|versus|\bvs\b|contrast|distinct)\w*\b/i;
const DEFINITION_RE = /\b(defined as|refers to|denotes|\bmeans\b|is called)\b/i;

export interface TopicNotesRulesInput {
  topic: Topic;
  subject?: string;
  syllabus?: string;
  language?: NotesLang;
  /** Real past questions on this topic — quoted verbatim, never invented. */
  examQuestions?: string[];
}

/**
 * The fallback study-notes writer: the full 12-element structure, assembled
 * from the topic's own syllabus lines and (when the student uploaded papers)
 * its REAL past questions. Sections the syllabus cannot support are left out
 * rather than filled with generic filler.
 */
export function buildTopicNotesRules(input: TopicNotesRulesInput): NotesResponse {
  const { topic } = input;
  const lang: NotesLang = input.language === "hinglish" ? "hinglish" : "english";
  const c = copyFor(lang);
  const block = topicBlock(input.syllabus ?? "", topic);
  const points = pointsFrom(block, topic);

  if (points.length === 0) {
    return {
      ok: false,
      error: "This topic has no syllabus text to build notes from — paste the syllabus first.",
    };
  }

  const past = (input.examQuestions ?? [])
    .map((q) => q.replace(/\s+/g, " ").trim())
    .filter((q) => q.length > 5)
    .slice(0, 6);
  const questions = possibleQuestions(topic, points);

  const where = topic.chapter || input.subject || "your course";
  const coverLine = firstWords(points.slice(0, 4).join("; "), 60);
  const tailLine = points.length > 4 ? firstWords(points.slice(4).join("; "), 60) : "";

  const sections: DetailedSection[] = [];

  /* 1 · introduction — where this topic sits and what it covers. */
  sections.push({
    heading: c.scopeHeading,
    paragraphs: [
      `${c.scopeIntro} "${topic.title}" sits in ${where}, and the syllabus splits it into ${points.length} point${points.length === 1 ? "" : "s"}.`,
      `Covered here: ${coverLine}.${tailLine ? ` Then ${tailLine}.` : ""}`,
    ],
  });

  /* 2 · easy-language walkthrough — the points walked through in syllabus
     order with connective tissue. Honest: it restructures, it does not
     pretend to explain beyond the syllabus. */
  sections.push({
    heading: c.explainHeading,
    paragraphs: chunk(points, 2)
      .slice(0, MAX_PARAGRAPHS / 2)
      .map((group, index) =>
        lang === "hinglish"
          ? `Part ${index + 1}: syllabus pehle kehta hai — ${group[0]}${group[1] ? ` Iske baad isme ye add hota hai — ${group[1]}.` : ""}`
          : `Part ${index + 1}: the syllabus first says — ${group[0]}${group[1] ? ` It then builds on that with — ${group[1]}.` : ""}`,
      ),
  });

  /* 3 · definitions — syllabus terms mapped to the line that defines them. */
  const defPairs: string[] = [];
  const usedForDef = new Set<string>();
  for (const keyword of topic.keywords.slice(0, 8)) {
    const hit = points.find(
      (p) => p.toLowerCase().includes(keyword.toLowerCase()) && !usedForDef.has(p),
    );
    if (hit) {
      usedForDef.add(hit);
      defPairs.push(`"${keyword}" — ${hit}`);
    }
  }
  const defLines = points
    .filter((p) => DEFINITION_RE.test(p) && !usedForDef.has(p))
    .slice(0, 3);
  const definitions = [...defPairs, ...defLines].slice(0, 6);
  if (definitions.length > 0) {
    sections.push({ heading: c.definitionsHeading, paragraphs: definitions });
  }

  /* 4 · main concepts & key points — the canonical syllabus list. */
  sections.push({
    heading: c.conceptsHeading,
    paragraphs: chunk(points, 3)
      .slice(0, MAX_PARAGRAPHS)
      .map((group, index) =>
        group.map((point, i) => `${lang === "hinglish" ? "Point" : "Point"} ${index * 3 + i + 1}. ${point}`).join(" "),
      ),
  });

  /* 5 · examples — only when the syllabus itself points at some. */
  const exampleLines = points.filter((p) => EXAMPLE_RE.test(p)).slice(0, 4);
  if (exampleLines.length > 0) {
    sections.push({ heading: c.examplesHeading, paragraphs: exampleLines });
  }

  /* 6 · features / characteristics — property- and type-shaped lines. */
  const featureLines = points.filter((p) => PROPERTY_RE.test(p)).slice(0, 4);
  if (featureLines.length > 0) {
    sections.push({ heading: c.featuresHeading, paragraphs: featureLines });
  }

  /* 7 · advantages & disadvantages — only when the syllabus says so. */
  const pros = points.filter((p) => PRO_RE.test(p)).slice(0, 3);
  const cons = points.filter((p) => CON_RE.test(p)).slice(0, 3);
  if (pros.length > 0 || cons.length > 0) {
    const paragraphs: string[] = [];
    if (pros.length > 0) {
      paragraphs.push(
        `${lang === "hinglish" ? "Fayde" : "Advantages"}: ${pros.join("; ")}.`,
      );
    }
    if (cons.length > 0) {
      paragraphs.push(
        `${lang === "hinglish" ? "Nuksan / limitations" : "Disadvantages / limitations"}: ${cons.join("; ")}.`,
      );
    }
    sections.push({ heading: c.prosConsHeading, paragraphs });
  }

  /* 8 · differences — only when the syllabus asks to compare things. */
  const diffLines = points.filter((p) => DIFF_RE.test(p)).slice(0, 4);
  if (diffLines.length > 0) {
    sections.push({ heading: c.differencesHeading, paragraphs: diffLines });
  }

  /* 9 · exam questions — REAL past questions first, then syllabus-shaped. */
  sections.push({
    heading: c.examQuestionsHeading,
    paragraphs: [
      ...past.map((q, i) => `${c.pastLabel} ${i + 1}: ${q}`),
      ...questions.map((q, i) => `${c.possibleLabel} ${i + 1}: ${q}`),
    ].slice(0, 6),
  });

  /* 10 · short answers — a2-3 line answer plan per question, each anchored
     to a DIFFERENT slice of the syllabus points so they are not clones. */
  const shortQuestions = [...past.slice(0, 2), ...questions].slice(0, 3);
  if (shortQuestions.length > 0) {
    sections.push({
      heading: c.shortAnswersHeading,
      paragraphs: shortQuestions.map((q, i) => {
        const start = i * 2;
        const cover = firstWords(points.slice(start, start + 3).join("; "), 42) || coverLine;
        return `Q: ${q} — ${c.answerPlan(cover)}`;
      }),
    });
  }

  /* 11 · long answers — a full answer skeleton built from the real points. */
  const longQuestions = [questions[0], past[0] ?? questions[1]]
    .filter((q): q is string => Boolean(q))
    .slice(0, 2);
  if (longQuestions.length > 0) {
    const body = firstWords(points.slice(1, 5).join("; "), 55) || coverLine;
    const keyTerms = topic.keywords.slice(0, 4).join(", ") || topic.title;
    sections.push({
      heading: c.longAnswersHeading,
      paragraphs: longQuestions.map((q) => {
        const opening = firstWords(points[0], 20);
        return lang === "hinglish"
          ? `Q: ${q} — Long answer structure: (1) Opening — "${topic.title}" ko define karo: ${opening}; (2) Body — cover karo: ${body}; (3) Close — key terms ${keyTerms} ke saath sum up karo.`
          : `Q: ${q} — Long answer structure: (1) Opening — define "${topic.title}": ${opening}; (2) Body — cover: ${body}; (3) Close — sum up with the key terms ${keyTerms}.`;
      }),
    });
  }

  /* Study strategy (the old "how to study" content) — kept, just later. */
  sections.push({
    heading: c.strategyHeading,
    paragraphs: [
      c.approach,
      `Weight: ${topic.importance === "core" ? "core — exam me almost pakka aata hai" : topic.importance === "important" ? "important — frequently asked" : "bonus — extra edge"} · Expected level: ${topic.difficulty} · Plan: about ${topic.estimatedMinutes} minutes for a first pass.`,
    ],
  });

  /* 12 · revision summary — the whole topic compressed, always last. */
  sections.push({
    heading: c.revisionHeading,
    paragraphs: [
      points
        .slice(0, 6)
        .map((p) => firstWords(p, 12))
        .join(" · "),
      `${lang === "hinglish" ? "Yaad rakho" : "Remember"}: ${topic.keywords.slice(0, 6).join(", ") || topic.title} · ${topic.chapter || where} · ~${topic.estimatedMinutes} min · ${topic.difficulty}.`,
    ],
  });

  const detailed = sections.slice(0, MAX_SECTIONS);

  const questions5 = questions;
  const notes: NotesSection[] = [
    {
      heading: c.pointsHeading,
      bullets: points.slice(0, MAX_BULLETS),
    },
    {
      heading: c.cornerHeading,
      bullets: [
        `Unit / chapter: ${topic.chapter || "not labelled in the syllabus"}`,
        `Key terms: ${topic.keywords.slice(0, 6).join(", ") || topic.title}`,
        `Priority: ${topic.importance} · Level: ${topic.difficulty} · ~${topic.estimatedMinutes} min`,
        ...past.slice(0, 3),
        questions5[0],
      ].filter(Boolean).slice(0, MAX_BULLETS),
    },
  ];

  const cards: Flashcard[] = [
    {
      q: lang === "hinglish" ? `"${topic.title}" me syllabus ke hisaab se kya kya aata hai?` : `What does the syllabus put under "${topic.title}"?`,
      a: firstWords(points.slice(0, 4).join("; "), 45),
    },
    {
      q: lang === "hinglish" ? `"${topic.title}" kaunsi unit/chapter me hai?` : `Which unit/chapter is "${topic.title}" in?`,
      a: topic.chapter || input.subject || "Not labelled in the syllabus",
    },
    {
      q: lang === "hinglish" ? `"${topic.title}" ke key terms kaun se hain?` : `Which are the key terms in "${topic.title}"?`,
      a: firstWords(topic.keywords.slice(0, 6).join(", ") || topic.title, 30),
    },
    // REAL past questions as recall cards when the student uploaded papers.
    ...past.slice(0, 3).map((q) => ({
      q: `${c.pastLabel}: ${q}`,
      a: c.answerPlan(firstWords(points.slice(0, 3).join("; "), 35)),
    })),
    ...questions.slice(0, 3).map((q) => ({
      q: lang === "hinglish" ? `Sawaal: ${q}` : `Possible question: ${q}`,
      a: c.answerPlan(firstWords(points.slice(0, 3).join(", "), 35)),
    })),
  ].slice(0, MAX_CARDS);

  return { ok: true, detailed, notes, cards, source: "rules" };
}

/** Exam-shaped questions generated from the syllabus wording itself. */
export function possibleQuestions(topic: Topic, points: string[]): string[] {
  const out: string[] = [];
  const title = topic.title;

  out.push(`Explain "${title}" with the key points your syllabus lists.`);
  if (points.length > 1) {
    out.push(`Differentiate between ${shortTerm(points[0])} and ${shortTerm(points[1])}.`);
  }
  if (points.length > 2) {
    out.push(`Write a short note on ${shortTerm(points[2])}.`);
  }
  out.push(`Define ${topic.keywords.slice(0, 3).join(", ") || title} and give one example each.`);
  if (topic.difficulty === "advanced") {
    out.push(`Derive / work through the main result asked for in "${title}".`);
  } else {
    out.push(`List the essential properties of ${shortTerm(title)} and state where each is used.`);
  }
  return out.filter(Boolean).slice(0, 5);
}

function shortTerm(text: string): string {
  const clean = text.split(/[:;,]/)[0].trim();
  return firstWords(clean, 8).replace(/[.]$/, "");
}

/* -------------------------------------------------------------------------- */
/*                          whole-syllabus notes document                       */
/* -------------------------------------------------------------------------- */

export interface FullNotesRulesInput {
  syllabus: string;
  subject: string;
  language?: NotesLang;
  /** Unit/chapter title → its topic lines, so the document can be split. */
  topics: Topic[];
}

/** Groups the raw syllabus lines under their unit/chapter headings. */
function groupSyllabusLines(
  all: string[],
  fallbackHeading: string,
): Array<{ heading: string; body: string[] }> {
  const groups: Array<{ heading: string; body: string[] }> = [];
  let current: { heading: string; body: string[] } | null = null;

  for (const line of all) {
    const isHeading =
      line.length <= 120 &&
      /^(unit|chapter|module|section|part|lesson|paper)\b/i.test(line) &&
      !/^\d{1,3}\s*[.)]/.test(line);
    if (isHeading) {
      current = { heading: line.replace(/[:\-–—]+$/, ""), body: [] };
      groups.push(current);
      continue;
    }
    if (!current) {
      current = { heading: fallbackHeading, body: [] };
      groups.push(current);
    }
    current.body.push(line);
  }
  return groups;
}

function normalizeUnit(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The syllabus lines belonging to ONE unit — used for unit-wise notes so the
 * document (and the model prompt) only ever contains that unit's content.
 * Returns "" when no heading matches; callers must treat that as an error,
 * never as "fall back to the whole syllabus".
 */
export function sliceSyllabusToUnit(syllabus: string, unit: string): string {
  const all = lines(syllabus);
  if (all.length === 0) return "";
  const want = normalizeUnit(unit);
  if (want.length < 3) return "";

  const groups = groupSyllabusLines(all, "");
  const match = groups.find((group) => {
    const heading = normalizeUnit(group.heading);
    if (!heading) return false;
    return heading === want || heading.includes(want) || want.includes(heading);
  });
  if (!match || match.body.length === 0) return "";
  return [match.heading, ...match.body].join("\n");
}

/**
 * One Markdown document covering the whole syllabus (or one pre-sliced
 * unit): every unit, every point, plus an exam corner per unit. Built only
 * from what the student pasted.
 */
export function buildFullNotesRules(input: FullNotesRulesInput): FullNotesResponse {
  const lang: NotesLang = input.language === "hinglish" ? "hinglish" : "english";
  const c = copyFor(lang);
  const all = lines(input.syllabus);

  if (all.length === 0) {
    return { ok: false, error: "Paste a syllabus first — there is nothing to write notes from." };
  }

  const groups = groupSyllabusLines(all, input.subject || "Syllabus");
  const usable = groups.filter((g) => g.body.length > 0);
  const out: string[] = [];

  out.push(`# ${input.subject || "Course"} — study notes`);
  out.push("");
  out.push(
    lang === "hinglish"
      ? `> Ye document sirf tumhare paste kiye hue syllabus se bana hai. Har point wahi hai jo syllabus me likha hai — kuch bhi bahar se add nahi kiya gaya.`
      : `> Built only from the syllabus you pasted. Every point below comes straight from it — nothing has been added from outside your course.`,
  );
  out.push("");

  usable.forEach((group, groupIndex) => {
    out.push(`## ${group.heading}`);
    out.push("");

    const points = pointsFrom(group.body, input.topics[groupIndex] ?? {
      id: "",
      title: group.heading,
      description: "",
      keywords: [],
      importance: "important",
      difficulty: "intermediate",
      estimatedMinutes: 20,
    });

    out.push(`### ${lang === "hinglish" ? "Syllabus ke points" : "What the syllabus asks for"}`);
    out.push("");
    points.forEach((point) => out.push(`- ${point}`));
    out.push("");

    out.push(`### ${c.strategyHeading}`);
    out.push("");
    out.push(c.approach);
    out.push("");
    out.push(
      lang === "hinglish"
        ? `Is unit ke liye approx ${Math.max(15, Math.round(points.length * 8))} minute rakho — pehla pass samajhne ke liye, doosra revision.`
        : `Budget roughly ${Math.max(15, Math.round(points.length * 8))} minutes for this unit — one pass to understand, one to revise.`,
    );
    out.push("");

    out.push(`### ${c.cornerHeading}`);
    points.slice(0, 4).forEach((point) => {
      out.push(`- ${lang === "hinglish" ? "Sawaal ban sakta hai" : "Likely question"}: ${questionFromPoint(point)}`);
    });
    out.push("");
  });

  const markdown = out.join("\n").trim();
  return {
    ok: true,
    markdown,
    sections: usable.length,
    source: "rules",
  };
}

/** Turns one syllabus line into an exam-shaped question, without adding facts. */
function questionFromPoint(point: string): string {
  const clean = point.replace(/\s+/g, " ").trim().replace(/[;,]+$/, "");
  const head = clean.split(/[;:,]/)[0].trim();
  if (/^(explain|describe|define|derive|prove|write|list|compare|differentiate)/i.test(clean)) {
    return firstWords(clean, 22);
  }
  return `Explain ${firstWords(head, 14)} and list the points the syllabus groups with it.`;
}
