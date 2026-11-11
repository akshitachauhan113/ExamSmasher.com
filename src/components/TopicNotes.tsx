"use client";

import { useState } from "react";
import { topicNotes } from "@/lib/engine";
import type {
  DetailedSection,
  EngineSource,
  Flashcard,
  NotesLang,
  NotesResponse,
  NotesSection,
  Topic,
} from "@/lib/types";
import { useNotesLang } from "@/lib/notesLang";
import { BookIcon, CloseIcon, RefreshIcon } from "./Icons";
import { NotesLangToggle } from "./NotesLangToggle";
import { Tex } from "./Tex";

interface TopicNotesProps {
  topic: Topic;
  subject: string;
  /** Short syllabus excerpt so the notes stay inside the course scope. */
  syllabus?: string;
  /** Real past questions on this topic — quoted in the notes, never invented. */
  examQuestions?: string[];
  /** Optional controlled open state (the topic action bar drives it). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const STORAGE_PREFIX = "es-notes-v4";

/** Everything one topic's notes contain — all three levels, plus provenance. */
interface SavedNotes {
  detailed: DetailedSection[];
  notes?: NotesSection[];
  cards?: Flashcard[];
  source?: EngineSource;
  via?: "server" | "browser";
}

/**
 * Notes are cached per topic AND per language — Hinglish notes are a
 * different document from English ones, so flipping the toggle shows the
 * other language's saved copy (or an empty panel ready to generate).
 */
function storageKey(topicTitle: string, lang: NotesLang): string {
  const slug = topicTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80);
  return `${STORAGE_PREFIX}|${lang}|${slug}`;
}

function readCache(topicTitle: string, lang: NotesLang): SavedNotes | null {
  try {
    const raw = localStorage.getItem(storageKey(topicTitle, lang));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedNotes>;
    return parsed && Array.isArray(parsed.detailed) && parsed.detailed.length > 0
      ? (parsed as SavedNotes)
      : null;
  } catch {
    return null;
  }
}

function writeCache(topicTitle: string, lang: NotesLang, value: SavedNotes): void {
  try {
    localStorage.setItem(storageKey(topicTitle, lang), JSON.stringify(value));
  } catch {
    /* storage blocked — notes just won't persist across refresh */
  }
}

/**
 * Study notes for ONE topic — the full 12-element structure (intro,
 * explanation, definitions, key points, examples, features, pros/cons,
 * differences, exam questions, short answers, long answers, revision
 * summary), written by the server-side model when a key is configured, by
 * the browser model when it is loaded, or restructured from the syllabus by
 * the rule engine otherwise. The footer always says which one actually
 * wrote it. Equations come out typeset notebook-style, not as raw LaTeX.
 */
export function TopicNotes({
  topic,
  subject,
  syllabus,
  examQuestions,
  open: openProp,
  onOpenChange,
}: TopicNotesProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = (next: boolean) => {
    setInternalOpen(next);
    onOpenChange?.(next);
  };

  const [loading, setLoading] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [bundle, setBundle] = useState<SavedNotes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lang] = useNotesLang();

  // Reset saved notes when the panel moves to a different topic — or when
  // the student flips English/Hinglish, which is a different document.
  // (done during render — the recommended React pattern, no effect needed).
  const cacheKey = `${topic.title}\u0000${lang}`;
  if (loadedFor !== cacheKey) {
    setLoadedFor(cacheKey);
    setBundle(readCache(topic.title, lang));
    setError(null);
  }

  const generate = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const data: NotesResponse = await topicNotes({
        topic,
        subject,
        syllabus,
        language: lang,
        examQuestions,
      });
      if (!data.ok || !data.detailed?.length) {
        setError(data.error ?? "Could not generate notes.");
      } else {
        const next: SavedNotes = {
          detailed: data.detailed,
          notes: data.notes,
          cards: data.cards,
          source: data.source ?? "rules",
          via: data.via,
        };
        setBundle(next);
        writeCache(topic.title, lang, next);
      }
    } catch {
      setError("Could not build notes — try again.");
    } finally {
      setLoading(false);
    }
  };

  const source = bundle?.source ?? null;
  const via = bundle?.via;
  const sections = bundle?.detailed ?? null;

  return (
    <div className="mt-3" id={`topic-notes-${topic.id}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs font-bold"
        style={{ color: "var(--brand)" }}
        aria-expanded={open}
      >
        <BookIcon width={14} height={14} />
        {open ? "Hide notes" : "📒 Notes for this topic"}
        {sections && <span className="font-medium text-[var(--muted)]">(saved)</span>}
      </button>

      {open && (
        <div
          className="mt-2 overflow-hidden rounded-xl border"
          style={{ borderColor: "var(--line)", background: "var(--surface-2)" }}
        >
          <div
            className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2"
            style={{ borderColor: "var(--line)" }}
          >
            <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-[var(--muted)]">
              {topic.title}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <NotesLangToggle />
              <button
                type="button"
                onClick={() => void generate()}
                disabled={loading}
                className="flex items-center gap-1 text-[0.7rem] font-bold text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-50"
                title={sections ? "Regenerate notes" : "Generate notes"}
              >
                <RefreshIcon width={12} height={12} />
                {loading ? "Working…" : sections ? "Regenerate" : "Generate"}
              </button>
            </div>
          </div>

          <div className="max-h-[560px] overflow-y-auto p-3">
            {loading && (
              <div className="space-y-2">
                <div className="skeleton h-3 w-2/3 rounded" />
                <div className="skeleton h-3 w-full rounded" />
                <div className="skeleton h-3 w-5/6 rounded" />
                <div className="skeleton h-3 w-full rounded" />
                <div className="skeleton h-3 w-3/4 rounded" />
                <p className="pt-1 text-xs text-[var(--muted)]">
                  Notes likh raha hoon — {topic.title} (intro se revision summary tak, 12 sections)…
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

            {!sections && !loading && !error && (
              <p className="text-xs leading-relaxed text-[var(--muted)]">
                <strong>{topic.title}</strong> ke liye detailed notes banenge — intro, easy
                explanation, definitions, key points, examples, exam questions, chhote aur lambe
                jawab, aur revision summary, sab is topic ke andar hi. Tumhare syllabus + asli PYQ
                se.
              </p>
            )}

            {sections && !loading && (
              <div className="space-y-4">
                {sections.map((section, i) => (
                  <section key={i}>
                    <h4
                      className="mb-1.5 text-[0.8rem] font-extrabold uppercase tracking-wide"
                      style={{ color: "var(--brand)" }}
                    >
                      {section.heading}
                    </h4>
                    <div className="space-y-2">
                      {section.paragraphs.map((paragraph, j) => (
                        <p key={j} className="text-[0.85rem] leading-relaxed">
                          <Tex text={paragraph} />
                        </p>
                      ))}
                    </div>
                  </section>
                ))}

                {bundle?.notes && bundle.notes.length > 0 && (
                  <section>
                    <h4
                      className="mb-1.5 text-[0.8rem] font-extrabold uppercase tracking-wide"
                      style={{ color: "var(--brand)" }}
                    >
                      ⚡ Fast revision bullets
                    </h4>
                    <div className="space-y-4">
                      {bundle.notes.map((section, i) => (
                        <div key={i}>
                          <p className="mb-1 text-[0.75rem] font-bold text-[var(--muted)]">
                            {section.heading}
                          </p>
                          <ul className="space-y-1">
                            {section.bullets.map((bullet, j) => (
                              <li
                                key={j}
                                className="flex gap-2 text-[0.85rem] leading-relaxed"
                              >
                                <span style={{ color: "var(--brand)" }}>•</span>
                                <span>
                                  <Tex text={bullet} />
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {bundle?.cards && bundle.cards.length > 0 && (
                  <section>
                    <h4
                      className="mb-1.5 text-[0.8rem] font-extrabold uppercase tracking-wide"
                      style={{ color: "var(--brand)" }}
                    >
                      🃏 Flashcards — khud ko test karo
                    </h4>
                    <div className="space-y-1.5">
                      {bundle.cards.map((card, i) => (
                        <details
                          key={i}
                          className="rounded-lg border px-2.5 py-1.5"
                          style={{ borderColor: "var(--line)", background: "var(--surface)" }}
                        >
                          <summary className="cursor-pointer text-[0.8rem] font-semibold">
                            {card.q}
                          </summary>
                          <p className="mt-1 text-[0.8rem] leading-relaxed text-[var(--muted)]">
                            <Tex text={card.a} />
                          </p>
                        </details>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}

            {sections && !loading && (
              <p
                className="mt-4 border-t pt-2 text-[0.68rem] leading-relaxed text-[var(--muted)]"
                style={{ borderColor: "var(--line)" }}
                title={
                  via === "server"
                    ? "Written by the site's server-side model — the API key never reaches your browser"
                    : source === "ai"
                      ? "Generated by the model running locally in this browser"
                      : "Built deterministically from the syllabus you pasted"
                }
              >
                {via === "server"
                  ? "🧠 AI notes — site ke server par likha gaya (key browser me nahi aayi), sirf tumhare syllabus + PYQ se."
                  : source === "ai"
                    ? "🧠 Browser AI model se likha gaya — sirf tumhare syllabus se, is device par."
                    : "📄 Rule engine se bana — tumhare syllabus ke har line se, bina kisi model ke. Explanations limited hain kyunki koi model available nahi tha."}
              </p>
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
