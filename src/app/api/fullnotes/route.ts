import { generateText, getLlmConfig } from "@/lib/llm";
import { buildFullNotesPrompt } from "@/lib/prompts";

const MAX_SYLLABUS_CHARS = 24_000;
const MAX_SECTIONS = 6;
/** Below this a single response will fit — no need to split the work up. */
const SPLIT_THRESHOLD = 4_500;

interface FullNotesResponse {
  ok: boolean;
  markdown?: string;
  sections?: number;
  error?: string;
}

/**
 * Whole-syllabus detailed notes, the way a long chat answer reads: one
 * continuous document you can read top to bottom and download.
 *
 * A full syllabus will not fit in one model response, so it is sliced on unit
 * boundaries and each slice is written in parallel, then stitched together.
 * The slices are labelled with their index so the result reads as one document
 * rather than N documents that each claim to start at the beginning.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    syllabus?: unknown;
    subject?: unknown;
    language?: unknown;
  } | null;

  const syllabus =
    typeof body?.syllabus === "string" ? body.syllabus.trim() : "";
  if (syllabus.length < 40) {
    return Response.json(
      {
        ok: false,
        error:
          "Thoda syllabus toh chahiye — kam se kam kuch lines daalo taaki notes ban sakoon.",
      },
      { status: 400 },
    );
  }
  if (syllabus.length > MAX_SYLLABUS_CHARS) {
    return Response.json(
      {
        ok: false,
        error: `Syllabus bahut lamba hai (${syllabus.length} chars). 24,000 tak kaat ke daalo.`,
      },
      { status: 400 },
    );
  }

  const config = getLlmConfig();
  if (!config) {
    return Response.json(
      {
        ok: false,
        error: "Full notes ke liye AI key chahiye — “API Keys” se GEMINI_API_KEY daalo.",
      },
      { status: 503 },
    );
  }

  const subject =
    typeof body?.subject === "string" && body.subject.trim()
      ? body.subject.trim().slice(0, 80)
      : "this course";

  const sections = splitSyllabus(syllabus);
  const language = body?.language === "hinglish" ? ("hinglish" as const) : ("english" as const);

  try {
    const parts = await mapWithConcurrency(sections, 3, (section, index) =>
      writeSection(subject, section.text, section.label, index + 1, sections.length, language),
    );

    // Each part opens with its own heading (the prompt requires one), so parts
    // only need a visible rule between them — inserting another title would
    // duplicate what the model already wrote.
    const markdown = parts
      .join("\n\n---\n\n")
      .replace(/\n{4,}/g, "\n\n\n")
      .trim();

    if (!markdown) {
      return Response.json(
        { ok: false, error: "Notes khali aa gaye — ek baar dobara try karo." },
        { status: 502 },
      );
    }

    const response: FullNotesResponse = {
      ok: true,
      markdown,
      sections: sections.length,
    };
    return Response.json(response);
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Notes banate waqt dikkat aa gayi.",
      },
      { status: 502 },
    );
  }
}

async function writeSection(
  subject: string,
  text: string,
  label: string | undefined,
  index: number,
  total: number,
  language: "english" | "hinglish",
): Promise<string> {
  const { system, prompt } = buildFullNotesPrompt({
    subject,
    section: text,
    sectionIndex: index,
    totalSections: total,
    sectionLabel: label,
    language,
  });

  const out = await generateText(prompt, {
    system,
    temperature: 0.3,
    maxOutputTokens: 8192,
    timeoutMs: 120_000,
  });
  return out.trim();
}

/* -------------------------------------------------------------------------- */

interface Slice {
  text: string;
  label?: string;
}

/** Headings a syllabus is realistically written with. */
const HEADING_PATTERNS: RegExp[] = [
  /^#{1,6}\s+(.+)/,
  /^\s*(unit|chapter|module|paper|lesson|part|section|topic|block)\s+([ivxlcdm]+|\d+)\b\s*[:.\-–—]*\s*(.*)/i,
  /^\s*(unit|chapter|module|paper|lesson|part)\s*[:.\-–—]\s*(.+)/i,
  /^\s*\d+(\.\d+)*\s+[A-Z][^.]{3,60}$/,
];

function matchHeading(line: string): string | null {
  for (const pattern of HEADING_PATTERNS) {
    const m = pattern.exec(line);
    if (m) return m.slice(1).filter(Boolean).join(" ").trim().slice(0, 70);
  }
  return null;
}

/**
 * Cuts a syllabus into slices that a single response can actually cover.
 *
 * Unit/chapter headings are preferred — a cut mid-unit produces notes that
 * lose their structure. When there are no headings at all, it falls back to
 * even length-based slices so a wall of text still gets written.
 */
function splitSyllabus(syllabus: string): Slice[] {
  const lines = syllabus.split(/\r?\n/);

  const buckets: Array<{ label?: string; lines: string[] }> = [];
  let current: { label?: string; lines: string[] } = { lines: [] };

  for (const line of lines) {
    const label = matchHeading(line);
    if (label && current.lines.some((l) => l.trim().length > 0)) {
      buckets.push(current);
      current = { label, lines: [line] };
    } else {
      if (current.lines.length === 0 && !current.label && label) {
        current.label = label;
      }
      current.lines.push(line);
    }
  }
  if (current.lines.some((l) => l.trim().length > 0)) buckets.push(current);

  const meaningful = buckets.filter((b) => b.lines.join(" ").trim().length > 120);

  // No usable headings, or everything collapsed into one giant bucket.
  if (meaningful.length <= 1) {
    return byLength(syllabus);
  }

  // Merge tiny fragments into their neighbour so we never spend a whole
  // model call on four lines of "Note: ..." .
  const merged: Array<{ label?: string; text: string }> = [];
  for (const bucket of meaningful) {
    const text = bucket.lines.join("\n").trim();
    const prev = merged[merged.length - 1];
    if (prev && stripLength(prev.text) + stripLength(text) < SPLIT_THRESHOLD) {
      prev.text = `${prev.text}\n\n${text}`;
      continue;
    }
    merged.push({ label: bucket.label, text });
  }

  if (merged.length === 1) return byLength(syllabus);

  // Too many units for one document at a time — fold adjacent ones together
  // rather than silently dropping syllabus content.
  if (merged.length > MAX_SECTIONS) return foldToMax(merged);

  return merged;
}

function foldToMax(
  items: Array<{ label?: string; text: string }>,
): Slice[] {
  const per = Math.ceil(items.length / MAX_SECTIONS);
  const out: Slice[] = [];
  for (let i = 0; i < items.length; i += per) {
    const group = items.slice(i, i + per);
    out.push({
      label: group.map((g) => g.label).filter(Boolean).join(" + ") || undefined,
      text: group.map((g) => g.text).join("\n\n"),
    });
  }
  return out;
}

/** Length-based fallback for heading-less syllabi. */
function byLength(text: string): Slice[] {
  const clean = text.trim();
  if (clean.length <= SPLIT_THRESHOLD) return [{ text: clean }];

  const count = Math.min(MAX_SECTIONS, Math.ceil(clean.length / SPLIT_THRESHOLD));
  const per = Math.ceil(clean.length / count);
  const slices: Slice[] = [];

  for (let i = 0; i < count; i++) {
    // Cut on a paragraph/line boundary, never mid-word.
    let start = i * per;
    if (i > 0) {
      const newline = clean.lastIndexOf("\n", start);
      if (newline > start - 400) start = newline + 1;
    }
    const end = i === count - 1 ? clean.length : (i + 1) * per;
    const chunk = clean.slice(start, end).trim();
    if (chunk) slices.push({ text: chunk });
  }

  return slices.length > 0 ? slices : [{ text: clean }];
}

function stripLength(text: string): number {
  return text.replace(/\s+/g, " ").length;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await fn(items[index] as T, index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}
