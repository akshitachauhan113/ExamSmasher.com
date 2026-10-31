/* eslint-disable @next/next/no-img-element */
"use client";

import { formatDuration, formatViews, videoUrl } from "@/lib/format";
import type { ScoredVideo } from "@/lib/types";
import { BotIcon, CheckIcon, ClockIcon, CrownIcon, ExternalIcon } from "./Icons";
import { VideoSummaryBox } from "./VideoSummaryBox";

function scoreColor(score: number): string {
  if (score >= 85) return "var(--good)";
  if (score >= 70) return "var(--brand)";
  if (score >= 55) return "var(--warn)";
  return "var(--muted)";
}

interface VideoCardProps {
  entry: ScoredVideo;
  index: number;
  /** Parent topic title — grounds the AI summary in what the student needs. */
  topicTitle: string;
  /** Language code for transcript fetches (summary generation). */
  languageCode: string;
  /** Opens the in-app player instead of leaving for YouTube. */
  onPlay: (video: { id: string; title: string; channelTitle: string }) => void;
}

export function VideoCard({ entry, index, topicTitle, languageCode, onPlay }: VideoCardProps) {
  const { video, score } = entry;
  const url = videoUrl(video.id);
  const year = video.publishedAt ? new Date(video.publishedAt).getFullYear() : null;
  const isTop = index === 0;
  const degrees = Math.max(0, Math.min(100, score)) * 3.6;

  const playHere = (event: React.MouseEvent) => {
    event.preventDefault();
    onPlay({ id: video.id, title: video.title, channelTitle: video.channelTitle });
  };

  return (
    <article
      className="card group animate-fade-up overflow-hidden p-3 transition-all hover:-translate-y-0.5"
      style={{
        borderColor: isTop
          ? "color-mix(in srgb, var(--gold) 55%, var(--line))"
          : "var(--line)",
      }}
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        {/* Thumbnail — plays inside the app */}
        <button
          type="button"
          onClick={playHere}
          className="relative block w-full shrink-0 overflow-hidden rounded-xl sm:w-52"
          aria-label={`Play ${video.title} here`}
        >
          <div className="aspect-video w-full bg-[var(--surface-2)]">
            {video.thumbnail ? (
              <img
                src={video.thumbnail}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
            ) : null}
          </div>
          <span className="absolute inset-0 grid place-items-center bg-black/0 opacity-0 transition-all duration-200 group-hover:bg-black/35 group-hover:opacity-100">
            <span className="grid h-11 w-11 place-items-center rounded-full bg-white/95 text-black shadow-lg">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M8 5.6c0-.9 1-1.4 1.7-1l9 5.4c.7.4.7 1.4 0 1.8l-9 5.4c-.7.4-1.7-.1-1.7-1z" />
              </svg>
            </span>
          </span>
          <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/80 px-1.5 py-0.5 font-mono text-[0.7rem] font-semibold text-white">
            {formatDuration(video.durationSeconds)}
          </span>
          {isTop && (
            <span
              className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[0.68rem] font-bold text-black"
              style={{ background: "var(--gold)" }}
            >
              <CrownIcon width={12} height={12} /> TOP PICK
            </span>
          )}
        </button>

        {/* Details */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="line-clamp-2 text-[0.95rem] font-bold leading-snug hover:underline"
                style={{
                  textDecorationColor: "color-mix(in srgb, var(--brand) 50%, transparent)",
                }}
              >
                {video.title}
              </a>

              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--muted)]">
                <span className="font-semibold text-[var(--text)]">{video.channelTitle}</span>
                {video.viewCount > 0 && <span>· {formatViews(video.viewCount)} views</span>}
                {year && <span>· {year}</span>}
                {video.hasCaptions && (
                  <span className="flex items-center gap-1 text-[var(--good)]">
                    <CheckIcon width={12} height={12} /> captions
                  </span>
                )}
              </p>
            </div>

            {/* Score ring */}
            <div
              className="grid h-12 w-12 shrink-0 place-items-center rounded-full"
              style={{
                background: `conic-gradient(${scoreColor(score)} ${degrees}deg, var(--surface-2) 0deg)`,
              }}
              title={`Match score ${score}/100`}
            >
              <div className="grid h-9 w-9 place-items-center rounded-full bg-[var(--surface)]">
                <span className="text-[0.72rem] font-extrabold" style={{ color: scoreColor(score) }}>
                  {score}
                </span>
              </div>
            </div>
          </div>

          {entry.aiSummary && (
            <p className="mt-2 flex items-start gap-1.5 text-[0.82rem] leading-relaxed text-[var(--muted)]">
              <span className="mt-0.5 shrink-0 text-[var(--brand)]">
                <BotIcon width={14} height={14} />
              </span>
              {entry.aiSummary}
            </p>
          )}

          {entry.reasons.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {entry.reasons.map((reason, i) => (
                <span key={`${reason}-${i}`} className="chip">
                  {reason}
                </span>
              ))}
            </div>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-3 text-xs">
            <button
              type="button"
              onClick={playHere}
              className="flex items-center gap-1 font-bold"
              style={{ color: "var(--brand)" }}
            >
              ▶ Play here
            </button>

            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[var(--muted)] hover:text-[var(--text)]"
            >
              Open on YouTube <ExternalIcon width={13} height={13} />
            </a>

            <span className="flex items-center gap-1 text-[var(--muted)]">
              <ClockIcon width={13} height={13} />
              {Math.round(video.durationSeconds / 60)} min
            </span>

            {entry.matchType === "transcript" && (
              <span className="flex items-center gap-1 text-[var(--good)]">
                <CheckIcon width={13} height={13} /> content verified via transcript
              </span>
            )}

            {typeof entry.aiScore === "number" && (
              <span className="text-[var(--muted)]">AI score: {entry.aiScore}/100</span>
            )}
          </div>

          {/* Sits right under the actions, so a student sees the option to
              "read instead of watch" BEFORE committing 20 minutes. */}
          <VideoSummaryBox
            videoId={video.id}
            videoTitle={video.title}
            topicTitle={topicTitle}
            languageCode={languageCode}
          />

          {entry.transcriptSnippet && (
            <details className="mt-2">
              <summary className="cursor-pointer select-none text-xs font-semibold text-[var(--muted)] hover:text-[var(--text)]">
                Transcript se jhaank lo — sach me kya bol raha hai
              </summary>
              <p className="mt-1.5 rounded-lg bg-[var(--surface-2)] p-2.5 text-xs italic leading-relaxed text-[var(--muted)]">
                “{entry.transcriptSnippet}…”
              </p>
            </details>
          )}
        </div>
      </div>
    </article>
  );
}
