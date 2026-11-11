import type { DetailedSection, Flashcard, NotesSection } from "@/lib/types";

/**
 * Normalisation for the three notes levels, shared by BOTH writers:
 * the in-browser model (engine/ai.ts) and the server-side model route
 * (/api/notes). Kept free of any model imports so a server route can use it
 * without dragging the browser pipeline into the server bundle.
 *
 * Outputs are always re-normalised before they are shown: a model will
 * happily omit a field or return a novel heading, and a missing paragraph
 * must become a dropped section rather than `undefined` leaking into the UI.
 *
 * Caps are sized for the full 12-section study-notes structure (intro →
 * explanation → definitions → key points → examples → features →
 * advantages/disadvantages → differences → exam questions → short answers →
 * long answers → revision summary) while keeping one topic's stored copy
 * comfortably inside localStorage.
 */

export const asString = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/** detailed sections: one per notes element (12 + headroom). */
const MAX_DETAILED_SECTIONS = 14;
const MAX_PARAGRAPHS = 6;
const MAX_PARAGRAPH_CHARS = 1200;

export function normalizeDetailed(raw: unknown): DetailedSection[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const item = entry as { heading?: unknown; paragraphs?: unknown };
      // Models often echo the section number from the prompt ("1 Topic
      // introduction") — strip it, but keep headings that genuinely start
      // with a digit attached to a word ("2D motion").
      const heading = asString(item?.heading, 120).replace(/^\d{1,2}[\s.·:–-]+\s*/, "");
      const paragraphs = Array.isArray(item?.paragraphs)
        ? (item.paragraphs as unknown[])
            .map((p) => asString(p, MAX_PARAGRAPH_CHARS))
            .filter(Boolean)
            .slice(0, MAX_PARAGRAPHS)
        : [];
      return heading && paragraphs.length > 0 ? { heading, paragraphs } : null;
    })
    .filter((s): s is DetailedSection => s !== null)
    .slice(0, MAX_DETAILED_SECTIONS);
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
    .slice(0, 6);
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
