import type {
  AnalyzeResponse,
  Difficulty,
  Importance,
  SyllabusAnalysis,
  SyllabusTopicEntry,
  SyllabusUnitEntry,
  Topic,
  UnclearLine,
} from "@/lib/types";
import { keywordsFrom, tidy, tokenize, unique } from "./text";

/**
 * Syllabus → units → topics → subtopics, with no model involved.
 *
 * This is the guaranteed path: it runs in milliseconds, works offline and
 * never needs a key. The parser leans on the two shapes syllabi actually
 * come in:
 *   - "Unit-I: Algebra" / "Chapter 3 — Calculus" headings, then numbered or
 *     bulleted points underneath, and
 *   - bare numbered lists ("1. Topic: detail…") with no headings at all.
 *
 * Phase 4 contract (the honesty rules):
 *   - NOTHING readable is skipped: no topic cap, ever.
 *   - The unit → topic → subtopic hierarchy of the source is preserved.
 *   - Only EXACT duplicates (same line, same unit) are removed — similar
 *     but distinct topics always survive.
 *   - Lines that are too garbled to classify are reported as `unclear`
 *     instead of being guessed at.
 */

const MAX_SYLLABUS_CHARS = 24_000;

/** A line that names a unit/chapter rather than describing one. */
const CHAPTER_RE =
  /^(?:unit|chapter|module|section|part|lesson|paper|unit\s+[ivxlcdm]+)\b/i;

const NUMBERED_RE =
  /^(?:\d{1,3}\s*[.)\-–—]|[Qq]\d{1,3}\s*[.)]|[a-z]\s*[.)]|\([a-z0-9]{1,3}\)|[-•*▪])\s+/;

/** "Subject: Engineering Mathematics" style header lines. */
const SUBJECT_RE = /^(?:subject|subject\s*name|course\s*name)\s*[:\-–—]\s*(.+)$/i;

/** Front-matter lines that are not a subject name. */
const NOT_SUBJECT_RE = /^(?:syllabus|course\s+outline|programme\s+outline|academic\s+year)\b/i;

/**
 * Garbage detector: a line whose letters are a minority of its characters
 * ("|-|_|3# §%") is OCR noise, not syllabus content. Such lines are reported
 * as unclear rather than turned into fake topics.
 */
function looksUnclear(text: string): boolean {
  if (/[�]/.test(text)) return true;
  const chars = text.replace(/\s+/g, "");
  if (chars.length < 8) return false;
  const letters = (chars.match(/[\p{L}]/gu) ?? []).length;
  return letters / chars.length < 0.4;
}

interface BodyLine {
  text: string;
  indent: number;
}

function indentOf(raw: string): number {
  let n = 0;
  for (const ch of raw) {
    if (ch === " ") n += 1;
    else if (ch === "\t") n += 4;
    else break;
  }
  return n;
}

/** Raw lines with their original indentation (hierarchy needs it). */
function rawLines(text: string): BodyLine[] {
  return tidy(text)
    .split(/\r?\n/)
    .map((raw) => ({ text: raw.replace(/[ \t]+/g, " ").trim(), indent: indentOf(raw) }))
    .filter((line) => line.text.length > 0);
}

/** Every word starts with a capital letter — "Question Paper 2022", "Algebra". */
function isTitleCase(line: string): boolean {
  const words = line.split(/\s+/).filter((word) => /\p{L}/u.test(word));
  return words.length > 0 && words.every((word) => /^\p{Lu}/u.test(word));
}

function isChapterHeading(line: string, next: string | undefined): boolean {
  if (line.length === 0 || line.length > 120) return false;
  if (NUMBERED_RE.test(line) && line.includes(":")) return false;

  // "Unit-I: Relations and Functions", "Chapter 3 — Calculus", "Module 2"
  if (CHAPTER_RE.test(line) && line.split(/\s+/).length <= 14) return true;

  // A short stand-alone LABEL — all-caps ("ALGEBRA AND MATRICES"), title
  // case ("Question Paper 2022") or ending in a colon — but only when the
  // line after it actually starts a list. A normal mixed-case sentence
  // ("Group subgroups cyclic groups examples") is content, never a heading.
  const shortLabel =
    line.length <= 60 &&
    !line.endsWith(".") &&
    (line.endsWith(":") ||
      (line === line.toUpperCase() && /\p{L}/u.test(line)) ||
      isTitleCase(line)) &&
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
  const minutes = Math.round((12 + words / 6) / 5) * 5;
  return Math.min(90, Math.max(10, minutes));
}

/** Definition-style lines get a small chip in the Complete Syllabus view. */
function isDefinitionLine(title: string): boolean {
  return (
    /^(?:definition|define)\b/i.test(title) ||
    /\bdefinition of\b/i.test(title) ||
    /\bconcept of\b/i.test(title)
  );
}

/** Stable key so exact duplicates can be spotted without losing meaning. */
function normalizeForDedupe(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

interface Piece {
  text: string;
  /** Deeper-indented list item → belongs under the previous topic. */
  sub: boolean;
}

/**
 * Splits one unit's body into topic pieces, keeping sub-items apart.
 *
 * Indentation drives the hierarchy: a list item deeper than the current
 * topic is a subtopic of it; at the same depth it is a sibling topic. With
 * no indentation at all (typical PDF text) every list item stays a sibling,
 * exactly like the old parser behaved.
 */
function splitTopics(body: BodyLine[]): Piece[] {
  const out: Piece[] = [];
  let topic: Piece | null = null;
  let topicIndent = 0;
  let open: Piece | null = null;

  for (const line of body) {
    if (!line.text) continue;

    if (NUMBERED_RE.test(line.text)) {
      if (topic && line.indent > topicIndent) {
        out.push({ text: line.text, sub: true });
        open = out[out.length - 1];
      } else {
        out.push({ text: line.text, sub: false });
        topic = out[out.length - 1];
        topicIndent = line.indent;
        open = topic;
      }
      continue;
    }

    if (open) {
      open.text = `${open.text} ${line.text}`;
    } else {
      out.push({ text: line.text, sub: false });
      topic = out[out.length - 1];
      topicIndent = line.indent;
      open = topic;
    }
  }

  // No list markers at all — fall back to blank-line paragraphs, then to
  // sentence groups so a prose syllabus still yields several topics.
  const solid = out.filter((piece) => !piece.sub);
  if (solid.length <= 1) {
    const texts = body.map((line) => line.text).filter(Boolean);
    if (texts.length > 1) {
      return texts.map((text) => ({ text, sub: false }));
    }
    const text = texts.join(" ");
    const sentences = text.split(/(?<=[.!?;])\s+/).filter((s) => s.trim().length > 12);
    if (sentences.length > 1) {
      const size = Math.max(1, Math.ceil(sentences.length / Math.min(8, sentences.length)));
      const chunks: string[] = [];
      for (let i = 0; i < sentences.length; i += size) {
        chunks.push(sentences.slice(i, i + size).join(" ").trim());
      }
      return chunks.filter(Boolean).map((chunk) => ({ text: chunk, sub: false }));
    }
  }
  return out;
}

export interface AnalyzeRulesInput {
  syllabus: string;
  subject?: string;
}

/**
 * The complete, uncapped syllabus structure. This is the single source of
 * truth every Phase 4 surface derives from — counts shown on the dashboard,
 * the Complete Syllabus checklist and the priority views all come from here,
 * so they can never disagree with each other.
 */
export function analyzeSyllabusFull(input: AnalyzeRulesInput): SyllabusAnalysis {
  const syllabus = tidy(input.syllabus ?? "");
  if (syllabus.length < 20) {
    return {
      ok: false,
      units: [],
      totalUnits: 0,
      totalTopics: 0,
      totalSubtopics: 0,
      unclearLines: [],
      duplicatesRemoved: 0,
      error:
        "Syllabus is too short — paste at least a few lines so topics can be extracted.",
    };
  }
  if (syllabus.length > MAX_SYLLABUS_CHARS) {
    return {
      ok: false,
      units: [],
      totalUnits: 0,
      totalTopics: 0,
      totalSubtopics: 0,
      unclearLines: [],
      duplicatesRemoved: 0,
      error: `Syllabus is too long (${syllabus.length} chars). Keep it under ${MAX_SYLLABUS_CHARS} characters — trim page numbers and instructions.`,
    };
  }

  const source = rawLines(syllabus);
  const units: SyllabusUnitEntry[] = [];
  const unclearLines: UnclearLine[] = [];
  let duplicatesRemoved = 0;

  let unit: SyllabusUnitEntry | null = null;
  let body: BodyLine[] = [];
  let lastEntry: SyllabusTopicEntry | null = null;
  let seq = 0;

  const nextId = (prefix: string) => {
    seq += 1;
    return `${prefix}${seq}`;
  };

  const startUnit = (label: string) => {
    const clean = label.replace(/[:\-–—]+$/, "").trim().slice(0, 80) || "General";
    const key = normalizeForDedupe(clean);
    const existing = units.find((u) => normalizeForDedupe(u.label) === key);
    if (existing) {
      // Same heading twice (OCR re-read) — merge instead of duplicating.
      duplicatesRemoved += 1;
      unit = existing;
      return;
    }
    unit = { id: nextId("u"), label: clean, topics: [] };
    units.push(unit);
  };

  const flush = () => {
    if (!body.length) return;
    const target: SyllabusUnitEntry = unit ?? (() => {
      const label = guessChapter(body.map((line) => line.text));
      startUnit(label);
      return unit!;
    })();

    for (const piece of splitTopics(body)) {
      const { title, detail } = splitTitle(piece.text);
      if (title.trim().length < 2) continue;
      const cleanTitle = title.trim().slice(0, 120);

      if (piece.sub && lastEntry) {
        const subText = detail ? `${cleanTitle}: ${detail}` : cleanTitle;
        const key = normalizeForDedupe(subText);
        const seen = lastEntry.subtopics.some((s) => normalizeForDedupe(s) === key);
        if (seen) {
          duplicatesRemoved += 1;
        } else {
          lastEntry.subtopics.push(subText.slice(0, 160));
        }
        continue;
      }

      // Exact duplicate topic in the same unit → merge, never re-add.
      const dupKey = normalizeForDedupe(cleanTitle);
      const dup = target.topics.find((t) => normalizeForDedupe(t.title) === dupKey);
      if (dup) {
        duplicatesRemoved += 1;
        if (!dup.detail && detail) dup.detail = detail.slice(0, 400);
        lastEntry = dup;
        continue;
      }

      const entry: SyllabusTopicEntry = {
        id: nextId("k"),
        title: cleanTitle,
        subtopics: [],
      };
      if (detail) entry.detail = detail.slice(0, 400);
      if (isDefinitionLine(cleanTitle)) entry.isDefinition = true;
      target.topics.push(entry);
      lastEntry = entry;
    }
    body = [];
  };

  source.forEach((line, index) => {
    if (looksUnclear(line.text)) {
      unclearLines.push({ unit: unit?.label ?? "Before first unit", text: line.text.slice(0, 160) });
      return;
    }
    // Front matter — a subject header or "Syllabus" cover line is metadata,
    // not a unit or a topic (it would otherwise invent a junk unit).
    if (SUBJECT_RE.test(line.text) || NOT_SUBJECT_RE.test(line.text)) return;
    if (isChapterHeading(line.text, source[index + 1]?.text)) {
      flush();
      lastEntry = null;
      startUnit(line.text);
      return;
    }
    body.push(line);
  });
  flush();

  const totalUnits = units.length;
  const totalTopics = units.reduce((sum, u) => sum + u.topics.length, 0);
  const totalSubtopics = units.reduce(
    (sum, u) => sum + u.topics.reduce((inner, t) => inner + t.subtopics.length, 0),
    0,
  );

  if (totalTopics === 0) {
    return {
      ok: false,
      units: [],
      totalUnits: 0,
      totalTopics: 0,
      totalSubtopics: 0,
      unclearLines,
      duplicatesRemoved,
      error:
        "No topics could be extracted. Paste the actual syllabus content (chapter names, unit list) rather than a photo description or a link.",
    };
  }

  const subject =
    (input.subject ?? "").trim().slice(0, 80) || guessSubject(syllabus);

  return {
    ok: true,
    subject,
    units,
    totalUnits,
    totalTopics,
    totalSubtopics,
    unclearLines,
    duplicatesRemoved,
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
  const lines = syllabus
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  // "Subject: Engineering Mathematics" wins over any heuristic.
  for (const line of lines.slice(0, 15)) {
    const match = SUBJECT_RE.exec(line);
    if (match?.[1]?.trim()) return match[1].trim().slice(0, 60);
  }

  const firstLine =
    lines.find((l) => l.length > 2 && !NOT_SUBJECT_RE.test(l)) ?? "Your syllabus";
  return firstLine.replace(/[:\-–—]+$/, "").slice(0, 60) || "Your syllabus";
}

/**
 * Flattens the full structure into the `Topic[]` the rest of the app speaks,
 * in syllabus order — every topic, none capped, unit label carried on
 * `chapter` so the accordions group exactly like the source did.
 */
export function syllabusToTopics(analysis: SyllabusAnalysis): Topic[] {
  const topics: Topic[] = [];
  let index = 0;

  for (const unit of analysis.units) {
    for (const entry of unit.topics) {
      index += 1;
      const subs = entry.subtopics.join(" · ");
      const description = [entry.detail, subs].filter(Boolean).join("  ").slice(0, 400);
      const text = `${entry.title}. ${entry.detail ?? ""}`;
      const keywords = keywordsFrom(entry.title, tokenize(entry.detail ?? "").slice(0, 10));

      topics.push({
        id: `t${index}`,
        title: entry.title,
        description,
        keywords: keywords.length > 0 ? keywords : unique(tokenize(entry.title)).slice(0, 5),
        importance: guessImportance(text, index, analysis.totalTopics),
        difficulty: guessDifficulty(text),
        estimatedMinutes: estimateMinutes(text),
        chapter: unit.label.slice(0, 60),
      });
    }
  }

  return topics;
}

/**
 * Kept for the engine's `AnalyzeResponse` API: same full parse, flattened.
 * `truncated` is always false now — nothing is capped any more.
 */
export function analyzeSyllabusRules(input: AnalyzeRulesInput): AnalyzeResponse {
  const full = analyzeSyllabusFull(input);
  if (!full.ok) return { ok: false, error: full.error };
  return {
    ok: true,
    subject: full.subject,
    topics: syllabusToTopics(full),
    truncated: false,
    source: "rules",
  };
}
