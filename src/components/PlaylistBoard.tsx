"use client";

import { useEffect, useMemo, useState } from "react";
import { ExternalIcon } from "@/components/Icons";
import { TabBar } from "./TabBar";
import { BAND_LABEL } from "@/lib/exam";
import { formatDuration, formatViews } from "@/lib/format";
import { readVideoCache, writeVideoCache } from "@/lib/videoCache";
import type {
  ExamTopic,
  RecommendationPlan,
  SmartPriority,
  SmartPriorityResult,
  Topic,
  VideoMatch,
  VideoSuggestionsResponse,
} from "@/lib/types";

export type PlaylistTab = "complete" | "smart";

/** The progress marks the student makes themselves — never inferred. */
interface PlaylistProgressApi {
  isCovered: (title: string) => boolean;
  toggleCovered: (title: string) => void;
  isWatched: (recId: string) => boolean;
  toggleWatched: (recId: string) => void;
}

interface PlaylistBoardProps {
  /** Every syllabus topic, in syllabus order. */
  topics: Topic[];
  /** Subtopics per topic id (from the full syllabus analysis). */
  subtopicsByTopicId: Record<string, string[]>;
  bandFor: (topic: Topic) => ExamTopic["band"];
  /** Phase 4 priority — labels + reasons for the smart playlist. */
  priority: SmartPriorityResult;
  /** Built recommendations for both tabs (honest search suggestions). */
  completePlan: RecommendationPlan;
  smartPlan: RecommendationPlan;
  progress: PlaylistProgressApi;
  active: PlaylistTab;
  onChange: (tab: PlaylistTab) => void;
  onJump: (topicId: string) => void;
}

const BAND_COLOR: Record<ExamTopic["band"], string> = {
  must: "var(--bad)",
  should: "var(--warn)",
  "if-time": "var(--muted)",
};

const PRIORITY_META: Record<SmartPriority, { label: string; color: string }> = {
  high: { label: "High Priority", color: "var(--bad)" },
  medium: { label: "Medium Priority", color: "var(--brand)" },
  low: { label: "Low Priority", color: "var(--muted)" },
  unobserved: { label: "Not observed", color: "var(--muted)" },
};

type CoverageFilter = "all" | "pending" | "covered";
type WatchedFilter = "all" | "pending" | "watched";

/** Human (Hinglish) label for why the YouTube API could not answer. */
function apiReasonLabel(reason?: string): string {
  switch (reason) {
    case "no-key":
      return "key set nahi";
    case "quota":
      return "quota khatam";
    case "bad-request":
      return "request galat";
    case "throttled":
      return "bahut zyada requests";
    case "network":
      return "network issue";
    default:
      return "result nahi mila";
  }
}

/**
 * The two playlists as a compact two-tab board of GROUPED suggestions.
 *
 * Each card is ONE YouTube search covering several syllabus topics (minimum
 * lectures, maximum coverage). The server resolves that search into REAL
 * YouTube videos (title/channel/duration/views/thumbnail, never fabricated)
 * and estimates how much of the student's syllabus each one mentions from
 * its title + description — an ESTIMATE the UI labels as one. When the API
 * cannot answer (key, quota, network), the card falls back to the honest
 * search link and says so. Coverage only grows from the student's own
 * ticks: a generated link never counts as "covered".
 */
export function PlaylistBoard({
  topics,
  subtopicsByTopicId,
  bandFor,
  priority,
  completePlan,
  smartPlan,
  progress,
  active,
  onChange,
  onJump,
}: PlaylistBoardProps) {
  const [unitFilter, setUnitFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [coverageFilter, setCoverageFilter] = useState<CoverageFilter>("all");
  const [watchedFilter, setWatchedFilter] = useState<WatchedFilter>("all");

  const plan = active === "complete" ? completePlan : smartPlan;
  const { isCovered, toggleCovered, isWatched, toggleWatched } = progress;

  const topicById = useMemo(() => new Map(topics.map((t) => [t.id, t])), [topics]);
  const priorityById = useMemo(
    () => new Map(priority.topics.map((row) => [row.topicId, row])),
    [priority],
  );

  /* --------------------- real video suggestions (YouTube API) --------------------- */

  /** Signature of the exact query set + syllabus currently on screen. */
  const videoSig = `${active}::${plan.signature}`;
  const videoQueries = useMemo(
    () => plan.recommendations.map((rec) => ({ key: rec.id, query: rec.query })),
    [plan],
  );
  const videoTopics = useMemo(
    () => topics.map((topic) => ({ title: topic.title, keywords: topic.keywords })),
    [topics],
  );

  const [videoState, setVideoState] = useState<{
    sig: string;
    status: "loading" | "ready" | "fallback";
    reason?: string;
    byKey: Record<string, VideoMatch[]>;
  } | null>(null);

  useEffect(() => {
    // No recommendations → nothing to fetch; `liveVideos` below already
    // hides any stale entry whose signature does not match the screen.
    if (videoQueries.length === 0) return;
    const controller = new AbortController();

    // All setState lives inside this async fn (never directly in the effect
    // body) so the render stays a single, predictable pass.
    const run = async () => {
      const cached = readVideoCache(videoSig);
      if (cached) {
        setVideoState({ sig: videoSig, status: "ready", byKey: cached });
        return;
      }

      setVideoState({ sig: videoSig, status: "loading", byKey: {} });
      // The route accepts MAX_QUERIES (10) queries per call — chunk bigger
      // plans so every card still gets its videos. Partial success still
      // shows the real videos that did land; a card with none falls back
      // to its honest search link and says why.
      const BATCH = 10;
      const byKey: Record<string, VideoMatch[]> = {};
      let firstReason: string | undefined;
      let anyOk = false;
      const finishOk = () => {
        writeVideoCache(videoSig, byKey);
        setVideoState({ sig: videoSig, status: "ready", byKey });
      };
      try {
        for (let i = 0; i < videoQueries.length; i += BATCH) {
          if (controller.signal.aborted) return;
          const res = await fetch("/api/videos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              queries: videoQueries.slice(i, i + BATCH),
              topics: videoTopics,
            }),
            signal: controller.signal,
          });
          const data = (await res.json()) as VideoSuggestionsResponse;
          if (controller.signal.aborted) return;
          if (data.ok && data.results) {
            anyOk = true;
            Object.assign(byKey, data.results);
          } else if (!firstReason) {
            firstReason = data.reason;
          }
        }
        if (controller.signal.aborted) return;
        if (anyOk) finishOk();
        else setVideoState({ sig: videoSig, status: "fallback", reason: firstReason, byKey: {} });
      } catch {
        if (controller.signal.aborted) return;
        // Network died mid-way — keep whatever real videos already landed.
        if (anyOk) finishOk();
        else setVideoState({ sig: videoSig, status: "fallback", reason: "network", byKey: {} });
      }
    };
    void run();

    return () => controller.abort();
  }, [videoSig, videoQueries, videoTopics]);

  /** Current state only if it belongs to the signature on screen. */
  const liveVideos = videoState && videoState.sig === videoSig ? videoState : null;

  /* ------------------------------ coverage ------------------------------ */
  const coveredCount = useMemo(
    () => topics.filter((t) => isCovered(t.title)).length,
    [topics, isCovered],
  );
  const pendingTopics = useMemo(
    () => topics.filter((t) => !isCovered(t.title)),
    [topics, isCovered],
  );
  const pct = topics.length > 0 ? Math.round((coveredCount / topics.length) * 100) : 0;

  /* ------------------------- per-recommendation info ------------------------- */
  const recInfo = useMemo(
    () =>
      plan.recommendations.map((rec) => {
        const recTopics = rec.topicIds
          .map((id) => topicById.get(id))
          .filter((t): t is Topic => Boolean(t));
        const coveredIn = recTopics.filter((t) => isCovered(t.title)).length;
        return {
          rec,
          recTopics,
          coveredIn,
          fullyCovered: recTopics.length > 0 && coveredIn === recTopics.length,
          watched: isWatched(rec.id),
        };
      }),
    [plan, topicById, isCovered, isWatched],
  );

  const units = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const info of recInfo) {
      if (!seen.has(info.rec.unit)) {
        seen.add(info.rec.unit);
        list.push(info.rec.unit);
      }
    }
    return list;
  }, [recInfo]);

  const filtered = recInfo.filter((info) => {
    if (unitFilter !== "all" && info.rec.unit !== unitFilter) return false;
    if (priorityFilter !== "all") {
      const has = info.recTopics.some(
        (t) => (priorityById.get(t.id)?.priority ?? "unobserved") === priorityFilter,
      );
      if (!has) return false;
    }
    if (coverageFilter === "pending" && info.fullyCovered) return false;
    if (coverageFilter === "covered" && !info.fullyCovered) return false;
    if (watchedFilter === "pending" && info.watched) return false;
    if (watchedFilter === "watched" && !info.watched) return false;
    return true;
  });

  const filtersActive =
    unitFilter !== "all" ||
    priorityFilter !== "all" ||
    coverageFilter !== "all" ||
    watchedFilter !== "all";

  const clearFilters = () => {
    setUnitFilter("all");
    setPriorityFilter("all");
    setCoverageFilter("all");
    setWatchedFilter("all");
  };

  const switchTab = (tab: PlaylistTab) => {
    clearFilters();
    onChange(tab);
  };

  const noRecTopics = plan.noRec
    .map((entry) => topicById.get(entry.topicId))
    .filter((t): t is Topic => Boolean(t));
  const studiedTopics = plan.studiedTopicIds
    .map((id) => topicById.get(id))
    .filter((t): t is Topic => Boolean(t));

  return (
    <div className="card p-4">
      {/* ------------------------------- header ------------------------------- */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[1.05rem] font-extrabold">🎬 Video playlists</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">
            Har card ke andar YouTube ke asli best lectures — ranking analysis se aur % syllabus
            coverage ke saath. Search link se aur bhi results kholein.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="chip">
            {coveredCount}/{topics.length} topics covered
          </span>
          <span className="chip" style={{ color: "var(--brand)" }}>
            {pct}% syllabus
          </span>
          <span className="chip">{plan.recommendations.length} searches</span>
          <span className="chip" style={{ color: "var(--warn)" }}>
            {pendingTopics.length} pending
          </span>
        </div>
      </div>

      {/* -------------------------------- tabs -------------------------------- */}
      <div className="mt-3">
        <TabBar
          ariaLabel="Playlist type"
          active={active}
          onChange={(id) => switchTab(id as PlaylistTab)}
          tabs={[
            { id: "complete", label: "Complete Syllabus Playlist", badge: String(topics.length) },
            {
              id: "smart",
              label: "Smart Exam Playlist",
              badge: String(priority.hasPapers ? priority.counts.high : topics.length),
            },
          ]}
        />
      </div>

      {/* honest disclaimer — real API results, honestly labelled estimate */}
      <p className="mt-1.5 text-[0.68rem] leading-relaxed text-[var(--muted)]">
        ⚠️ Videos YouTube Data API se live aate hain — title, channel, duration, views sach hote
        hain. Ranking relevance + views + duration + syllabus match se hoti hai; “X% syllabus” ek
        ESTIMATE hai (video ke title + description ko aapke topics se match karke) — dekh ke khud
        confirm karo. Agar API available nahi (jaise quota khatam), toh har card sirf search
        suggestion rahega.
      </p>

      {/* --------------------------- coverage tracker --------------------------- */}
      <div
        className="mt-3 rounded-xl border px-3.5 py-3"
        style={{ borderColor: "var(--line)", background: "var(--surface-2)" }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-extrabold">Syllabus coverage tracker</p>
          <p className="text-[0.72rem] font-bold">
            {coveredCount}/{topics.length} covered · {pct}%
          </p>
        </div>
        <div
          className="mt-2 h-2 w-full overflow-hidden rounded-full"
          style={{ background: "var(--surface)" }}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={topics.length || 1}
          aria-valuenow={coveredCount}
          aria-label="Syllabus coverage"
        >
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: `${pct}%`,
              background: "linear-gradient(90deg, var(--brand), var(--brand-2))",
            }}
          />
        </div>
        <p className="mt-1.5 text-[0.7rem] leading-relaxed text-[var(--muted)]">
          Progress sirf aapke apne tick se badhta hai — search link generate hone se topic covered
          nahi hota. Watched ka matlab hai lecture dekha; covered tabhi jab concept samajh aa gaya.
        </p>

        {pendingTopics.length > 0 ? (
          <div className="mt-2.5">
            <p className="text-xs font-bold">
              Pending topics ({pendingTopics.length}) — abhi cover nahi hue:
            </p>
            <ul aria-label="Pending topics" className="mt-1.5 flex flex-wrap gap-1.5">
              {pendingTopics.map((topic) => (
                <li key={topic.id}>
                  <button
                    type="button"
                    onClick={() => onJump(topic.id)}
                    title={topic.title}
                    aria-label={`Pending topic: ${topic.title}`}
                    className="chip max-w-[14rem] truncate font-semibold"
                    style={{ color: BAND_COLOR[bandFor(topic)] }}
                  >
                    {topic.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p
            className="mt-2.5 text-xs font-extrabold"
            style={{ color: "var(--brand)" }}
          >
            ✓ Poora syllabus covered — {coveredCount}/{topics.length} topics, koi topic pending
            nahi.
          </p>
        )}
      </div>

      {/* ----------------- smart tab without papers: honest banner ----------------- */}
      {active === "smart" && !priority.hasPapers && (
        <div
          className="mt-3 rounded-xl border border-dashed px-4 py-3 text-center"
          style={{ borderColor: "var(--line)" }}
        >
          <p className="text-sm font-bold">PYQ-based prioritisation abhi unavailable hai</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
            Bina PYQ papers ke koi priority label invent nahi kiya gaya — ye suggestions syllabus
            order me hain. Papers daalo, phir aapke sabse important topics pehle recommend honge.
            Har topic yahan dikh rahe hain, koi chhupa nahi gaya.
          </p>
        </div>
      )}

      {/* -------------------------------- filters -------------------------------- */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <select
          value={unitFilter}
          onChange={(e) => setUnitFilter(e.target.value)}
          className="field px-2.5 py-1.5 text-[0.72rem]"
          aria-label="Filter by unit"
        >
          <option value="all">All units</option>
          {units.map((unit) => (
            <option key={unit} value={unit}>
              {unit}
            </option>
          ))}
        </select>

        {priority.hasPapers && (
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="field px-2.5 py-1.5 text-[0.72rem]"
            aria-label="Filter by priority"
          >
            <option value="all">All priorities</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
            <option value="unobserved">Not observed</option>
          </select>
        )}

        <select
          value={coverageFilter}
          onChange={(e) => setCoverageFilter(e.target.value as CoverageFilter)}
          className="field px-2.5 py-1.5 text-[0.72rem]"
          aria-label="Filter by coverage"
        >
          <option value="all">All coverage</option>
          <option value="pending">Has pending topics</option>
          <option value="covered">Fully covered</option>
        </select>

        <select
          value={watchedFilter}
          onChange={(e) => setWatchedFilter(e.target.value as WatchedFilter)}
          className="field px-2.5 py-1.5 text-[0.72rem]"
          aria-label="Filter by watched"
        >
          <option value="all">All watched states</option>
          <option value="pending">Not watched</option>
          <option value="watched">Watched</option>
        </select>

        {filtersActive && (
          <button type="button" onClick={clearFilters} className="btn-ghost px-2.5 py-1.5 text-[0.72rem]">
            Clear filters
          </button>
        )}
      </div>

      {/* ------------------------- recommendation cards ------------------------- */}
      {filtered.length === 0 ? (
        <div
          className="mt-3 rounded-xl border border-dashed px-4 py-6 text-center text-sm text-[var(--muted)]"
          style={{ borderColor: "var(--line)" }}
        >
          {plan.recommendations.length === 0
            ? "Abhi koi lecture suggestion nahi bana — sab topics already studied hain ya titles me searchable words nahi mile."
            : "Is filter se koi suggestion nahi mila — filter badlo ya Clear filters dabao."}
        </div>
      ) : (
        <ol className="mt-3 space-y-2.5">
          {filtered.map((info, index) => {
            const { rec, recTopics, coveredIn, fullyCovered, watched } = info;
            const smart = active === "smart" && rec.priority;
            const meta = rec.priority ? PRIORITY_META[rec.priority] : null;
            const videos = liveVideos?.byKey[rec.id] ?? [];
            const videoStatus = liveVideos?.status ?? "loading";
            return (
              <li
                key={rec.id}
                data-rec-id={rec.id}
                className="rounded-xl border px-3.5 py-3"
                style={{ borderColor: "var(--line)", background: "var(--surface-2)" }}
              >
                <div className="flex items-start gap-2.5">
                  <span
                    className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[0.7rem] font-extrabold text-white"
                    style={{
                      background: "linear-gradient(135deg, var(--brand), var(--brand-2))",
                    }}
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-extrabold leading-snug">{rec.title}</p>

                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <span className="chip">{rec.unit}</span>
                      <span className="chip font-bold" style={{ color: "var(--brand)" }}>
                        {rec.label}
                      </span>
                      {smart && meta && (
                        <span
                          className="chip font-bold"
                          style={{
                            color: meta.color,
                            borderColor: `color-mix(in srgb, ${meta.color} 50%, var(--line))`,
                          }}
                        >
                          {meta.label}
                        </span>
                      )}
                      <span className="chip">
                        {recTopics.length} topic{recTopics.length === 1 ? "" : "s"} covered
                      </span>
                      <span className="chip">
                        {coveredIn}/{recTopics.length} student-covered
                      </span>
                      {fullyCovered && (
                        <span className="chip font-bold" style={{ color: "var(--brand)" }}>
                          ✓ All covered
                        </span>
                      )}
                      {watched && (
                        <span className="chip font-bold" style={{ color: "var(--brand)" }}>
                          Watched ✓
                        </span>
                      )}
                    </div>

                    <p
                      className="rec-query mt-1.5 truncate rounded-lg border px-2.5 py-1.5 text-[0.72rem] font-semibold"
                      style={{ borderColor: "var(--line)", background: "var(--surface)" }}
                      title="YouTube search query"
                    >
                      🔍 {rec.query}
                    </p>
                    {videos.length > 0 ? (
                      <p className="mt-1 text-[0.68rem] leading-relaxed text-[var(--muted)]">
                        Asli YouTube results (top {videos.length}) — title/channel/views sach;
                        ranking humari analysis se.{" "}
                        <b style={{ color: "var(--warn)" }}>% syllabus</b> ek estimate hai (title +
                        description matching) — video dekh ke khud confirm karo. Aur results ke
                        liye search link neeche.
                      </p>
                    ) : (
                      <p className="mt-1 text-[0.68rem] leading-relaxed text-[var(--muted)]">
                        {videoStatus === "loading"
                          ? "YouTube se real videos load ho rahe hain…"
                          : `YouTube API abhi available nahi (${apiReasonLabel(liveVideos?.reason)}) — ye YouTube search suggestion hai, results me se khud suitable lecture chuno.`}
                      </p>
                    )}

                    {videos.length > 0 && (
                      <ul aria-label="Video suggestions" className="mt-2 space-y-1.5">
                        {videos.map((v) => (
                          <li
                            key={v.id}
                            data-video-id={v.id}
                            className="flex gap-2.5 rounded-lg border px-2.5 py-2"
                            style={{ borderColor: "var(--line)", background: "var(--surface)" }}
                          >
                            {/* Raw CDN src kept (not next/image): the card shows a
                                96×54 lazy thumb and tests verify the real
                                i.ytimg.com URL — an optimizer proxy hop would
                                add cost/indirection for zero gain here. */}
                            {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
                            <img
                              src={v.thumb}
                              alt=""
                              width={96}
                              height={54}
                              loading="lazy"
                              className="h-[54px] w-24 shrink-0 rounded-md object-cover"
                              style={{ background: "var(--surface-2)" }}
                            />
                            <div className="min-w-0 flex-1">
                              <a
                                href={v.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block truncate text-xs font-extrabold hover:underline"
                                aria-label={`Watch: ${v.title}`}
                                title={v.title}
                              >
                                {v.title}
                              </a>
                              <p className="mt-0.5 truncate text-[0.66rem] text-[var(--muted)]">
                                {v.channel} · {formatDuration(v.durationSec)} ·{" "}
                                {formatViews(v.views)} views
                                {v.published ? ` · ${v.published.slice(0, 4)}` : ""}
                              </p>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <span
                                  className="chip font-bold"
                                  style={{ color: "var(--brand)" }}
                                  title="Title + description matching se estimate — video dekh ke confirm karo"
                                >
                                  ≈{v.coveragePct}% syllabus
                                </span>
                                <span className="chip" title={v.matchedTopics.join(" · ")}>
                                  {v.matchedTopics.length}/{topics.length} topics
                                </span>
                              </div>
                              {v.matchedTopics.length > 0 && (
                                <p
                                  className="mt-1 truncate text-[0.66rem] leading-snug text-[var(--muted)]"
                                  title={v.matchedTopics.join(" · ")}
                                >
                                  ✓ Covers: {v.matchedTopics.slice(0, 3).join(", ")}
                                  {v.matchedTopics.length > 3
                                    ? ` +${v.matchedTopics.length - 3} more`
                                    : ""}
                                </p>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}

                    <ul className="mt-2 space-y-1.5">
                      {recTopics.map((topic) => {
                        const band = bandFor(topic);
                        const subs = subtopicsByTopicId[topic.id];
                        const covered = isCovered(topic.title);
                        const row = smart ? priorityById.get(topic.id) : undefined;
                        return (
                          <li
                            key={topic.id}
                            data-topic-row={topic.id}
                            className="flex flex-wrap items-center gap-1.5 rounded-lg border px-2.5 py-1.5"
                            style={{ borderColor: "var(--line)", background: "var(--surface)" }}
                          >
                            <span
                              className="chip shrink-0 font-bold"
                              style={{
                                color: BAND_COLOR[band],
                                borderColor: `color-mix(in srgb, ${BAND_COLOR[band]} 50%, var(--line))`,
                              }}
                            >
                              {BAND_LABEL[band]}
                            </span>
                            <span
                              className="min-w-0 flex-1 truncate text-xs font-bold"
                              title={topic.title}
                            >
                              {topic.title}
                            </span>
                            {subs && subs.length > 0 && (
                              <span
                                className="chip shrink-0"
                                title={subs.join(" · ")}
                              >
                                +{subs.length} sub
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => toggleCovered(topic.title)}
                              aria-label={
                                covered ? `Remove covered: ${topic.title}` : `Mark covered: ${topic.title}`
                              }
                              className="btn-ghost shrink-0 px-2 py-1 text-[0.66rem]"
                              style={covered ? { color: "var(--brand)" } : undefined}
                            >
                              {covered ? "✓ Covered" : "Mark covered"}
                            </button>
                            <button
                              type="button"
                              onClick={() => onJump(topic.id)}
                              aria-label={`Topic par jao: ${topic.title}`}
                              className="btn-ghost shrink-0 px-2 py-1 text-[0.66rem]"
                            >
                              ↗
                            </button>
                            {row && (
                              <p className="rec-reason w-full text-[0.68rem] leading-snug text-[var(--muted)]">
                                {row.reason}
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ul>

                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <a
                        href={rec.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-[0.72rem]"
                      >
                        Open on YouTube <ExternalIcon width={12} height={12} />
                      </a>
                      <button
                        type="button"
                        onClick={() => toggleWatched(rec.id)}
                        aria-label={
                          watched ? `Remove watched: ${rec.title}` : `Mark watched: ${rec.title}`
                        }
                        className="btn-ghost px-3 py-1.5 text-[0.72rem]"
                        style={watched ? { color: "var(--brand)" } : undefined}
                      >
                        {watched ? "Undo watched" : "Mark lecture watched"}
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {/* ----------------- honest gap lists — nothing hidden ----------------- */}
      {(noRecTopics.length > 0 || studiedTopics.length > 0) && (
        <div
          className="mt-3 rounded-xl border px-3.5 py-3"
          style={{ borderColor: "var(--line)" }}
        >
          {noRecTopics.length > 0 && (
            <div>
              <p className="text-xs font-extrabold">No suitable recommendation ({noRecTopics.length})</p>
              <ul aria-label="No suitable recommendation" className="mt-1.5 space-y-1">
                {plan.noRec.map((entry) => {
                  const topic = topicById.get(entry.topicId);
                  if (!topic) return null;
                  const covered = isCovered(topic.title);
                  return (
                    <li
                      key={entry.topicId}
                      className="flex flex-wrap items-center gap-2 text-[0.7rem] leading-relaxed text-[var(--muted)]"
                    >
                      <span className="min-w-0 flex-1">
                        <b className="text-[var(--warn)]">{topic.title}</b> — {entry.reason}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleCovered(topic.title)}
                        aria-label={
                          covered ? `Remove covered: ${topic.title}` : `Mark covered: ${topic.title}`
                        }
                        className="btn-ghost shrink-0 px-2 py-1 text-[0.66rem]"
                        style={covered ? { color: "var(--brand)" } : undefined}
                      >
                        {covered ? "✓ Covered" : "Mark covered"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {studiedTopics.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-bold">Already studied — lecture skipped ({studiedTopics.length})</p>
              <ul aria-label="Studied, lecture skipped" className="mt-1.5 space-y-1">
                {studiedTopics.map((topic) => {
                  const covered = isCovered(topic.title);
                  return (
                    <li
                      key={topic.id}
                      className="flex flex-wrap items-center gap-2 text-[0.7rem] leading-relaxed text-[var(--muted)]"
                    >
                      <span className="min-w-0 flex-1">
                        {topic.title} — study progress alag track me hai, isliye lecture suggestion
                        skip kiya gaya.
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleCovered(topic.title)}
                        aria-label={
                          covered ? `Remove covered: ${topic.title}` : `Mark covered: ${topic.title}`
                        }
                        className="btn-ghost shrink-0 px-2 py-1 text-[0.66rem]"
                        style={covered ? { color: "var(--brand)" } : undefined}
                      >
                        {covered ? "✓ Covered" : "Mark covered"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ---------------------- how these suggestions were built ---------------------- */}
      <div className="mt-3">
        <p className="text-[0.68rem] font-extrabold uppercase tracking-wide text-[var(--muted)]">
          Kaise bane ye suggestions
        </p>
        <ul className="mt-1 space-y-0.5 text-[0.7rem] leading-relaxed text-[var(--muted)]">
          {plan.notes.map((note, index) => (
            <li key={index}>• {note}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
