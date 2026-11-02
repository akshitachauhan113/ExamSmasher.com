"use client";

import { useState } from "react";
import type { DetailedSection, NotesLang, NotesResponse, Topic } from "@/lib/types";
import { useNotesLang } from "@/lib/notesLang";
import { BookIcon, CloseIcon, RefreshIcon } from "./Icons";
import { NotesLangToggle } from "./NotesLangToggle";
import { Tex } from "./Tex";

interface TopicNotesProps {
  topic: Topic;
  subject: string;
  /** Short syllabus excerpt so the notes stay inside the course scope. */
  syllabus?: string;
}

const STORAGE_PREFIX = "es-notes-v3";

/**
 * Notes are cached per topic AND per language — Hinglish notes are a
 * different document from English ones, so flipping the toggle shows the
 * other language's saved copy (or an empty panel ready to generate).
 */
function storageKey(topicTitle: string, lang: NotesLang): string {
  const slug = topicTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80);
  return `${STORAGE_PREFIX}|${lang}|${slug}`;
}

function readCache(topicTitle: string, lang: NotesLang): DetailedSection[] | null {
  try {
    const raw = localStorage.getItem(storageKey(topicTitle, lang));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DetailedSection[]>;
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as DetailedSection[]) : null;
  } catch {
    return null;
  }
}

function writeCache(topicTitle: string, lang: NotesLang, value: DetailedSection[]): void {
  try {
    localStorage.setItem(storageKey(topicTitle, lang), JSON.stringify(value));
  } catch {
    /* storage blocked — notes just won't persist */
  }
}

/**
 * Study notes for ONE topic — a single level, the depth you watch the video
 * for. Equations come out typeset notebook-style, not as raw LaTeX.
 *
 * The whole-syllabus document (FullNotesPanel) is for reading the course top
 * to bottom; this is the "explain just this topic" button inside a video card.
 */
export function TopicNotes({ topic, subject, syllabus }: TopicNotesProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [sections, setSections] = useState<DetailedSection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lang] = useNotesLang();

  // Reset cached notes when the panel moves to a different topic — or when
  // the student flips English/Hinglish, which is a different document.
  // (done during render — the recommended React pattern, no effect needed).
  const cacheKey = `${topic.title}\u0000${lang}`;
  if (loadedFor !== cacheKey) {
    setLoadedFor(cacheKey);
    setSections(readCache(topic.title, lang));
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
        body: JSON.stringify({ topic, subject, syllabus, language: lang }),
      });
      const json = (await response.json().catch(() => null)) as NotesResponse | null;
      if (!json?.ok || !json.detailed?.length) {
        setError(json?.error ?? "Could not generate notes.");
      } else {
        setSections(json.detailed);
        writeCache(topic.title, lang, json.detailed);
      }
    } catch {
      setError("Network error — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs font-bold"
        style={{ color: "var(--brand)" }}
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

          <div className="max-h-[520px] overflow-y-auto p-3">
            {loading && (
              <div className="space-y-2">
                <div className="skeleton h-3 w-2/3 rounded" />
                <div className="skeleton h-3 w-full rounded" />
                <div className="skeleton h-3 w-5/6 rounded" />
                <div className="skeleton h-3 w-full rounded" />
                <div className="skeleton h-3 w-3/4 rounded" />
                <p className="pt-1 text-xs text-[var(--muted)]">
                  Notes likh raha hoon — {topic.title}…
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
                <strong>{topic.title}</strong> ke liye detailed notes banenge — concept, formulae
                aur exam tips, sab is topic ke andar hi. Syllabus ke hisaab se.
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
