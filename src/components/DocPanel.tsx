"use client";

import { useState } from "react";
import { downloadFile } from "@/lib/exporters";
import { renderMarkdown } from "@/lib/markdown";
import { AlertIcon, CopyIcon, DownloadIcon } from "./Icons";

interface DocPanelProps {
  title: string;
  subtitle: string;
  buttonLabel: string;
  /** Extra line shown above the document once it exists (e.g. detected shape). */
  note?: string | null;
  /** Produces the Markdown. Errors thrown here are shown to the student. */
  onGenerate: () => Promise<string>;
  /** Filename stem for the download. */
  filename: string;
}

/**
 * One "make a long document, read it here, take it away" surface.
 *
 * Solutions, mock papers and anything else that arrives as one long Markdown
 * blob share this so the reading experience and the download/copy affordances
 * stay identical across them.
 */
export function DocPanel({
  title,
  subtitle,
  buttonLabel,
  note,
  onGenerate,
  filename,
}: DocPanelProps) {
  const [open, setOpen] = useState(false);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    if (loading) return;
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const out = await onGenerate();
      if (!out.trim()) throw new Error("Kuch ban hi nahi — ek baar dobara try karo.");
      setMarkdown(out);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Banate waqt dikkat aa gayi.");
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
    <section
      className="rounded-2xl border px-3.5 py-3"
      style={{ borderColor: "var(--line)", background: "var(--surface)" }}
    >
      <header className="flex flex-wrap items-start justify-between gap-2.5">
        <div className="min-w-0">
          <h4 className="text-[0.92rem] font-extrabold leading-snug">{title}</h4>
          <p className="mt-0.5 text-[0.72rem] leading-relaxed text-[var(--muted)]">{subtitle}</p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void generate()}
            disabled={loading}
            className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:opacity-60"
          >
            {loading ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Ban raha hai…
              </>
            ) : (
              buttonLabel
            )}
          </button>

          {markdown && !loading && (
            <>
              <button
                type="button"
                onClick={() => downloadFile(`${filename}.md`, markdown, "text/markdown")}
                className="btn-ghost flex items-center gap-1 px-2 py-1.5 text-xs"
                aria-label={`Download ${title}`}
              >
                <DownloadIcon width={13} height={13} />
              </button>
              <button
                type="button"
                onClick={() => void copy()}
                className="btn-ghost flex items-center gap-1 px-2 py-1.5 text-xs"
                aria-label={`Copy ${title}`}
              >
                <CopyIcon width={13} height={13} /> {copied ? "✓" : ""}
              </button>
            </>
          )}
        </div>
      </header>

      {note && markdown && !loading && (
        <p
          className="mt-2 rounded-lg px-2.5 py-1.5 text-[0.72rem] font-semibold"
          style={{
            background: "color-mix(in srgb, var(--brand) 10%, transparent)",
            color: "var(--brand)",
          }}
        >
          {note}
        </p>
      )}

      {open && (
        <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--line)" }}>
          {loading && (
            <div className="space-y-2.5">
              <div className="skeleton h-3.5 w-2/5 rounded" />
              <div className="skeleton h-3 w-full rounded" />
              <div className="skeleton h-3 w-11/12 rounded" />
              <div className="skeleton h-3 w-3/4 rounded" />
              <p className="pt-1 text-[0.72rem] text-[var(--muted)]">
                Likha ja raha hai — har sawaal ka poora solution banega, thoda time lagega…
              </p>
            </div>
          )}

          {error && (
            <p
              className="flex items-start gap-1.5 text-[0.75rem] leading-relaxed"
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
              /* The renderer escapes every character before rebuilding tags,
                 so model output cannot inject markup into the page. */
              className="plan-markdown max-h-[65vh] overflow-y-auto pr-2"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
            />
          )}
        </div>
      )}
    </section>
  );
}
