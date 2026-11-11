"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { topicVideoQuery } from "@/lib/engine/rules/search";
import { apiReasonLabel, formatDuration, formatViews } from "@/lib/format";
import {
  claimTopicVideos,
  enqueueTopicVideos,
  readTopicVideos,
  topicVideosSignature,
} from "@/lib/topicVideoBatch";
import type { Topic, VideoMatch, VideoSearch } from "@/lib/types";
import type { PlayerVideo } from "./VideoPlayerModal";

/**
 * Real YouTube video suggestions for ONE syllabus topic.
 *
 * Discovery is the existing server route /api/videos (the key never reaches
 * the browser): one topic-scoped search per topic, ranked by relevance,
 * views, duration and syllabus coverage, de-duplicated against every other
 * topic card. The FIRST result is the recommendation; the rest are the
 * alternative choices — every field (thumbnail, title, channel, duration,
 * views, url) is real API data.
 *
 * When discovery is unavailable (no key / quota / network) the component
 * degrades to the honest YouTube SEARCH LINKS built from the syllabus, and
 * says why — it never dresses a search link up as a video.
 */

export interface TopicVideosState {
  videos: VideoMatch[] | null;
  status: "idle" | "loading" | "ready";
  /** Why the videos are missing (honest label) — absent on success. */
  reason?: string;
}

interface UseTopicVideosInput {
  topic: Topic;
  subject: string;
  /** Language code from the form (en / hi / hinglish / …). */
  language: string;
  /** ALL syllabus topics — coverage % is measured against these. */
  allTopics: Topic[];
  subtopicsByTopicId: Record<string, string[]>;
  /** False while the topic is skipped (already studied) — no fetch. */
  enabled: boolean;
}

/**
 * Lazily fetches one topic's real videos. Mounts only when the unit is
 * expanded (TopicAccordion renders topics on demand), and every mounted
 * panel joins the shared batch in topicVideoBatch — expanding a unit costs
 * one HTTP call, and repeat visits cost nothing (7-day localStorage copy).
 */
export function useTopicVideos(input: UseTopicVideosInput): TopicVideosState & { retry: () => void } {
  const { topic, subject, language, allTopics, subtopicsByTopicId, enabled } = input;

  const sig = useMemo(
    () => topicVideosSignature(subject, language, allTopics),
    [subject, language, allTopics],
  );

  const [state, setState] = useState<TopicVideosState>({ videos: null, status: "idle" });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    // Async wrapper: the cache read + first setState happen in a microtask
    // (standard data-fetch shape), never synchronously during the effect.
    void (async () => {
      const cached = readTopicVideos(sig, topic.id);
      if (cancelled) return;
      if (cached) {
        // Restored copies are already on screen somewhere — claim them so a
        // freshly expanding unit cannot duplicate them.
        claimTopicVideos(topic.id, cached);
        setState({ videos: cached, status: "ready" });
        return;
      }

      setState({ videos: null, status: "loading" });

      enqueueTopicVideos({
        sig,
        key: topic.id,
        query: topicVideoQuery(topic, subject, language),
        topics: allTopics.map((t) => ({
          title: t.title,
          keywords: t.keywords,
          subtopics: subtopicsByTopicId[t.id] ?? [],
        })),
        resolve: (result) => {
          if (cancelled) return;
          if (result.videos) setState({ videos: result.videos, status: "ready" });
          else setState({ videos: null, status: "ready", reason: result.reason });
        },
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [sig, topic, subject, language, allTopics, subtopicsByTopicId, enabled, nonce]);

  const retry = useCallback(() => setNonce((value) => value + 1), []);
  return { ...state, retry };
}

/* ------------------------------- presentation ------------------------------- */

/** The player only needs these three fields — map from the API shape. */
const toPlayer = (video: VideoMatch): PlayerVideo => ({
  id: video.id,
  title: video.title,
  channelTitle: video.channel,
});

interface TopicVideosProps {
  topic: Topic;
  state: TopicVideosState;
  /** Honest search links for this topic — the fallback when no video matched. */
  searches: VideoSearch[];
  queries: string[];
  /** Total syllabus topics — shown in the coverage chip. */
  totalTopics: number;
  onRetry: () => void;
  /** In-app preview of a REAL video (opens the shared player modal). */
  onPreview: (video: PlayerVideo) => void;
}

export function TopicVideos({
  topic,
  state,
  searches,
  queries,
  totalTopics,
  onRetry,
  onPreview,
}: TopicVideosProps) {
  const { videos, status, reason } = state;
  if (status === "idle") return null;

  const recommended = videos && videos.length > 0 ? videos[0] : null;
  const others = videos && videos.length > 1 ? videos.slice(1) : [];

  return (
    <section
      aria-label={`Video suggestions for ${topic.title}`}
      data-topic-videos={topic.id}
      className="card p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-extrabold">🎬 Recommended video</p>
        {status === "loading" && <span className="chip">Dhoond rahe hain…</span>}
        {recommended && (
          <span className="chip">
            {videos!.length} video{videos!.length > 1 ? "s" : ""} mile
          </span>
        )}
      </div>

      {status === "loading" && (
        <>
          <div className="mt-2.5 flex gap-3">
            <div className="skeleton aspect-video w-48 shrink-0 rounded-lg" />
            <div className="flex-1 space-y-2 py-1">
              <div className="skeleton h-4 w-4/5 rounded" />
              <div className="skeleton h-3 w-2/5 rounded" />
              <div className="flex gap-1.5 pt-1">
                <div className="skeleton h-5 w-24 rounded-full" />
                <div className="skeleton h-5 w-20 rounded-full" />
              </div>
            </div>
          </div>
          <p className="mt-2 text-xs text-[var(--muted)]">
            YouTube se is topic ke liye asli lectures dhoond rahe hain…
          </p>
        </>
      )}

      {status === "ready" && recommended && (
        <>
          <p className="mt-1 text-[0.68rem] leading-relaxed text-[var(--muted)]">
            Asli YouTube results — title/channel/duration/views sach aate hain; ranking humari
            analysis se.{" "}
            <b style={{ color: "var(--warn)" }}>% syllabus</b> ek ESTIMATE hai (video ke title +
            description ko aapke topics se match karke) — dekh ke khud confirm karo. Thumbnail par
            click karke yahin preview bhi kar sakte ho.
          </p>

          {/* The one best-matching video — bigger card, previewable in-app. */}
          <div
            className="mt-2.5 rounded-xl border p-3"
            style={{
              borderColor: "color-mix(in srgb, var(--brand) 45%, var(--line))",
              background: "var(--surface)",
            }}
          >
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => onPreview(toPlayer(recommended))}
                aria-label={`Preview: ${recommended.title}`}
                title="Yahin par play karo — ExamSmasher me hi wapas aao"
                className="shrink-0 rounded-lg transition-opacity hover:opacity-85 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
              >
                {/* Raw CDN src kept (not next/image): the card shows a
                    lazy thumb and tests verify the real i.ytimg.com URL —
                    an optimizer proxy hop would add cost for zero gain. */}
                {/* eslint-disable-next-line @next/next/no-img-element -- YouTube CDN thumbnail */}
                <img
                  src={recommended.thumb}
                  alt=""
                  width={192}
                  height={108}
                  loading="lazy"
                  className="h-[108px] w-48 rounded-lg object-cover"
                  style={{ background: "var(--surface-2)" }}
                />
              </button>

              <div className="min-w-0 flex-1">
                <span
                  className="chip font-bold"
                  style={{ color: "var(--brand)" }}
                  title="Sabse pehla result — relevance + views + syllabus match se rank hua"
                >
                  ⭐ Recommended
                </span>
                <a
                  href={recommended.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 block text-sm font-extrabold leading-snug hover:underline"
                  aria-label={`Watch on YouTube: ${recommended.title}`}
                  title={recommended.title}
                >
                  {recommended.title}
                </a>
                <p className="mt-0.5 truncate text-[0.7rem] text-[var(--muted)]">
                  {recommended.channel} · {formatDuration(recommended.durationSec)} ·{" "}
                  {formatViews(recommended.views)} views
                  {recommended.published ? ` · ${recommended.published.slice(0, 4)}` : ""}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span
                    className="chip font-bold"
                    style={{ color: "var(--brand)" }}
                    title="Title + description matching se estimate — video dekh ke confirm karo"
                  >
                    ≈{recommended.coveragePct}% syllabus
                  </span>
                  <span
                    className="chip"
                    title={recommended.matchedTopics.join(" · ") || "Koi topic title match nahi hua"}
                  >
                    {recommended.matchedTopics.length}/{totalTopics} topics
                  </span>
                  <button
                    type="button"
                    onClick={() => onPreview(toPlayer(recommended))}
                    aria-label={`Play here: ${recommended.title}`}
                    className="btn-ghost px-2 py-1 text-[0.66rem]"
                  >
                    ▶ Preview
                  </button>
                  <a
                    href={recommended.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-ghost px-2 py-1 text-[0.66rem]"
                  >
                    ↗ YouTube
                  </a>
                </div>
                {recommended.matchedTopics.length > 0 && (
                  <p
                    className="mt-1 truncate text-[0.66rem] leading-snug text-[var(--muted)]"
                    title={recommended.matchedTopics.join(" · ")}
                  >
                    ✓ Covers: {recommended.matchedTopics.slice(0, 3).join(", ")}
                    {recommended.matchedTopics.length > 3
                      ? ` +${recommended.matchedTopics.length - 3} more`
                      : ""}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Alternative choices — same real metadata, compact rows. */}
          <div id={`topic-others-${topic.id}`} className="mt-3 scroll-mt-28">
            <p className="text-xs font-extrabold">
              Other video choices ({others.length})
              {others.length === 0 && " — is topic ke liye abhi aur nahi mile"}
            </p>
            {others.length > 0 && (
              <ul aria-label="Alternative video suggestions" className="mt-1.5 space-y-1.5">
                {others.map((video) => (
                  <li
                    key={video.id}
                    data-video-id={video.id}
                    className="flex gap-2.5 rounded-lg border px-2.5 py-2"
                    style={{ borderColor: "var(--line)", background: "var(--surface)" }}
                  >
                    <button
                      type="button"
                      onClick={() => onPreview(toPlayer(video))}
                      aria-label={`Preview: ${video.title}`}
                      title="Yahin par play karo — ExamSmasher me hi wapas aao"
                      className="shrink-0 rounded-md transition-opacity hover:opacity-85 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- YouTube CDN thumbnail */}
                      <img
                        src={video.thumb}
                        alt=""
                        width={96}
                        height={54}
                        loading="lazy"
                        className="h-[54px] w-24 rounded-md object-cover"
                        style={{ background: "var(--surface-2)" }}
                      />
                    </button>
                    <div className="min-w-0 flex-1">
                      <a
                        href={video.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block truncate text-xs font-extrabold hover:underline"
                        aria-label={`Watch: ${video.title}`}
                        title={video.title}
                      >
                        {video.title}
                      </a>
                      <p className="mt-0.5 truncate text-[0.66rem] text-[var(--muted)]">
                        {video.channel} · {formatDuration(video.durationSec)} ·{" "}
                        {formatViews(video.views)} views
                        {video.published ? ` · ${video.published.slice(0, 4)}` : ""}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span
                          className="chip font-bold"
                          style={{ color: "var(--brand)" }}
                          title="Title + description matching se estimate"
                        >
                          ≈{video.coveragePct}% syllabus
                        </span>
                        <button
                          type="button"
                          onClick={() => onPreview(toPlayer(video))}
                          aria-label={`Play here: ${video.title}`}
                          className="btn-ghost px-2 py-1 text-[0.66rem]"
                        >
                          ▶ Preview
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {/* Honest fallback: no verified video → plain search links, labelled. */}
      {status === "ready" && !recommended && (
        <div className="mt-2">
          <p className="text-xs leading-relaxed text-[var(--muted)]">
            {reason
              ? `YouTube API abhi available nahi (${apiReasonLabel(reason)}) — is topic ke liye ye YouTube search suggestions hain, results me se khud suitable lecture chuno.`
              : "Is topic ke liye YouTube par koi suitable lecture nahi mila — neeche search link se results dekho."}
          </p>
          {reason && (
            <button
              type="button"
              onClick={onRetry}
              className="btn-ghost mt-2 px-2.5 py-1 text-xs"
            >
              🔄 Dobara try karo
            </button>
          )}
        </div>
      )}

      {!recommended && searches.length > 0 && (
        <div className="mt-2.5">
          <p className="text-[0.7rem] font-bold uppercase tracking-wide text-[var(--muted)]">
            🔎 YouTube search suggestions (fallback)
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {searches.map((search) => (
              <li key={search.url}>
                <a
                  href={search.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs transition-colors hover:bg-[var(--surface-2)]"
                  style={{ borderColor: "var(--line)" }}
                >
                  <span className="min-w-0 truncate font-semibold">
                    <span
                      className="mr-1.5 rounded px-1.5 py-0.5 text-[0.62rem] font-extrabold uppercase tracking-wide"
                      style={{
                        background: "color-mix(in srgb, var(--brand) 12%, transparent)",
                        color: "var(--brand)",
                      }}
                    >
                      {search.label}
                    </span>
                    {search.query}
                  </span>
                  <span className="shrink-0 text-[var(--muted)]">↗</span>
                </a>
              </li>
            ))}
          </ul>
          {queries.length > 0 && (
            <p className="mt-2 text-[0.7rem] text-[var(--muted)]">Queries: {queries.join(" · ")}</p>
          )}
        </div>
      )}

      {status === "ready" && !recommended && searches.length === 0 && reason === undefined && (
        <div className="mt-2 rounded-lg border border-dashed px-3 py-3 text-xs text-[var(--muted)]" style={{ borderColor: "var(--line)" }}>
          Is topic ke liye koi video ya search link nahi ban paaya — topic ka naam thoda specific
          karke dobara analyse karo.
        </div>
      )}
    </section>
  );
}
