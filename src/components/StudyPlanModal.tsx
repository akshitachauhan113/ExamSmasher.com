"use client";

import { useEffect } from "react";
import { renderMarkdown } from "@/lib/markdown";
import { CloseIcon, RefreshIcon } from "./Icons";

interface StudyPlanModalProps {
  open: boolean;
  loading: boolean;
  markdown: string | null;
  error: string | null;
  onClose: () => void;
  onRegenerate: () => void;
}

export function StudyPlanModal({
  open,
  loading,
  markdown,
  error,
  onClose,
  onRegenerate,
}: StudyPlanModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="AI study plan"
    >
      <div
        className="card flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4">
          <div>
            <h2 className="text-base font-extrabold">🗓️ AI study plan</h2>
            <p className="text-xs text-[var(--muted)]">
              Built from your top-picked videos, spaced over realistic daily sessions.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close study plan"
            className="btn-ghost grid h-9 w-9 place-items-center"
          >
            <CloseIcon width={16} height={16} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="space-y-3 py-2">
              <div className="skeleton h-5 w-2/3 rounded" />
              <div className="skeleton h-3 w-full rounded" />
              <div className="skeleton h-3 w-5/6 rounded" />
              <div className="skeleton h-32 w-full rounded-xl" />
              <div className="skeleton h-3 w-1/2 rounded" />
              <p className="pt-2 text-center text-xs text-[var(--muted)]">
                Mentoring the AI to build your day-by-day plan…
              </p>
            </div>
          )}

          {error && (
            <p
              className="rounded-xl border px-3 py-2.5 text-sm"
              style={{
                borderColor: "color-mix(in srgb, var(--bad) 40%, var(--line))",
                color: "var(--bad)",
              }}
            >
              {error}
            </p>
          )}

          {markdown && !loading && (
            <div
              className="plan-markdown"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
            />
          )}
        </div>

        {markdown && !loading && (
          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] px-5 py-3">
            <p className="text-xs text-[var(--muted)]">Tip: pause the video and solve before moving on.</p>
            <button
              type="button"
              onClick={onRegenerate}
              className="btn-ghost flex items-center gap-2 px-3 py-2 text-sm"
            >
              <RefreshIcon width={15} height={15} /> Regenerate
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
