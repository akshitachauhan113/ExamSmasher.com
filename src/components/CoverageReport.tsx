"use client";

import type { PyqQuestion, Topic, TopicResult } from "@/lib/types";

interface CoverageReportProps {
  topics: Topic[];
  results: Record<string, TopicResult>;
  /** Real past questions per topic — empty means no paper ever asked it. */
  pyqByTopic: Map<string, PyqQuestion[]>;
  onJumpToTopic: (topicId: string) => void;
}

/**
 * The honest half of the PYQ analysis.
 *
 * A topic with NO real past questions is a genuine finding, not a failure:
 * either the syllabus is bigger than these papers, or the topic is genuinely
 * low-yield. Either way the student deserves to be told which topics their
 * papers never touched, instead of being shown a confident-looking priority
 * with no evidence behind it.
 *
 * Topics the student already studied are excluded — that is a choice, not a
 * gap.
 */
export function CoverageReport({
  topics,
  results,
  pyqByTopic,
  onJumpToTopic,
}: CoverageReportProps) {
  const withoutPyq = topics.filter((topic) => (pyqByTopic.get(topic.id)?.length ?? 0) === 0);

  if (withoutPyq.length === 0) return null;

  const withPyq = topics.length - withoutPyq.length;

  return (
    <section className="card mt-6">
      <header className="border-b border-[var(--line)] px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[1.05rem] font-extrabold">
            🧩 {withoutPyq.length} topic{withoutPyq.length > 1 ? "s" : ""} par abhi tak koi asli
            PYQ nahi mila
          </h2>
          <span className="chip">
            {withPyq}/{topics.length} topics with real PYQs
          </span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
          Ye topic aapke upload kiye hue papers me kabhi nahi aaye — <strong className="text-[var(--text)]">ye
          sachcha evidence hai</strong>, guess nahi. Ya toh aapke papers poori syllabus cover nahi
          karte, ya ye topics genuinely low-yield hain. Neeche har topic ka apna syllabus text hai —
          usi se padho, aur chahiye toh YouTube search link se ek video chuno.
        </p>
      </header>

      <ol className="divide-y divide-[var(--line)]">
        {withoutPyq.map((topic) => {
          const result = results[topic.id];
          const search = result?.searches?.[0];

          return (
            <li key={topic.id} className="px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[0.9rem] font-bold leading-snug">{topic.title}</p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    {topic.chapter ? `${topic.chapter} · ` : ""}
                    {topic.importance} · {topic.difficulty} · ~{topic.estimatedMinutes} min
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onJumpToTopic(topic.id)}
                  className="btn-ghost shrink-0 px-2.5 py-1.5 text-xs"
                >
                  Padhne jaao →
                </button>
              </div>

              <div className="mt-2 rounded-lg px-2.5 py-2" style={{ background: "var(--surface-2)" }}>
                <p className="text-[0.7rem] font-extrabold uppercase tracking-wide text-[var(--muted)]">
                  Syllabus me iske andar ye hai
                </p>
                <p className="mt-1 text-xs leading-relaxed">
                  {topic.description ||
                    "Is topic ka syllabus text chhota hai — topic panel ke notes dekho."}
                </p>
              </div>

              {search ? (
                <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
                  Ek video dhoondhna ho toh:{" "}
                  <a
                    href={search.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold underline"
                    style={{ color: "var(--brand)" }}
                  >
                    YouTube search: {search.query}
                  </a>{" "}
                  <span className="text-[0.68rem]">(naye tab me khulega — results YouTube ke
                  hain, humne nahi chune)</span>
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
