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
 * point" below is a syllabus line the student pasted, and every "possible
 * question" is a template over those lines. When the browser model is running
 * it writes the explanatory prose instead — this is what keeps the panel
 * useful on a device that cannot load a model.
 */

const MAX_SECTIONS = 6;
const MAX_PARAGRAPHS = 4;
const MAX_CARDS = 12;
const MAX_BULLETS = 8;

interface Copy {
  scopeHeading: string;
  pointsHeading: string;
  strategyHeading: string;
  scopeIntro: string;
  approach: string;
  cornerHeading: string;
}

function copyFor(lang: NotesLang): Copy {
  return lang === "hinglish"
    ? {
        scopeHeading: "Is topic me kya hai",
        pointsHeading: "Syllabus ke points",
        strategyHeading: "Exam ke liye kaise padhein",
        scopeIntro:
          "Ye topic syllabus ke hisaab se padhna hai — neeche di har line tumhare apne syllabus se li gayi hai, isliye kuch bhi bahar ka nahi hai.",
        approach:
          "Pehle har term ka matlab apne shabdon me likho, phir in points ko ek saath jodo aur ek do example ke saath practice karo. Do pass me padho: pehla samajhne ke liye, doosra revise karne ke liye.",
        cornerHeading: "Exam corner",
      }
    : {
        scopeHeading: "What this topic covers",
        pointsHeading: "The syllabus points",
        strategyHeading: "How to study this for the exam",
        scopeIntro:
          "Everything below is taken from the syllabus you pasted — nothing here comes from outside your course.",
        approach:
          "Define each term in your own words first, then link the points together and work one example through end to end. Read it twice: once to understand, once to revise.",
        cornerHeading: "Exam corner",
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

export interface TopicNotesRulesInput {
  topic: Topic;
  subject?: string;
  syllabus?: string;
  language?: NotesLang;
}

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

  const where = topic.chapter ? `${topic.chapter}` : input.subject || "your course";
  const scopeLines = points.slice(0, Math.min(5, points.length));
  const restLines = points.slice(5);

  const detailed: DetailedSection[] = [
    {
      heading: c.scopeHeading,
      paragraphs: [
        `${c.scopeIntro} "${topic.title}" sits in ${where}, and the syllabus splits it into ${points.length} point${points.length === 1 ? "" : "s"}.`,
        `Covered here: ${firstWords(scopeLines.join("; "), 60)}.${restLines.length ? ` Then ${firstWords(restLines.join("; "), 60)}.` : ""}`,
      ],
    },
    {
      heading: c.pointsHeading,
      paragraphs: chunk(points, 3).slice(0, MAX_PARAGRAPHS).map((group, index) => {
        const label = lang === "hinglish" ? "Point" : "Point";
        return group.map((point, i) => `${label} ${index * 3 + i + 1}. ${point}`).join(" ");
      }),
    },
    {
      heading: c.strategyHeading,
      paragraphs: [
        c.approach,
        `Weight: ${topic.importance === "core" ? "core — exam me almost pakka aata hai" : topic.importance === "important" ? "important — frequently asked" : "bonus — extra edge"} · Expected level: ${topic.difficulty} · Plan: about ${topic.estimatedMinutes} minutes for a first pass.`,
      ],
    },
  ].slice(0, MAX_SECTIONS);

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
        possibleQuestions(topic, points)[0],
      ],
    },
  ];

  const questions = possibleQuestions(topic, points);
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
    ...questions.slice(0, 3).map((q) => ({
      q: lang === "hinglish" ? `Sawaal: ${q}` : `Possible question: ${q}`,
      a:
        lang === "hinglish"
          ? `Answer plan: ${firstWords(points.slice(0, 3).join(", "), 35)} — inko apne shabdon me likho.`
          : `Answer plan: cover ${firstWords(points.slice(0, 3).join(", "), 35)} — in your own words.`,
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

/**
 * One Markdown document covering the whole syllabus: every unit, every point,
 * plus an exam corner per unit. Built only from what the student pasted.
 */
export function buildFullNotesRules(input: FullNotesRulesInput): FullNotesResponse {
  const lang: NotesLang = input.language === "hinglish" ? "hinglish" : "english";
  const c = copyFor(lang);
  const all = lines(input.syllabus);

  if (all.length === 0) {
    return { ok: false, error: "Paste a syllabus first — there is nothing to write notes from." };
  }

  // Group the raw syllabus lines under their headings.
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
      current = { heading: input.subject || "Syllabus", body: [] };
      groups.push(current);
    }
    current.body.push(line);
  }

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
