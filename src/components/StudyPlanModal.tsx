"use client";

import { useEffect, useMemo } from "react";
import { usePlanChecks } from "@/hooks/usePlanChecks";
import { renderMarkdown } from "@/lib/markdown";
import type { PlanDay, PlanResponse } from "@/lib/types";
import { CloseIcon, RefreshIcon } from "./Icons";

interface StudyPlanModalProps {
  open: boolean;
  loading: boolean;
  plan: PlanResponse | null;
  error: string | null;
  onClose: () => void;
  onRegenerate: () => void;
}

function dayMinutes(day: PlanDay): number {
  return day.items.reduce((sum, item) => sum + item.minutes, 0);
}

function formatTotal(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Interactive daily planner.
 *
 * The AI plan arrives as structured days; each item is a checkbox that
 * persists in localStorage, so the student can track a multi-day plan as
 * they go. The raw Markdown is still available for copy/export.
 */
export function StudyPlanModal({
  open,
  loading,
  plan,
  error,
  onClose,
  onRegenerate,
}: StudyPlanModalProps) {
  const { isChecked, toggle } = usePlanChecks();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  const days = useMemo(() => plan?.days ?? [], [plan]);
  const planId = useMemo(
    () => `plan-${days.length}-${days[0]?.focus ?? ""}`.slice(0, 60),
    [days],
  );

  const progress = useMemo(() => {
    let total = 0;
    let done = 0;
    days.forEach((day, di) => {
      day.items.forEach((_, ii) => {
        total += 1;
        if (isChecked(planId, di + 1, ii)) done += 1;
      });
    });
    return { total, done, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
  }, [days, isChecked, planId]);

  if (!open) return null;

  const totalMinutes = days.reduce((sum, day) => sum + dayMinutes(day), 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="AI daily study planner"
    >
      <div
        className="card flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header
          className="flex items-center justify-between gap-3 border-b px-5 py-4"
          style={{ borderColor: "var(--line)" }}
        >
          <div>
            <h2 className="text-base font-extrabold">🗓️ Daily study planner</h2>
            <p className="text-xs text-[var(--muted)]">
              {days.length > 0
                ? `${days.length} days · ${formatTotal(totalMinutes)} total · tick items as you finish them`
                : "Built from your top-picked videos, spaced over realistic daily sessions."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close planner"
            className="btn-ghost grid h-9 w-9 place-items-center"
          >
            <CloseIcon width={16} height={16} />
          </button>
        </header>

        {/* Overall progress */}
        {days.length > 0 && (
          <div className="border-b px-5 py-3" style={{ borderColor: "var(--line)" }}>
            <div className="flex items-center justify-between text-xs font-bold">
              <span>
                {progress.done}/{progress.total} tasks done
              </span>
              <span style={{ color: "var(--good)" }}>{progress.pct}%</span>
            </div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${progress.pct}%`, background: "var(--good)" }}
              />
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="space-y-3 py-2">
              <div className="skeleton h-5 w-2/3 rounded" />
              <div className="skeleton h-3 w-full rounded" />
              <div className="skeleton h-3 w-5/6 rounded" />
              <div className="skeleton h-32 w-full rounded-xl" />
              <div className="skeleton h-3 w-1/2 rounded" />
              <p className="pt-2 text-center text-xs text-[var(--muted)]">
                Planning your days — foundations first…
              </p>
            </div>
          )}

          {error && (
            <p
              className="rounded-xl border px-3 py-2.5 text-sm"
              style={{
                borderColor: "color-mix(in srgb, var(--bad) 40%, var(--line))",
                color: "var(--bad)",
              }}
            >
              {error}
            </p>
          )}

          {!loading && !error && days.length === 0 && (
            <p className="py-6 text-center text-sm text-[var(--muted)]">
              The plan came back empty — hit Regenerate to try again.
            </p>
          )}

          {!loading && days.length > 0 && (
            <div className="space-y-3">
              {days.map((day) => {
                const minutes = dayMinutes(day);
                const dayDone = day.items.filter((_, ii) => isChecked(planId, day.day, ii)).length;
                const complete = dayDone === day.items.length;
                return (
                  <section
                    key={day.day}
                    className="rounded-2xl border p-4"
                    style={{
                      borderColor: complete
                        ? "color-mix(in srgb, var(--good) 55%, var(--line))"
                        : "var(--line)",
                      background: complete ? "color-mix(in srgb, var(--good) 6%, transparent)" : "transparent",
                    }}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="flex items-center gap-2 text-sm font-extrabold">
                        <span
                          className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[0.7rem]"
                          style={{
                            background: complete ? "var(--good)" : "var(--brand)",
                            color: "#fff",
                          }}
                        >
                          {day.day}
                        </span>
                        {day.focus || `Day ${day.day}`}
                      </h3>
                      <span className="shrink-0 text-xs text-[var(--muted)]">
                        {dayDone}/{day.items.length} · {minutes} min
                      </span>
                    </div>

                    <ul className="mt-2.5 space-y-1.5">
                      {day.items.map((item, ii) => {
                        const checked = isChecked(planId, day.day, ii);
                        return (
                          <li key={ii} className="flex items-start gap-2.5">
                            <button
                              type="button"
                              onClick={() => toggle(planId, day.day, ii)}
                              aria-label={checked ? "Mark as not done" : "Mark as done"}
                              className="mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md border transition-colors"
                              style={{
                                borderColor: checked ? "var(--good)" : "var(--line)",
                                background: checked ? "var(--good)" : "transparent",
                                color: "#fff",
                              }}
                            >
                              {checked && (
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M20 6L9 17l-5-5" />
                                </svg>
                              )}
                            </button>
                            <div className="min-w-0 flex-1 text-[0.82rem] leading-relaxed">
                              <span className={checked ? "text-[var(--muted)] line-through" : ""}>
                                {item.videoUrl && item.videoTitle ? (
                                  <a
                                    href={item.videoUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-semibold hover:underline"
                                    style={{ color: "var(--brand)" }}
                                  >
                                    ▶ {item.videoTitle}
                                  </a>
                                ) : (
                                  item.title
                                )}
                              </span>
                              <span className="ml-1.5 text-xs text-[var(--muted)]">
                                · {item.minutes} min
                                {item.type ? ` · ${item.type}` : ""}
                              </span>
                              {item.videoUrl && item.videoTitle && (
                                <span className="block text-xs text-[var(--muted)]">{item.title}</span>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}

              {plan?.tips && plan.tips.length > 0 && (
                <section className="rounded-2xl border p-4" style={{ borderColor: "var(--line)" }}>
                  <h3 className="text-sm font-extrabold">🎯 Strategy tips</h3>
                  <ul className="mt-2 space-y-1.5">
                    {plan.tips.map((tip, i) => (
                      <li key={i} className="flex gap-2 text-[0.82rem] leading-relaxed">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                        <span>{tip}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {plan?.markdown && (
                <details>
                  <summary className="cursor-pointer select-none text-xs font-semibold text-[var(--muted)] hover:text-[var(--text)]">
                    View / copy the plan as Markdown
                  </summary>
                  <div
                    className="plan-markdown mt-2"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(plan.markdown) }}
                  />
                </details>
              )}
            </div>
          )}
        </div>

        {!loading && (days.length > 0 || error) && (
          <footer
            className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3"
            style={{ borderColor: "var(--line)" }}
          >
            <p className="text-xs text-[var(--muted)]">
              Tick items as you go — progress is saved on this device.
            </p>
            <button
              type="button"
              onClick={onRegenerate}
              className="btn-ghost flex items-center gap-2 px-3 py-2 text-sm"
            >
              <RefreshIcon width={15} height={15} /> Regenerate
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
