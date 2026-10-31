"use client";

import { useState } from "react";
import type { SummaryResponse } from "@/lib/types";
import { BotIcon, CloseIcon } from "./Icons";

interface VideoSummaryBoxProps {
  videoId: string;
  videoTitle: string;
  topicTitle: string;
  languageCode: string;
}

/**
 * On-demand AI summary of one video.
 *
 * Fetches the video transcript server-side, asks the AI what the video
 * actually teaches, and renders short bullets — so the student can decide
 * whether to watch before spending 20 minutes on it.
 */
export function VideoSummaryBox({
  videoId,
  videoTitle,
  topicTitle,
  languageCode,
}: VideoSummaryBoxProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (loading) return;
    setOpen(true);

    // Already loaded — just toggle.
    if (data?.ok) return;

    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId, videoTitle, topicTitle, languageCode }),
      });
      const json = (await response.json().catch(() => null)) as SummaryResponse | null;
      if (!json?.ok) {
        setError(json?.error ?? "Could not load the summary.");
      } else {
        setData(json);
      }
    } catch {
      setError("Network error — check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : void load())}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-bold transition-colors"
        style={{
          background: open
            ? "var(--brand)"
            : "color-mix(in srgb, var(--brand) 10%, transparent)",
          color: open ? "var(--brand-contrast, #fff)" : "var(--brand)",
        }}
        aria-expanded={open}
      >
        <BotIcon width={13} height={13} />
        {open
          ? "Band karo"
          : data?.ok
            ? "Phir se summary dekho"
            : "🧠 Pehle summary padh lo — kya hai is video me?"}
      </button>

      {open && (
        <div
          className="mt-2 rounded-xl border p-3 text-sm"
          style={{ borderColor: "var(--line)", background: "var(--surface-2)" }}
        >
          {loading && (
            <div className="space-y-2">
              <div className="skeleton h-3 w-3/4 rounded" />
              <div className="skeleton h-3 w-full rounded" />
              <div className="skeleton h-3 w-5/6 rounded" />
              <p className="pt-1 text-xs text-[var(--muted)]">
                Video ki transcript padh kar samajh raha hoon…
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
                onClick={() => void load()}
                className="shrink-0 text-xs font-bold"
                style={{ color: "var(--brand)" }}
              >
                Retry
              </button>
            </div>
          )}

          {data?.ok && !loading && (
            <div>
              {data.summary?.fit && (
                <p
                  className="mb-2 rounded-lg px-2.5 py-2 text-xs font-semibold leading-relaxed"
                  style={{
                    background: "color-mix(in srgb, var(--brand) 12%, transparent)",
                    color: "var(--brand)",
                  }}
                >
                  {data.summary.fit}
                </p>
              )}
              <ul className="space-y-1.5">
                {data.summary?.bullets.map((bullet, i) => (
                  <li key={i} className="flex gap-2 text-[0.82rem] leading-relaxed">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[0.7rem] text-[var(--muted)]">
                {data.transcriptAvailable
                  ? "Based on the video's transcript."
                  : "No transcript available — based on the title and description."}
                {data.summary?.level ? ` Level: ${data.summary.level}.` : ""}
              </p>
            </div>
          )}
        </div>
      )}

      {open && !loading && (data?.ok || error) && (
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
