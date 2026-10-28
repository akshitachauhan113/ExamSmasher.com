"use client";

import { useState } from "react";
import type { Flashcard, NotesResponse, NotesSection, Topic } from "@/lib/types";
import { BookIcon, CloseIcon, RefreshIcon } from "./Icons";

interface TopicNotesProps {
  topic: Topic;
  subject: string;
  /** Short syllabus excerpt so the notes stay inside the course scope. */
  syllabus?: string;
}

type Tab = "notes" | "cards";

const STORAGE_PREFIX = "es-notes-v1";

function storageKey(topicTitle: string): string {
  return `${STORAGE_PREFIX}|${topicTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80)}`;
}

interface CachedNotes {
  notes: NotesSection[];
  cards: Flashcard[];
}

function readCache(topicTitle: string): CachedNotes | null {
  try {
    const raw = localStorage.getItem(storageKey(topicTitle));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedNotes;
    if (!Array.isArray(parsed?.notes) || parsed.notes.length === 0) return null;
    return { notes: parsed.notes, cards: Array.isArray(parsed.cards) ? parsed.cards : [] };
  } catch {
    return null;
  }
}

function writeCache(topicTitle: string, value: CachedNotes): void {
  try {
    localStorage.setItem(storageKey(topicTitle), JSON.stringify(value));
  } catch {
    /* storage blocked — notes just won't persist */
  }
}

/**
 * Per-topic study material: dense bullet notes + flip flashcards,
 * generated from the student's own syllabus and cached in localStorage.
 */
export function TopicNotes({ topic, subject, syllabus }: TopicNotesProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("notes");
  const [loading, setLoading] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [data, setData] = useState<CachedNotes | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Card-flip state.
  const [cardIndex, setCardIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [known, setKnown] = useState<Set<number>>(new Set());

  // Reset cached notes when the panel moves to a different topic
  // (done during render — the recommended React pattern, no effect needed).
  if (loadedFor !== topic.title) {
    setLoadedFor(topic.title);
    setData(readCache(topic.title));
    setCardIndex(0);
    setRevealed(false);
    setKnown(new Set());
    setError(null);
  }

  const generate = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, subject, syllabus }),
      });
      const json = (await response.json().catch(() => null)) as NotesResponse | null;
      if (!json?.ok || !json.notes) {
        setError(json?.error ?? "Could not generate notes.");
      } else {
        const value: CachedNotes = { notes: json.notes, cards: json.cards ?? [] };
        setData(value);
        writeCache(topic.title, value);
        setCardIndex(0);
        setRevealed(false);
        setKnown(new Set());
      }
    } catch {
      setError("Network error — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const toggleCard = () => setRevealed((r) => !r);

  const nextCard = () => {
    if (!data?.cards.length) return;
    setRevealed(false);
    setCardIndex((i) => (i + 1) % data.cards.length);
  };

  const prevCard = () => {
    if (!data?.cards.length) return;
    setRevealed(false);
    setCardIndex((i) => (i - 1 + data.cards.length) % data.cards.length);
  };

  const markKnown = () => {
    setKnown((prev) => {
      const next = new Set(prev);
      if (next.has(cardIndex)) next.delete(cardIndex);
      else next.add(cardIndex);
      return next;
    });
  };

  const card = data?.cards[cardIndex];

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs font-bold"
        style={{ color: "var(--brand)" }}
      >
        <BookIcon width={14} height={14} />
        {open ? "Hide notes & flashcards" : "Notes & flashcards"}
        {data && <span className="font-medium text-[var(--muted)]">(saved)</span>}
      </button>

      {open && (
        <div
          className="mt-2 overflow-hidden rounded-xl border"
          style={{ borderColor: "var(--line)", background: "var(--surface-2)" }}
        >
          {/* Tabs / actions */}
          <div
            className="flex items-center justify-between gap-2 border-b px-3 py-2"
            style={{ borderColor: "var(--line)" }}
          >
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setTab("notes")}
                className="rounded-lg px-2.5 py-1 text-xs font-bold transition-colors"
                style={{
                  background: tab === "notes" ? "var(--brand)" : "transparent",
                  color: tab === "notes" ? "var(--brand-contrast, #fff)" : "var(--muted)",
                }}
              >
                📝 Notes
              </button>
              <button
                type="button"
                onClick={() => setTab("cards")}
                className="rounded-lg px-2.5 py-1 text-xs font-bold transition-colors"
                style={{
                  background: tab === "cards" ? "var(--brand)" : "transparent",
                  color: tab === "cards" ? "var(--brand-contrast, #fff)" : "var(--muted)",
                  opacity: data && data.cards.length === 0 ? 0.45 : 1,
                }}
              >
                🃏 Flashcards{data ? ` (${data.cards.length})` : ""}
              </button>
            </div>
            <button
              type="button"
              onClick={() => void generate()}
              disabled={loading}
              className="flex items-center gap-1 text-[0.7rem] font-bold text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50"
              title={data ? "Regenerate" : "Generate"}
            >
              <RefreshIcon width={12} height={12} />
              {loading ? "Working…" : data ? "Regenerate" : "Generate"}
            </button>
          </div>

          <div className="max-h-[440px] overflow-y-auto p-3">
            {loading && (
              <div className="space-y-2">
                <div className="skeleton h-3 w-2/3 rounded" />
                <div className="skeleton h-3 w-full rounded" />
                <div className="skeleton h-3 w-5/6 rounded" />
                <div className="skeleton h-3 w-3/4 rounded" />
                <p className="pt-1 text-xs text-[var(--muted)]">
                  Writing {topic.title} notes from your syllabus…
                </p>
              </div>
            )}

            {error && !loading && (
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs" style={{ color: "var(--bad)" }}>
                  {error}
                </p>
                <button
                  type="button"
                  onClick={() => void generate()}
                  className="shrink-0 text-xs font-bold"
                  style={{ color: "var(--brand)" }}
                >
                  Retry
                </button>
              </div>
            )}

            {!data && !loading && !error && (
              <p className="text-xs leading-relaxed text-[var(--muted)]">
                Generate AI notes for <strong>{topic.title}</strong> — short, dense bullet points
                pulled from your syllabus, plus flashcards to test yourself.
              </p>
            )}

            {data && !loading && tab === "notes" && (
              <div className="space-y-4">
                {data.notes.map((section, i) => (
                  <section key={i}>
                    <h4
                      className="mb-1.5 text-[0.8rem] font-extrabold uppercase tracking-wide"
                      style={{ color: "var(--brand)" }}
                    >
                      {section.heading}
                    </h4>
                    <ul className="space-y-1.5">
                      {section.bullets.map((bullet, j) => (
                        <li key={j} className="flex gap-2 text-[0.82rem] leading-relaxed">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                          <span>{bullet}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}

            {data && !loading && tab === "cards" && (
              <div>
                {data.cards.length === 0 ? (
                  <p className="text-xs text-[var(--muted)]">
                    No flashcards were generated — hit Regenerate.
                  </p>
                ) : (
                  <div>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={toggleCard}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleCard();
                        }
                      }}
                      className="grid min-h-[120px] cursor-pointer place-items-center rounded-xl border p-4 text-center transition-all"
                      style={{
                        borderColor: known.has(cardIndex)
                          ? "color-mix(in srgb, var(--good) 60%, var(--line))"
                          : "var(--line)",
                        background: "var(--surface)",
                      }}
                      title="Click to flip"
                    >
                      <div>
                        <p className="text-[0.8rem] font-bold leading-relaxed">
                          {revealed ? card?.a : card?.q}
                        </p>
                        <p className="mt-2 text-[0.68rem] text-[var(--muted)]">
                          {revealed ? "Answer" : "Question"} · click to flip
                        </p>
                      </div>
                    </div>

                    <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                      <button
                        type="button"
                        onClick={prevCard}
                        className="btn-ghost px-2 py-1"
                        aria-label="Previous card"
                      >
                        ← Prev
                      </button>
                      <span className="text-[var(--muted)]">
                        {cardIndex + 1} / {data.cards.length}
                        {known.size > 0 ? ` · ${known.size} known` : ""}
                      </span>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={markKnown}
                          className="rounded-lg px-2 py-1 font-bold"
                          style={{
                            color: known.has(cardIndex) ? "var(--good)" : "var(--muted)",
                          }}
                        >
                          {known.has(cardIndex) ? "✓ Known" : "Mark known"}
                        </button>
                        <button
                          type="button"
                          onClick={nextCard}
                          className="btn-ghost px-2 py-1"
                          aria-label="Next card"
                        >
                          Next →
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {open && (
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="mt-1 flex items-center gap-1 text-[0.7rem] text-[var(--muted)] hover:text-[var(--text)]"
        >
          <CloseIcon width={10} height={10} /> close
        </button>
      )}
    </div>
  );
}
