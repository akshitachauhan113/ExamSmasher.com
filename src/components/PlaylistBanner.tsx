/* eslint-disable @next/next/no-img-element */
"use client";

import { useState } from "react";
import type { CoursePlaylist } from "@/lib/types";
import { ExternalIcon } from "./Icons";

interface PlaylistBannerProps {
  playlist: CoursePlaylist;
  totalTopics: number;
  /** True while per-topic video matching is still running. */
  matching: boolean;
  onUse: () => void;
}

function coverageColor(percent: number): string {
  if (percent >= 80) return "var(--good)";
  if (percent >= 65) return "var(--brand)";
  return "var(--warn)";
}

/**
 * Shown once a full-course playlist has been verified against the syllabus.
 * This is the "one playlist covers your whole course" answer — the student
 * gets an honest coverage number instead of a vague promise.
 */
export function PlaylistBanner({
  playlist,
  totalTopics,
  matching,
  onUse,
}: PlaylistBannerProps) {
  const [showAlts, setShowAlts] = useState(false);
  const covered = playlist.coverage.length;
  const percent = playlist.coveragePercent;
  const color = coverageColor(percent);

  const verdict =
    percent >= 80
      ? "Poori syllabus cover ho rahi hai — ek hi playlist se padh lo."
      : percent >= 65
        ? "Zyadatar syllabus cover ho rahi hai — baaki topics alag se milenge."
        : "Kuch topics cover ho rahe hain — baaki ke liye alag videos bhi milenge.";

  return (
    <section
      className="card mt-6 overflow-hidden p-0"
      style={{ borderColor: `color-mix(in srgb, ${color} 45%, var(--line))` }}
    >
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start">
        {playlist.thumbnail ? (
          <img
            src={playlist.thumbnail}
            alt=""
            loading="lazy"
            className="h-24 w-full shrink-0 rounded-xl object-cover sm:w-40"
          />
        ) : (
          <div
            className="grid h-24 w-full shrink-0 place-items-center rounded-xl text-3xl sm:w-40"
            style={{ background: "var(--surface-2)" }}
          >
            📘
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="chip font-bold"
              style={{
                color,
                borderColor: `color-mix(in srgb, ${color} 50%, var(--line))`,
              }}
            >
              📘 Existing full-course playlist
            </span>
            <span className="chip">{playlist.videoCount} videos</span>
            <span className="chip">
              {covered}/{totalTopics} topics matched
            </span>
            <span className="chip">
              {playlist.method === "ai" ? "AI-verified match" : "Keyword-verified match"}
            </span>
          </div>

          <a
            href={playlist.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 block line-clamp-2 text-[1rem] font-extrabold leading-snug hover:underline"
          >
            {playlist.title}{" "}
            <span className="inline-block align-middle">
              <ExternalIcon width={13} height={13} />
            </span>
          </a>
          <p className="mt-0.5 text-xs font-semibold text-[var(--muted)]">
            {playlist.channelTitle}
          </p>

          <div className="mt-3 flex items-center gap-3">
            <div
              className="h-2 flex-1 overflow-hidden rounded-full"
              style={{ background: "var(--surface-2)" }}
              title={`${percent}% of your syllabus topics are taught inside this playlist`}
            >
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${percent}%`, background: color }}
              />
            </div>
            <span className="text-sm font-extrabold" style={{ color }}>
              {percent}%
            </span>
          </div>

          <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">{verdict}</p>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={onUse} disabled={matching} className="btn-primary px-3 py-1.5 text-xs disabled:opacity-60">
              {matching ? "Matching…" : "Use this playlist for my topics →"}
            </button>

            <a
              href={playlist.url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost px-3 py-1.5 text-xs"
            >
              Open playlist
            </a>

            {playlist.alternatives && playlist.alternatives.length > 0 && (
              <button
                type="button"
                onClick={() => setShowAlts((s) => !s)}
                className="btn-ghost px-3 py-1.5 text-xs"
              >
                {showAlts ? "Hide" : "Other playlists"} ({playlist.alternatives.length})
              </button>
            )}
          </div>

          {showAlts && playlist.alternatives && (
            <ul className="mt-3 space-y-1.5 border-t pt-3" style={{ borderColor: "var(--line)" }}>
              {playlist.alternatives.map((alt) => (
                <li key={alt.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs">
                    <span className="font-semibold">{alt.title}</span>
                    <span className="text-[var(--muted)]"> · {alt.channelTitle}</span>
                  </span>
                  <span className="flex gap-1.5">
                    <a
                      href={alt.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[0.7rem] font-bold"
                      style={{ color: "var(--brand)" }}
                    >
                      Open
                    </a>
                  </span>
                </li>
              ))}
              <li className="pt-1 text-[0.7rem] text-[var(--muted)]">
                Switch karne ke liye &quot;Re-match videos&quot; chalao — ranking dobara hogi.
              </li>
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
