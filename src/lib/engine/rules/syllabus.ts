import type { AnalyzeResponse, Difficulty, Importance, Topic } from "@/lib/types";
import { clamp, keywordsFrom, lines, tidy, tokenize, unique } from "./text";

/**
 * Syllabus → units → topics, with no model involved.
 *
 * This is the guaranteed path: it runs in milliseconds, works offline and
 * never needs a key. The browser AI can improve the wording and grouping when
 * it is available, but the structure below is what keeps the site useful on a
 * device that cannot run a model at all.
 *
 * The parser leans on the two shapes syllabi actually come in:
 *   - "Unit-I: Algebra" / "Chapter 3 — Calculus" headings, then numbered or
 *     bulleted points underneath, and
 *   - bare numbered lists ("1. Topic: detail…") with no headings at all.
 */

const MAX_SYLLABUS_CHARS = 24_000;
const DEFAULT_MAX_TOPICS = 14;
const MAX_TOPICS = 20;

/** A line that names a unit/chapter rather than describing one. */
const CHAPTER_RE =
  /^(?:unit|chapter|module|section|part|lesson|paper|unit\s+[ivxlcdm]+)\b/i;

const NUMBERED_RE =
  /^(?:\d{1,3}\s*[.)\-–—]|[Qq]\d{1,3}\s*[.)]|[a-z]\s*[.)]|\([a-z0-9]{1,3}\)|[-•*▪])\s+/;

/**
 * Bigger syllabus → proportionally more topics, so a whole semester does not
 * collapse into five giant catch-alls.
 */
export function autoMaxTopics(syllabus: string): number {
  const headings = (syllabus.match(/\b(unit|chapter|module|paper|lesson|topic)\b/gi) || []).length;
  const byLength = Math.ceil(syllabus.length / 500);
  const byHeadings = Math.ceil(headings * 1.4);
  return Math.min(
    MAX_TOPICS,
    Math.max(6, Math.max(byLength, byHeadings, DEFAULT_MAX_TOPICS - 4)),
  );
}

function isChapterHeading(line: string, next: string | undefined): boolean {
  if (line.length === 0 || line.length > 120) return false;
  if (NUMBERED_RE.test(line) && line.includes(":")) return false;

  // "Unit-I: Relations and Functions", "Chapter 3 — Calculus", "Module 2"
  if (CHAPTER_RE.test(line) && line.split(/\s+/).length <= 14) return true;

  // A short stand-alone label — "Algebra", "Calculus:" — but only when the
  // line after it actually starts a list, otherwise it is just a short point.
  const shortLabel =
    line.length <= 60 &&
    !line.endsWith(".") &&
    (line.endsWith(":") || /^[A-Z][A-Za-z0-9&'()/ -]*$/.test(line)) &&
    line.split(/\s+/).length <= 8;
  if (!shortLabel) return false;
  if (!next) return false;
  return NUMBERED_RE.test(next) || next.length <= 90;
}

/** "1. Matrices: Concept, notation, …" → title "Matrices", rest is detail. */
function splitTitle(text: string): { title: string; detail: string } {
  const cleaned = text.replace(NUMBERED_RE, "").trim();
  if (!cleaned) return { title: text.trim(), detail: "" };

  const colon = cleaned.indexOf(":");
  if (colon > 1 && colon <= 70) {
    const head = cleaned.slice(0, colon).replace(/[-–—,]+$/, "").trim();
    // Only treat the head as a title when it reads like one.
    if (head.split(/\s+/).length <= 10 && !/[.;]$/.test(head)) {
      return { title: head, detail: cleaned.slice(colon + 1).trim() };
    }
  }

  const firstStop = cleaned.search(/[.;]/);
  if (firstStop > 12 && firstStop <= 90) {
    return { title: cleaned.slice(0, firstStop).trim(), detail: cleaned.slice(firstStop + 1).trim() };
  }

  if (cleaned.length <= 70) return { title: cleaned, detail: "" };
  const words = cleaned.split(/\s+/);
  const cut = words.slice(0, 9).join(" ");
  return { title: cut, detail: cleaned };
}

function guessDifficulty(text: string): Difficulty {
  if (/\b(derive|derivation|prove|proof|analy[sz]e|design|implement|optimi[sz]e|algorithm|theorem|integral|differentiat|synthesi|architecture)\b/i.test(text)) {
    return "advanced";
  }
  if (/\b(define|list|identify|state|name|recall|recognis|recogniz|mention|label|enumerate)\b/i.test(text)) {
    return "beginner";
  }
  return "intermediate";
}

function guessImportance(text: string, position: number, total: number): Importance {
  if (/\b(optional|elective|enrichment|credit|supplementary|for reference|beyond scope)\b/i.test(text)) {
    return "bonus";
  }
  if (/\b(must|compulsory|essential|core|important|weightage|high priority)\b/i.test(text) || /\b\d{1,2}\s*marks?\b/i.test(text)) {
    return "core";
  }
  if (total <= 2) return "important";
  const ratio = position / total;
  if (ratio < 0.34) return "core";
  if (ratio < 0.78) return "important";
  return "bonus";
}

function estimateMinutes(text: string): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  return clamp(Math.round((12 + words / 6) / 5) * 5, 10, 90);
}

interface Draft {
  chapter: string;
  title: string;
  detail: string;
}

/** Splits one chapter's body into individual topic lines. */
function splitTopics(body: string[]): string[] {
  const out: string[] = [];
  let current = "";

  for (const line of body) {
    if (!line) {
      if (current) out.push(current);
      current = "";
      continue;
    }
    if (NUMBERED_RE.test(line)) {
      if (current) out.push(current);
      current = line;
    } else if (current) {
      current = `${current} ${line}`;
    } else {
      current = line;
    }
  }
  if (current) out.push(current);

  // No list markers at all — fall back to blank-line paragraphs, then to
  // sentence groups so a prose syllabus still yields several topics.
  if (out.length <= 1) {
    const paragraphs = body.filter((l) => l.length > 0);
    if (paragraphs.length > 1) return paragraphs;
    const text = paragraphs.join(" ");
    const sentences = text.split(/(?<=[.!?;])\s+/).filter((s) => s.trim().length > 12);
    if (sentences.length > 1) {
      const size = Math.max(1, Math.ceil(sentences.length / Math.min(8, sentences.length)));
      const chunks: string[] = [];
      for (let i = 0; i < sentences.length; i += size) {
        chunks.push(sentences.slice(i, i + size).join(" ").trim());
      }
      return chunks.filter(Boolean);
    }
    return out;
  }
  return out;
}

export interface AnalyzeRulesInput {
  syllabus: string;
  subject?: string;
  maxTopics?: number;
}

export function analyzeSyllabusRules(input: AnalyzeRulesInput): AnalyzeResponse {
  const syllabus = tidy(input.syllabus ?? "");
  if (syllabus.length < 20) {
    return {
      ok: false,
      error:
        "Syllabus is too short — paste at least a few lines so topics can be extracted.",
    };
  }
  if (syllabus.length > MAX_SYLLABUS_CHARS) {
    return {
      ok: false,
      error: `Syllabus is too long (${syllabus.length} chars). Keep it under ${MAX_SYLLABUS_CHARS} characters — trim page numbers and instructions.`,
    };
  }

  const maxTopics = clamp(
    Number.isFinite(Number(input.maxTopics)) ? Number(input.maxTopics) : autoMaxTopics(syllabus),
    3,
    MAX_TOPICS,
  );

  const rawLines = lines(syllabus);
  const drafts: Draft[] = [];
  let chapter = "";
  let body: string[] = [];

  const flush = () => {
    if (!body.length) return;
    const chapterLabel = chapter || guessChapter(body);
    for (const piece of splitTopics(body)) {
      const { title, detail } = splitTitle(piece);
      if (title.trim().length < 2) continue;
      drafts.push({ chapter: chapterLabel, title: title.trim(), detail });
    }
    body = [];
  };

  rawLines.forEach((line, index) => {
    if (!line) return;
    if (isChapterHeading(line, rawLines[index + 1])) {
      flush();
      chapter = line.replace(/[:\-–—]+$/, "").trim();
      return;
    }
    body.push(line);
  });
  flush();

  if (drafts.length === 0) {
    return {
      ok: false,
      error:
        "No topics could be extracted. Paste the actual syllabus content (chapter names, unit list) rather than a photo description or a link.",
    };
  }

  const total = drafts.length;
  const topics: Topic[] = drafts
    .map((draft, index) => {
      const text = `${draft.title}. ${draft.detail}`;
      const keywords = keywordsFrom(
        draft.title,
        tokenize(draft.detail).slice(0, 10),
      );
      return {
        id: `t${index + 1}`,
        title: draft.title.slice(0, 120),
        description: draft.detail.slice(0, 400),
        keywords: keywords.length > 0 ? keywords : unique(tokenize(draft.title)).slice(0, 5),
        importance: guessImportance(text, index, total),
        difficulty: guessDifficulty(text),
        estimatedMinutes: estimateMinutes(text),
        chapter: draft.chapter ? draft.chapter.slice(0, 60) : undefined,
      } satisfies Topic;
    })
    .slice(0, 40);

  const subject =
    (input.subject ?? "").trim().slice(0, 80) || guessSubject(syllabus);

  return {
    ok: true,
    subject,
    topics,
    truncated: topics.length >= maxTopics,
    source: "rules",
  };
}

/** When there are no headings, borrow the first line as the grouping label. */
function guessChapter(body: string[]): string {
  const first = body[0] ?? "";
  if (first.length <= 60) return first.replace(/[:\-–—]+$/, "").trim();
  return "";
}

/** Small helper the engine uses when no subject was typed in. */
export function guessSubject(syllabus: string): string {
  const firstLine =
    syllabus
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 2) ?? "Your syllabus";
  return firstLine.replace(/[:\-–—]+$/, "").slice(0, 60) || "Your syllabus";
}
