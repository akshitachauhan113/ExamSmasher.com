"use client";

import { ExternalIcon } from "@/components/Icons";
import { TabBar } from "./TabBar";
import { BAND_LABEL } from "@/lib/exam";
import type { ExamPlanResponse, ExamTopic, Topic, TopicResult } from "@/lib/types";

export type PlaylistTab = "complete" | "smart";

interface PlaylistBoardProps {
  /** Syllabus order — the "complete" playlist walks the whole course. */
  topics: Topic[];
  /** Priority order — the "smart" playlist follows the exam plan. */
  priorityTopics: Topic[];
  results: Record<string, TopicResult>;
  bandFor: (topic: Topic) => ExamTopic["band"];
  plan: ExamPlanResponse | null;
  active: PlaylistTab;
  onChange: (tab: PlaylistTab) => void;
  onJump: (topicId: string) => void;
}

const BAND_COLOR: Record<ExamTopic["band"], string> = {
  must: "var(--bad)",
  should: "var(--warn)",
  "if-time": "var(--muted)",
};

/**
 * The two playlists, as a prominent two-tab view.
 *
 * Everything shown is counted from the student's own analysis: which topics
 * have links, which band they are in, and what their papers said. There is no
 * YouTube API here, so no video is ever claimed as "verified" — the note
 * below the tabs says exactly that, and every link opens YouTube's own
 * results page.
 */
export function PlaylistBoard({
  topics,
  priorityTopics,
  results,
  bandFor,
  plan,
  active,
  onChange,
  onJump,
}: PlaylistBoardProps) {
  const list = active === "complete" ? topics : priorityTopics;
  const withLinks = topics.filter((t) => (results[t.id]?.searches?.length ?? 0) > 0).length;
  const totalLinks = topics.reduce((sum, t) => sum + (results[t.id]?.searches?.length ?? 0), 0);
  const mustCount = topics.filter((t) => bandFor(t) === "must").length;

  const planById = new Map<string, ExamTopic>();
  for (const entry of plan?.topics ?? []) planById.set(entry.topic.id, entry);

  const hasAnyResult = Object.values(results).some((r) => (r.searches?.length ?? 0) > 0);

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[1.05rem] font-extrabold">🎬 Video playlists</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">
            Har topic ke YouTube search links — complete syllabus ke hisaab se, ya exam priority ke
            hisaab se.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className="chip">
            {withLinks}/{topics.length} topics covered
          </span>
          <span className="chip">{totalLinks} links</span>
          <span className="chip" style={{ color: "var(--brand)" }}>
            {mustCount} must-do
          </span>
        </div>
      </div>

      <div className="mt-3">
        <TabBar
          ariaLabel="Playlist type"
          active={active}
          onChange={(id) => onChange(id as PlaylistTab)}
          tabs={[
            { id: "complete", label: "Complete Syllabus Playlist", badge: String(topics.length) },
            { id: "smart", label: "Smart Exam Playlist", badge: String(mustCount) },
          ]}
        />
      </div>

      <p className="mt-1.5 text-[0.68rem] leading-relaxed text-[var(--muted)]">
        ⚠️ Koi video verify ya rank nahi kiya gaya (koi YouTube API nahi hai) — har link YouTube ke
        apne results page kholta hai, jo wahan dikhe wahi dekhna.
      </p>

      {!hasAnyResult ? (
        <div className="mt-3 rounded-xl border border-dashed px-4 py-6 text-center text-sm text-[var(--muted)]" style={{ borderColor: "var(--line)" }}>
          Search links abhi nahi bane — analysis complete karo (ya PYQ step skip karo), phir yahan
          dono playlists mil jayengi.
        </div>
      ) : (
        <ol className="mt-3 space-y-2.5">
          {list.map((topic, index) => {
            const result = results[topic.id];
            const searches = result?.searches ?? [];
            const band = bandFor(topic);
            const entry = planById.get(topic.id);
            return (
              <li
                key={topic.id}
                className="rounded-xl border px-3.5 py-3"
                style={{ borderColor: "var(--line)", background: "var(--surface-2)" }}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-1 items-start gap-2.5">
                    <span
                      className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[0.7rem] font-extrabold text-white"
                      style={{
                        background:
                          active === "smart" && entry
                            ? "linear-gradient(135deg, var(--brand), var(--brand-2))"
                            : BAND_COLOR[band],
                      }}
                    >
                      {active === "smart" && entry ? entry.priority : index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-extrabold leading-snug">{topic.title}</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <span
                          className="chip font-bold"
                          style={{
                            color: BAND_COLOR[band],
                            borderColor: `color-mix(in srgb, ${BAND_COLOR[band]} 50%, var(--line))`,
                          }}
                        >
                          {BAND_LABEL[band]}
                        </span>
                        {topic.chapter && <span className="chip">{topic.chapter}</span>}
                        {entry && entry.signal.trend !== "rare" && (
                          <span className="chip">
                            {entry.signal.appearances} papers · {entry.signal.totalMarks} marks
                          </span>
                        )}
                        {entry && <span className="chip">~{entry.minutes} min</span>}
                        <span className="chip">
                          {searches.length > 0 ? `${searches.length} links` : "no links yet"}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onJump(topic.id)}
                    className="btn-ghost shrink-0 px-2.5 py-1.5 text-[0.7rem]"
                  >
                    Topic par jao ↗
                  </button>
                </div>

                {searches.length > 0 ? (
                  <ul className="mt-2.5 space-y-1.5">
                    {searches.map((search) => (
                      <li key={search.url}>
                        <a
                          href={search.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between gap-3 rounded-lg border bg-[var(--surface)] px-3 py-2 text-xs transition-colors hover:bg-[var(--surface-2)]"
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
                          <ExternalIcon width={13} height={13} className="shrink-0" />
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2.5 rounded-lg border border-dashed px-3 py-2 text-[0.72rem] text-[var(--muted)]" style={{ borderColor: "var(--line)" }}>
                    {result?.skipped
                      ? "Is topic ko aapne already studied mark kiya hai — isliye links skip kiye."
                      : "Links abhi bane nahi — analysis complete hone par mil jayenge."}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
