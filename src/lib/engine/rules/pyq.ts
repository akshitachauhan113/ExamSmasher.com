import { normalizeParsedQuestions, type PaperInput } from "@/lib/exam";
import type { PapersResponse, PyqQuestion, Topic } from "@/lib/types";
import { overlapScore, tidy, tokenize, unique } from "./text";

/**
 * Previous-year papers → structured questions, without a model.
 *
 * Question papers are the most machine-readable input on the site: they are
 * numbered, sectioned and full of "Q4." / "Section B" / "(6 marks)". That is
 * all this parser needs. Anything it cannot read is DROPPED rather than
 * invented — a missing question is honest, a made-up one is not.
 */

const MAX_PAPERS = 6;
const MAX_PAPER_CHARS = 12_000;

const ADMIN_RE =
  /^(?:roll\s*(?:no|number)|enrol|registration|seat\s*no|time\s*allowed|max(?:imum)?\s*marks|total\s*marks|instructions?\s*[:.]|attempt\s+(?:all|any|any\s+\w+)|choose\s+the|note\s*:|students?\s+are|signature|invigilator|page\s*\d|\d+\s*\/\s*\d+)/i;

const SECTION_RE =
  /^(?:section|part)\s+([a-z0-9]{1,3})\b|^([A-Z])\s*[.)]\s*$/i;

const TOP_LEVEL_RE =
  /^(?:q(?:uestion)?\s*)?(\d{1,3})\s*[.)\-–—]\s*/i;

const SUB_PART_RE = /^\(?([a-z])\)?[.)]\s+/i;

const OPTION_RE = /^\(?([a-z])\)?[.)]\s+\S/;

function classify(text: string): PyqQuestion["type"] {
  const words = text.split(/\s+/).length;
  const optionLines = text.split("\n").filter((l) => OPTION_RE.test(l)).length;

  if (/^(?:choose|select|which of the following|assertion\s*[:–-]|true\s*or\s*false)/i.test(text) || optionLines >= 3) {
    return "objective";
  }
  if (/\b(prove|show that|derive that|establish that)\b/i.test(text)) return "proof";
  if (/\b(calculate|find the|solve for|evaluate|determine the value)\b/i.test(text) || /\d\s*(?:=|×|x)\s*\d/.test(text)) {
    return "numerical";
  }
  if (/\b(explain|describe|discuss|illustrate|give an account|elaborate|write an essay)\b/i.test(text) && words > 20) {
    return "long";
  }
  if (words <= 30) return "short";
  return words > 45 ? "long" : "short";
}

function extractMarks(text: string): number | undefined {
  const patterns = [
    /\[(\d{1,3})\s*marks?\]/i,
    /\((\d{1,3})\s*marks?\)/i,
    /\b(\d{1,3})\s*marks?\b/i,
    /\bmarks?\s*[:\-]\s*(\d{1,3})\b/i,
  ];
  for (const re of patterns) {
    const match = re.exec(text);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > 0 && value <= 100) return value;
    }
  }
  return undefined;
}

interface RawQuestion {
  paperId: string;
  number?: string;
  section?: string;
  marks?: number;
  type: PyqQuestion["type"];
  text: string;
}

/** Reads one paper's text into numbered questions. */
export function parsePaperText(paperId: string, rawText: string): RawQuestion[] {
  const text = tidy(rawText);
  if (text.length < 40) return [];

  const sourceLines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim());
  const questions: RawQuestion[] = [];

  let section: string | undefined;
  let number: string | undefined;
  let buffer: string[] = [];
  let sawTopLevel = false;

  const flush = () => {
    if (!number) {
      buffer = [];
      return;
    }
    const body = buffer.join("\n").trim();
    if (body.length >= 6) {
      questions.push({
        paperId,
        number,
        section,
        marks: extractMarks(body),
        type: classify(body),
        text: body,
      });
    }
    buffer = [];
  };

  for (const line of sourceLines) {
    if (!line) continue;
    if (ADMIN_RE.test(line)) continue;

    const sectionMatch = SECTION_RE.exec(line);
    if (sectionMatch && line.length <= 60) {
      flush();
      section = (sectionMatch[1] ?? sectionMatch[2] ?? "").trim() || undefined;
      if (section && !/^section/i.test(section)) section = `Section ${section}`;
      number = undefined;
      continue;
    }

    const topLevel = TOP_LEVEL_RE.exec(line);
    if (topLevel) {
      const digits = topLevel[1];
      // "2023" / "10 marks" at the start of a line is metadata, not a number.
      const rest = line.slice(topLevel[0].length);
      const looksLikeQuestion = rest.length > 3 && !/^(?:marks?|points?)\b/i.test(rest);
      const plausible = Number(digits) <= 60 && looksLikeQuestion;
      if (plausible) {
        sawTopLevel = true;
        flush();
        number = `Q${digits}`;
        buffer = [line.replace(TOP_LEVEL_RE, "").trim()];
        continue;
      }
    }

    // Papers that only use (a) (b) (c) — treat each as its own question.
    if (!sawTopLevel && !number && SUB_PART_RE.test(line) && line.length > 12) {
      flush();
      number = `(${SUB_PART_RE.exec(line)?.[1] ?? ""})`;
      buffer = [line.replace(SUB_PART_RE, "").trim()];
      continue;
    }

    if (number) buffer.push(line);
  }
  flush();

  // No numbering at all — fall back to paragraph blocks so a scanned paper
  // still yields something rather than nothing.
  if (questions.length === 0) {
    const paragraphs = sourceLines
      .filter((l) => l.length > 30 && !ADMIN_RE.test(l))
      .map((l) => l.trim())
      .filter((l, i, arr) => !(i > 0 && arr[i - 1] === l));
    paragraphs.forEach((paragraph, index) => {
      if (paragraph.split(/\s+/).length < 6) return;
      questions.push({
        paperId,
        number: `Q${index + 1}`,
        section,
        marks: extractMarks(paragraph),
        type: classify(paragraph),
        text: paragraph,
      });
    });
  }

  return questions;
}

export interface ParsePapersRulesInput {
  subject?: string;
  papers: Array<{ id?: string; year?: string; label?: string; text?: string }>;
}

export function parsePapersRules(input: ParsePapersRulesInput): PapersResponse {
  const rawPapers = Array.isArray(input.papers) ? input.papers : [];
  if (rawPapers.length === 0) {
    return { ok: false, error: "Send at least one paper with its extracted text." };
  }
  if (rawPapers.length > MAX_PAPERS) {
    return { ok: false, error: `Upload at most ${MAX_PAPERS} papers at a time.` };
  }

  const papers: PaperInput[] = [];
  const parsed: RawQuestion[] = [];

  rawPapers.forEach((raw, index) => {
    const text = typeof raw?.text === "string" ? raw.text.trim() : "";
    if (text.length < 40) return;

    const id = typeof raw.id === "string" && raw.id ? raw.id : `p${index + 1}`;
    const year =
      typeof raw.year === "string" && raw.year.trim()
        ? raw.year.trim().slice(0, 12)
        : `Paper ${index + 1}`;
    const label =
      typeof raw.label === "string" && raw.label.trim()
        ? raw.label.trim().slice(0, 40)
        : "Question paper";

    papers.push({ id, year, label });
    parsed.push(...parsePaperText(id, text.slice(0, MAX_PAPER_CHARS)));
  });

  if (papers.length === 0) {
    return { ok: false, error: "None of the papers had readable text — try clearer photos." };
  }

  const { questions, papers: counted, dropped } = normalizeParsedQuestions(parsed, papers);

  if (questions.length === 0) {
    return {
      ok: false,
      error:
        "No questions could be read from these papers. If they are photos, try a straight-on shot with even lighting — blurry scans read as garbage.",
    };
  }

  return { ok: true, questions, papers: counted, dropped, source: "rules" };
}

/* -------------------------------------------------------------------------- */
/*                       question → syllabus topic mapping                     */
/* -------------------------------------------------------------------------- */

/**
 * Scores each real question against every syllabus topic and keeps the best
 * fit above a floor. Frequency, marks and repetition are computed afterwards
 * from these mappings by `computeSignals`, so every number the student sees is
 * still counted from real papers.
 */
export function mapQuestionsToTopics(
  topics: Topic[],
  questions: PyqQuestion[],
): PyqQuestion[] {
  if (topics.length === 0) return questions;

  const profiles = topics.map((topic) => ({
    id: topic.id,
    titleTerms: tokenize(topic.title),
    keywordTerms: topic.keywords.flatMap((k) => tokenize(k)).slice(0, 24),
    chapterTerms: tokenize(topic.chapter ?? ""),
    bodyTerms: tokenize(topic.description).slice(0, 40),
  }));

  return questions.map((question) => {
    const text = question.text;

    let bestId: string | undefined;
    let bestScore = 0;
    let secondScore = 0;

    for (const profile of profiles) {
      const score =
        overlapScore(text, profile.titleTerms, 3) +
        overlapScore(text, profile.keywordTerms, 2) +
        overlapScore(text, profile.chapterTerms, 2) +
        overlapScore(text, profile.bodyTerms, 1);

      if (score > bestScore) {
        secondScore = bestScore;
        bestScore = score;
        bestId = profile.id;
      } else if (score > secondScore) {
        secondScore = score;
      }
    }

    // A lone incidental word match is not a mapping — require either a solid
    // hit or a clear winner over the runner-up.
    const solid = bestScore >= 2;
    const clearWinner = bestScore >= 1 && bestScore >= secondScore * 1.5;
    if (!solid && !clearWinner) return question;

    return { ...question, topicId: question.topicId ?? bestId };
  });
}

/** Distinct papers in the order they first appear. */
export function distinctPapers(questions: PyqQuestion[]) {
  const map = new Map<string, { id: string; year: string; label: string; questionCount: number }>();
  for (const q of questions) {
    const key = `${q.paperLabel}|${q.paperYear}`;
    const entry = map.get(key) ?? { id: key, year: q.paperYear, label: q.paperLabel, questionCount: 0 };
    entry.questionCount += 1;
    map.set(key, entry);
  }
  return [...map.values()];
}

/** Terms used when a question mentions a topic by name directly. */
export function topicTerms(topic: Topic): string[] {
  return unique([...tokenize(topic.title), ...topic.keywords.flatMap((k) => tokenize(k))]);
}
