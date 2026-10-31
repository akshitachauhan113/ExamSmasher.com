"use client";

import { useState } from "react";
import { downloadFile } from "@/lib/exporters";
import { renderMarkdown } from "@/lib/markdown";
import { AlertIcon, BookIcon, CopyIcon, DownloadIcon } from "./Icons";

interface FullNotesProps {
  syllabus: string;
  subject: string;
}

interface FullNotesResponse {
  ok: boolean;
  markdown?: string;
  sections?: number;
  error?: string;
}

/**
 * Whole-syllabus notes in one go — read it top to bottom like a textbook
 * chapter, rather than clicking into topic after topic.
 *
 * Long syllabi are stitched from several model calls server-side, so the
 * response is one continuous Markdown document that can be read here or
 * downloaded and carried around.
 */
export function FullNotesPanel({ syllabus, subject }: FullNotesProps) {
  const [open, setOpen] = useState(false);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    if (loading) return;
    setOpen(true);
    if (markdown) return;

    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/fullnotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ syllabus, subject }),
      });
      const data: FullNotesResponse = await response.json();
      if (!data.ok || !data.markdown) {
        throw new Error(data.error || "Notes nahi ban paaye.");
      }
      setMarkdown(data.markdown);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Notes banate waqt dikkat aa gayi.");
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!markdown) return;
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Copy nahi hua — Download use kar lo.");
    }
  };

  return (
    <section className="card mt-6">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[1.05rem] font-extrabold">
            📖 Poore syllabus ke detailed notes
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">
            Ek click me pura syllabus — concept samajh aaye aise detail me, har section ke end me
            <em> “Exam corner”</em> ke saath. Neeche se padho, ya download kar le.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void generate()}
            disabled={loading}
            className="btn-primary flex items-center gap-1.5 px-3.5 py-2 text-xs disabled:opacity-60"
          >
            {loading ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Likha ja raha hai…
              </>
            ) : markdown ? (
              <>
                <BookIcon width={14} height={14} /> Dobara banao
              </>
            ) : (
              <>
                <BookIcon width={14} height={14} /> Notes banao
              </>
            )}
          </button>

          {markdown && !loading && (
            <>
              <button
                type="button"
                onClick={() =>
                  downloadFile(
                    `${subject.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "syllabus"}-notes.md`,
                    markdown,
                    "text/markdown",
                  )
                }
                className="btn-ghost flex items-center gap-1 px-2.5 py-2 text-xs"
                aria-label="Download notes as Markdown"
              >
                <DownloadIcon width={13} height={13} /> Download
              </button>
              <button
                type="button"
                onClick={() => void copy()}
                className="btn-ghost flex items-center gap-1 px-2.5 py-2 text-xs"
                aria-label="Copy notes"
              >
                <CopyIcon width={13} height={13} /> {copied ? "Ho gaya ✓" : "Copy"}
              </button>
            </>
          )}
        </div>
      </header>

      {open && (
        <div className="border-t border-[var(--line)] px-4 py-3">
          {loading && (
            <div className="space-y-2.5">
              <div className="skeleton h-3.5 w-1/3 rounded" />
              <div className="skeleton h-3 w-full rounded" />
              <div className="skeleton h-3 w-11/12 rounded" />
              <div className="skeleton h-3 w-4/5 rounded" />
              <p className="pt-1.5 text-xs text-[var(--muted)]">
                Pura syllabus padh raha hoon aur notes likh raha hoon — lamba document banega, thoda
                sabr rakh…
              </p>
            </div>
          )}

          {error && (
            <p
              className="flex items-start gap-1.5 text-xs leading-relaxed"
              style={{ color: "var(--bad)" }}
            >
              <span className="mt-0.5 shrink-0">
                <AlertIcon width={13} height={13} />
              </span>
              {error}
            </p>
          )}

          {markdown && !loading && (
            <article
              /* Reuses the study-plan Markdown styling. The renderer escapes
                 every character before rebuilding tags, so model output cannot
                 inject markup into the page. */
              className="plan-markdown max-h-[65vh] overflow-y-auto pr-2"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
            />
          )}
        </div>
      )}
    </section>
  );
}
