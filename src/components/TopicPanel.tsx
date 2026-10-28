"use client";

import type { PlayerVideo } from "@/components/VideoPlayerModal";
import { CheckIcon } from "@/components/Icons";
import { AlertIcon } from "@/components/Icons";
import type { Topic, TopicResult } from "@/lib/types";
import { VideoCard } from "./VideoCard";

const IMPORTANCE_COLOR: Record<string, string> = {
  core: "var(--bad)",
  important: "var(--warn)",
  bonus: "var(--muted)",
};

interface TopicPanelProps {
  topic: Topic;
  index: number;
  result?: TopicResult;
  studied: boolean;
  onToggleStudied: () => void;
  onPlay: (video: PlayerVideo) => void;
}

export function TopicPanel({
  topic,
  index,
  result,
  studied,
  onToggleStudied,
  onPlay,
}: TopicPanelProps) {
  return (
    <section
      id={`topic-${topic.id}`}
      data-topic-id={topic.id}
      className="scroll-mt-28"
      style={{
        contentVisibility: "auto",
        opacity: studied ? 0.72 : 1,
        transition: "opacity .25s ease",
      }}
    >
      <header className="mb-3 flex items-start gap-3">
        <span
          className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl text-sm font-extrabold text-white"
          style={{
            background: studied
              ? "var(--good)"
              : "linear-gradient(135deg, var(--brand), var(--brand-2))",
          }}
        >
          {studied ? <CheckIcon width={17} height={17} /> : index + 1}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3
              className="text-[1.05rem] font-extrabold leading-tight"
              style={
                studied
                  ? { textDecoration: "line-through", textDecorationColor: "var(--good)" }
                  : undefined
              }
            >
              {topic.title}
            </h3>

            <button
              type="button"
              onClick={onToggleStudied}
              aria-pressed={studied}
              className="btn-ghost flex shrink-0 items-center gap-1.5 px-2.5 py-1 text-xs"
              style={
                studied
                  ? {
                      borderColor: "color-mix(in srgb, var(--good) 55%, var(--line))",
                      color: "var(--good)",
                    }
                  : undefined
              }
            >
              <span
                className="grid h-4 w-4 place-items-center rounded border"
                style={{
                  borderColor: studied ? "var(--good)" : "var(--line)",
                  background: studied ? "var(--good)" : "transparent",
                }}
              >
                {studied && <CheckIcon width={11} height={11} />}
              </span>
              {studied ? "Studied" : "Mark as studied"}
            </button>
          </div>

          {topic.description && (
            <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{topic.description}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {topic.chapter && <span className="chip">{topic.chapter}</span>}
            <span className="chip" style={{ color: IMPORTANCE_COLOR[topic.importance] }}>
              {topic.importance}
            </span>
            <span className="chip">{topic.difficulty}</span>
            <span className="chip">~{topic.estimatedMinutes} min</span>
          </div>
        </div>
      </header>

      <div className="ml-0 space-y-3 sm:ml-11">
        {result?.skipped && (
          <div className="rounded-xl border border-dashed border-[var(--line)] px-4 py-4 text-sm text-[var(--muted)]">
            ✅ Tumne ye topic pehle padh liya hai — isliye video search skip kar di.
          </div>
        )}

        {!result && <SkeletonCard />}
        {!result && <SkeletonCard />}

        {result?.error && (
          <div
            className="rounded-xl border px-3 py-2.5 text-sm"
            style={{
              borderColor: "color-mix(in srgb, var(--bad) 40%, var(--line))",
              background: "color-mix(in srgb, var(--bad) 6%, var(--surface))",
            }}
          >
            <p className="flex items-start gap-2 font-semibold" style={{ color: "var(--bad)" }}>
              <span className="mt-0.5 shrink-0">
                <AlertIcon width={15} height={15} />
              </span>
              Could not search videos for this topic
            </p>
            <p className="mt-1 pl-6 text-xs text-[var(--muted)]">{result.error}</p>
          </div>
        )}

        {result && !result.error && !result.skipped && result.videos.length === 0 && (
          <div className="rounded-xl border border-dashed border-[var(--line)] px-4 py-6 text-center text-sm text-[var(--muted)]">
            No confident match for this topic. Try re-running with a more specific topic name, or
            pick a different video language.
          </div>
        )}

        {result?.videos.map((entry, i) => (
          <VideoCard key={entry.video.id} entry={entry} index={i} onPlay={onPlay} />
        ))}

        {result && !result.error && !result.skipped && result.videos.length > 0 && (
          <p className="pl-1 text-[0.72rem] text-[var(--muted)]">
            {result.candidatesConsidered} candidates scanned
            {result.aiUsed ? " · AI content-match applied" : " · ranked by match + quality signals"}
            {result.queries.length > 0 && <> · “{result.queries[0]}”</>}
          </p>
        )}
      </div>
    </section>
  );
}

function SkeletonCard() {
  return (
    <div className="card flex gap-3 p-3">
      <div className="skeleton aspect-video w-full shrink-0 rounded-xl sm:w-52" />
      <div className="flex-1 space-y-2 py-1">
        <div className="skeleton h-4 w-4/5 rounded" />
        <div className="skeleton h-3 w-2/5 rounded" />
        <div className="flex gap-1.5 pt-1">
          <div className="skeleton h-5 w-20 rounded-full" />
          <div className="skeleton h-5 w-24 rounded-full" />
          <div className="skeleton h-5 w-16 rounded-full" />
        </div>
      </div>
    </div>
  );
}