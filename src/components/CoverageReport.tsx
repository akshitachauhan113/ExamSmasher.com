"use client";

import type { PyqQuestion, Topic, TopicResult } from "@/lib/types";

interface CoverageReportProps {
  topics: Topic[];
  results: Record<string, TopicResult>;
  /** Real past questions per topic, so uncovered topics still show what's asked. */
  pyqByTopic: Map<string, PyqQuestion[]>;
  onJumpToTopic: (topicId: string) => void;
}

/**
 * The honest half of video matching.
 *
 * Search can fail — YouTube's daily quota runs out, or a niche syllabus topic
 * simply has no good video. Rather than silently showing empty panels, this
 * names exactly which topics are missing and hands the student a way to cover
 * them without videos: their own past questions, plus where the notes live.
 *
 * A topic the student marked as already-known is excluded — that is a choice,
 * not a gap.
 */
export function CoverageReport({
  topics,
  results,
  pyqByTopic,
  onJumpToTopic,
}: CoverageReportProps) {
  const missing = topics.filter((topic) => {
    const result = results[topic.id];
    if (!result || result.skipped) return false;
    return Boolean(result.error) || result.videos.length === 0;
  });

  if (missing.length === 0) return null;

  const covered = topics.length - missing.length;
  const quotaHit = missing.some((t) => /quota|daily API/i.test(results[t.id]?.error ?? ""));

  return (
    <section className="card mt-6">
      <header className="border-b border-[var(--line)] px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[1.05rem] font-extrabold">🧩 Ye portion reh gaya</h2>
          <span className="chip">
            {covered}/{topics.length} topics covered
          </span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
          In {missing.length} topic{missing.length > 1 ? "s" : ""} ke liye koi video nahi mil paayi
          — mat chhodo.{" "}
          <strong className="text-[var(--text)]">
            Neeche har topic ke apne PYQs diye hain
          </strong>
          , unse padh lo, phir topic panel ki{" "}
          <strong className="text-[var(--text)]">3-level notes</strong> se revise kar lo. Ho jayega.
        </p>

        {quotaHit && (
          <p
            className="mt-2 flex items-start gap-1.5 rounded-lg px-2.5 py-2 text-xs leading-relaxed"
            style={{
              background: "color-mix(in srgb, var(--warn) 12%, transparent)",
            }}
          >
            ⚠️ <span><strong>YouTube ka daily quota khatam ho gaya.</strong> Ye topics kal tak
            dobara chal sakte hain — header se <em>Re-match</em> maar dena. Aaj ke liye neeche se
            padh lo.</span>
          </p>
        )}
      </header>

      <ol className="divide-y divide-[var(--line)]">
        {missing.map((topic) => {
          const result = results[topic.id];
          const questions = pyqByTopic.get(topic.id) ?? [];
          const reason = result?.error
            ? shortReason(result.error)
            : "Search me koi achhi video nahi mili.";

          return (
            <li key={topic.id} className="px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[0.9rem] font-bold leading-snug">{topic.title}</p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">{reason}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onJumpToTopic(topic.id)}
                  className="btn-ghost shrink-0 px-2.5 py-1.5 text-xs"
                >
                  Padhne jaao →
                </button>
              </div>

              {questions.length > 0 ? (
                <div className="mt-2 rounded-lg px-2.5 py-2" style={{ background: "var(--surface-2)" }}>
                  <p className="text-[0.7rem] font-extrabold uppercase tracking-wide text-[var(--muted)]">
                    Ye exam me aata hai
                  </p>
                  <ul className="mt-1 space-y-1">
                    {questions.slice(0, 3).map((q) => (
                      <li key={q.id} className="flex gap-1.5 text-xs leading-relaxed">
                        <span className="shrink-0" style={{ color: "var(--brand)" }}>
                          •
                        </span>
                        <span>
                          {q.text}
                          {q.marks && (
                            <span className="text-[var(--muted)]"> ({q.marks} marks)</span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
                  Is topic ke PYQ map nahi hue the — syllabus ke heading se hi padh lo. Notes ka{" "}
                  <strong className="text-[var(--text)]">Short</strong> level kaafi rahega.
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Turns a raw API error into something a student can act on. */
function shortReason(error: string): string {
  if (/quota|daily API/i.test(error)) return "YouTube daily quota khatam — kal chal jaayega.";
  if (/API key|API_KEY|key.*invalid/i.test(error)) return "YouTube API key set nahi hai.";
  if (/network|fetch|ENOTFOUND|ECONN/i.test(error)) return "Internet ka issue tha — dobara try karo.";
  if (/access/i.test(error)) return "YouTube API access nahi mila — API key check karo.";
  return "Video search fail ho gaya.";
}
