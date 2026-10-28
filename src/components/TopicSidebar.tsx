"use client";

import type { Topic, TopicResult } from "@/lib/types";
import { AlertIcon, BookIcon, CheckIcon } from "./Icons";

interface TopicSidebarProps {
  topics: Topic[];
  results: Record<string, TopicResult>;
  activeId: string | null;
  onJump: (id: string) => void;
  phase: "idle" | "analyzing" | "matching" | "done";
  completed: number;
  videoCount: number;
  studiedCount: number;
  isStudied: (title: string) => boolean;
  onToggleStudied: (title: string) => void;
}

const IMPORTANCE_STYLE: Record<string, { label: string; color: string }> = {
  core: { label: "core", color: "var(--bad)" },
  important: { label: "important", color: "var(--warn)" },
  bonus: { label: "bonus", color: "var(--muted)" },
};

export function TopicSidebar({
  topics,
  results,
  activeId,
  onJump,
  phase,
  completed,
  videoCount,
  studiedCount,
  isStudied,
  onToggleStudied,
}: TopicSidebarProps) {
  const matchPercent = topics.length ? Math.round((completed / topics.length) * 100) : 0;
  const studyPercent = topics.length ? Math.round((studiedCount / topics.length) * 100) : 0;

  return (
    <aside className="lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-1">
      <div className="card p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="flex items-center gap-2 text-sm font-extrabold uppercase tracking-wide text-[var(--muted)]">
            <BookIcon width={16} height={16} /> Topics found
          </h3>
          <div className="text-right leading-tight">
            <span className="block text-sm font-bold">{topics.length} topics</span>
            <span className="block text-[0.68rem] font-semibold" style={{ color: "var(--brand)" }}>
              {videoCount} videos matched
            </span>
          </div>
        </div>

        {/* Study progress — how much of the syllabus is done */}
        <div className="mt-3">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-semibold">Syllabus covered</span>
            <span className="font-extrabold" style={{ color: "var(--good)" }}>
              {studyPercent}%
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${studyPercent}%`,
                background: "linear-gradient(90deg, var(--good), #22c55e)",
              }}
            />
          </div>
          <p className="mt-1.5 text-xs text-[var(--muted)]">
            {studiedCount}/{topics.length} topics padhe ·{" "}
            {topics.length - studiedCount} baaki
          </p>
        </div>

        {/* Match progress — videos being found */}
        <div className="mt-3">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-[var(--muted)]">Videos matched</span>
            <span className="font-bold text-[var(--muted)]">
              {completed}/{topics.length}
            </span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${matchPercent}%`,
                background: "linear-gradient(90deg, var(--brand), var(--brand-2))",
              }}
            />
          </div>
        </div>

        <p className="mt-3 text-xs text-[var(--muted)]">
          {phase === "analyzing" && "Reading your syllabus with AI…"}
          {phase === "matching" && "Searching & matching videos, one topic at a time…"}
          {phase === "done" &&
            (studiedCount === topics.length
              ? "Poori syllabus cover ho gayi — badhiya! 🎉"
              : "Tick karte jao jo padh chuke ho — progress save rehta hai.")}
        </p>

        <ul className="mt-3 space-y-1.5">
          {topics.map((topic, index) => {
            const result = results[topic.id];
            const isActive = activeId === topic.id;
            const done = isStudied(topic.title);
            const importance = IMPORTANCE_STYLE[topic.importance] ?? IMPORTANCE_STYLE.important;

            return (
              <li key={topic.id}>
                <div
                  className="flex w-full items-stretch rounded-xl border transition-all"
                  style={{
                    borderColor: isActive
                      ? "color-mix(in srgb, var(--brand) 55%, var(--line))"
                      : "var(--line)",
                    background: isActive
                      ? "color-mix(in srgb, var(--brand) 9%, var(--surface))"
                      : "var(--surface)",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onJump(topic.id)}
                    className="min-w-0 flex-1 px-3 py-2.5 text-left"
                    aria-current={isActive}
                  >
                    <div className="flex items-start gap-2.5">
                      <span
                        className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md text-[0.68rem] font-bold text-white"
                        style={{ background: done ? "var(--good)" : "var(--brand)" }}
                      >
                        {done ? <CheckIcon width={13} height={13} /> : index + 1}
                      </span>

                      <div className="min-w-0 flex-1">
                        <p
                          className="truncate text-sm font-semibold"
                          title={topic.title}
                          style={done ? { textDecoration: "line-through", color: "var(--muted)" } : undefined}
                        >
                          {topic.title}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span
                            className="text-[0.66rem] font-bold uppercase tracking-wide"
                            style={{ color: importance.color }}
                          >
                            ● {importance.label}
                          </span>
                          <span className="text-[0.68rem] text-[var(--muted)]">
                            {topic.difficulty}
                          </span>
                          <span className="text-[0.68rem] text-[var(--muted)]">
                            · {topic.estimatedMinutes}m
                          </span>
                        </div>
                      </div>

                      <span className="mt-0.5 shrink-0">
                        {result?.error ? (
                          <span className="text-[var(--bad)]" title={result.error}>
                            <AlertIcon width={15} height={15} />
                          </span>
                        ) : result ? (
                          <span
                            className="text-[var(--good)]"
                            title={`${result.videos.length} videos matched`}
                          >
                            <CheckIcon width={15} height={15} />
                          </span>
                        ) : (
                          <span className="block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--line)] border-t-[var(--brand)]" />
                        )}
                      </span>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => onToggleStudied(topic.title)}
                    aria-pressed={done}
                    title={done ? "Padh liya — hatao" : "Mark as already studied"}
                    className="grid w-10 shrink-0 place-items-center border-l border-[var(--line)]"
                    style={{ color: done ? "var(--good)" : "var(--muted)" }}
                  >
                    <span
                      className="grid h-4 w-4 place-items-center rounded border"
                      style={{
                        borderColor: done ? "var(--good)" : "var(--line)",
                        background: done ? "var(--good)" : "transparent",
                      }}
                    >
                      {done && <CheckIcon width={12} height={12} />}
                    </span>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}
