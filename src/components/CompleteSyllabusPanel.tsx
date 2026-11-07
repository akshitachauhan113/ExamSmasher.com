"use client";

import { AlertTriangle, ListChecks } from "lucide-react";
import type { SyllabusAnalysis, Topic } from "@/lib/types";

interface CompleteSyllabusPanelProps {
  subject: string;
  /** Full uncapped structure — units, topics, subtotals, unclear lines. */
  analysis: SyllabusAnalysis;
  /** Every extracted topic, in syllabus order (never re-prioritised). */
  topics: Topic[];
  studiedCount: number;
  isStudied: (title: string) => boolean;
  onResetProgress: () => void;
}

/**
 * Complete Syllabus Preparation — cover EVERYTHING, nothing hidden.
 *
 * Progress is the existing "studied" tick (same localStorage key the rest of
 * the site uses), so ticks made anywhere count here too. The pending list
 * below the bar is the honest answer to "what have I still not done?".
 */
export function CompleteSyllabusPanel({
  subject,
  analysis,
  topics,
  studiedCount,
  isStudied,
  onResetProgress,
}: CompleteSyllabusPanelProps) {
  const total = topics.length;
  const pct = total > 0 ? Math.round((studiedCount / total) * 100) : 0;
  const pending = topics.filter((topic) => !isStudied(topic.title));
  const shownPending = pending.slice(0, 60);

  return (
    <div className="space-y-3">
      {/* Whole-syllabus progress */}
      <div className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[0.68rem] font-extrabold uppercase tracking-wide text-[var(--muted)]">
              <ListChecks width={13} height={13} style={{ color: "var(--brand)" }} />
              Complete Syllabus Preparation
            </p>
            <h3 className="mt-1 truncate text-sm font-extrabold" title={subject}>
              {subject}
            </h3>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              {analysis.totalUnits} unit{analysis.totalUnits === 1 ? "" : "s"} ·{" "}
              {analysis.totalTopics} topics
              {analysis.totalSubtopics > 0 && ` · ${analysis.totalSubtopics} subtopics`} —
              yahan se koi topic skip nahi hoga.
            </p>
          </div>

          <div className="text-right">
            <p className="text-xl font-extrabold leading-none" style={{ color: "var(--brand)" }}>
              {pct}%
            </p>
            <p className="mt-1 text-[0.68rem] text-[var(--muted)]">
              {studiedCount}/{total} topics done
            </p>
          </div>
        </div>

        <div
          className="mt-3 h-2 w-full overflow-hidden rounded-full"
          style={{ background: "var(--surface-2)" }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Syllabus completion"
        >
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${pct}%`,
              background: "linear-gradient(90deg, var(--brand), var(--brand-2))",
            }}
          />
        </div>
      </div>

      {/* What is still pending — the whole point of this mode */}
      {pending.length > 0 ? (
        <div className="card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-extrabold uppercase tracking-wide text-[var(--muted)]">
              Abhi pending — {pending.length} topic{pending.length > 1 ? "s" : ""}
            </p>
            {studiedCount > 0 && (
              <button
                type="button"
                onClick={onResetProgress}
                className="text-[0.7rem] font-bold"
                style={{ color: "var(--brand)" }}
              >
                Progress reset karo
              </button>
            )}
          </div>
          <ul className="mt-2.5 flex flex-wrap gap-1.5">
            {shownPending.map((topic) => (
              <li
                key={topic.id}
                className="chip max-w-full truncate"
                title={`${topic.chapter ? `${topic.chapter} · ` : ""}${topic.title}`}
              >
                {topic.title}
              </li>
            ))}
          </ul>
          {pending.length > shownPending.length && (
            <p className="mt-2 text-[0.7rem] text-[var(--muted)]">
              +{pending.length - shownPending.length} aur pending — unit expand karke dekho.
            </p>
          )}
        </div>
      ) : (
        <div className="card p-4 text-center">
          <p className="text-sm font-bold">🎉 Poori syllabus cover ho gayi!</p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Sab {total} topics tick ho chuke hain — ab revision aur practice pe focus karo.
          </p>
          <button
            type="button"
            onClick={onResetProgress}
            className="btn-ghost mt-3 px-3 py-1.5 text-xs"
          >
            Progress reset karo (nayi attempt ke liye)
          </button>
        </div>
      )}

      {/* Transparency: what the parser could not read, and what it merged */}
      {(analysis.unclearLines.length > 0 || analysis.duplicatesRemoved > 0) && (
        <div className="card p-4">
          <p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-[var(--muted)]">
            <AlertTriangle width={13} height={13} style={{ color: "var(--brand)" }} />
            Parser transparency
          </p>
          <div className="mt-1.5 space-y-1 text-xs leading-relaxed text-[var(--muted)]">
            {analysis.duplicatesRemoved > 0 && (
              <p>
                {analysis.duplicatesRemoved} exact duplicate line
                {analysis.duplicatesRemoved === 1 ? "" : "s"} removed (same line, same unit —
                distinct topics were kept).
              </p>
            )}
            {analysis.unclearLines.length > 0 && (
              <details>
                <summary className="cursor-pointer font-semibold text-[var(--text)]">
                  {analysis.unclearLines.length} line{analysis.unclearLines.length === 1 ? "" : "s"}{" "}
                  unclear — padha nahi ja saka (guess nahi kiya)
                </summary>
                <ul className="mt-1.5 space-y-1">
                  {analysis.unclearLines.map((line, index) => (
                    <li key={`${line.unit}-${index}`} className="rounded-lg px-2 py-1" style={{ background: "var(--surface-2)" }}>
                      <span className="font-semibold">{line.unit}:</span>{" "}
                      <span className="font-mono">{line.text}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
