"use client";

import { AlertTriangle, FileSearch } from "lucide-react";
import { RefreshIcon } from "@/components/Icons";
import type { PyqEvidence, RepeatedQuestionGroup } from "@/lib/types";

interface PyqEvidencePanelProps {
  evidence: PyqEvidence | null;
  loading: boolean;
  error: string | null;
  /** 0..1 while the (chunked, non-blocking) count runs. */
  progress: number;
  onRetry: () => void;
  topicTitle: (topicId: string) => string;
  topicUnit: (topicId: string) => string;
}

function GroupBlock({ group }: { group: RepeatedQuestionGroup }) {
  const papers = new Set(group.occurrences.map((o) => `${o.paperLabel}|${o.paperYear}`));
  const isExact = group.kind === "exact";
  return (
    <details className="rounded-xl border px-3 py-2" style={{ borderColor: "var(--line)" }}>
      <summary className="flex cursor-pointer list-none items-start gap-2 [&::-webkit-details-marker]:hidden">
        <span
          className="mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[0.6rem] font-extrabold uppercase"
          style={{
            background: isExact
              ? "color-mix(in srgb, var(--bad) 14%, transparent)"
              : "color-mix(in srgb, var(--brand) 14%, transparent)",
            color: isExact ? "var(--bad)" : "var(--brand)",
          }}
        >
          {isExact ? "Exact" : "Similar"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-bold" title={group.occurrences[0]?.text}>
            {group.occurrences[0]?.text.slice(0, 110)}
            {(group.occurrences[0]?.text.length ?? 0) > 110 ? "…" : ""}
          </span>
          <span className="mt-0.5 block text-[0.68rem] text-[var(--muted)]">
            {group.occurrences.length}× across {papers.size} paper{papers.size > 1 ? "s" : ""}
            {!isExact && group.sharedTerms?.length ? ` · shares: ${group.sharedTerms.join(", ")}` : ""}
          </span>
        </span>
      </summary>
      <ul className="mt-2 space-y-1">
        {group.occurrences.map((occ, index) => (
          <li
            key={`${occ.questionId}-${index}`}
            className="rounded-lg px-2.5 py-1.5 text-[0.72rem] leading-relaxed"
            style={{ background: "var(--surface-2)" }}
          >
            <span className="font-bold">
              {occ.paperYear || "Year?"} · {occ.paperLabel}
              {occ.number ? ` · ${occ.number}` : ""}
              {occ.marks ? ` · ${occ.marks} marks` : ""}
            </span>
            <span className="text-[var(--muted)]"> — {occ.text}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * PYQ Analysis evidence — every number counted from the uploaded papers:
 * repeated questions (exact vs similar concept), topic-wise and unit-wise
 * frequency, year-wise rows where years exist, and marks where printed.
 * When something is missing (no years, no marks, one paper) the panel says
 * so instead of showing an empty chart.
 */
export function PyqEvidencePanel({
  evidence,
  loading,
  error,
  progress,
  onRetry,
  topicTitle,
  topicUnit,
}: PyqEvidencePanelProps) {
  if (loading) {
    const pct = Math.round(progress * 100);
    return (
      <div className="card p-4">
        <p className="text-xs font-extrabold uppercase tracking-wide text-[var(--muted)]">
          Papers ka evidence gin rahi hoon…
        </p>
        <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--surface-2)" }}>
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.max(4, pct)}%`, background: "linear-gradient(90deg, var(--brand), var(--brand-2))" }}
          />
        </div>
        <p className="mt-1.5 text-[0.7rem] text-[var(--muted)]">
          {pct}% — repeats aur frequencies count ho rahe hain (UI block nahi ho rahi).
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-4">
        <p className="flex items-center gap-2 text-xs font-bold" style={{ color: "var(--bad)" }}>
          <AlertTriangle width={15} height={15} /> Evidence count nahi ho paya: {error}
        </p>
        <button type="button" onClick={onRetry} className="btn-ghost mt-2.5 px-3 py-1.5 text-xs">
          <RefreshIcon width={13} height={13} /> Dobara try karo
        </button>
      </div>
    );
  }

  if (!evidence || !evidence.ok) {
    return (
      <div className="card p-4 text-center text-xs text-[var(--muted)]">
        Papers parse hote hi evidence yahan dikhne lagega.
      </div>
    );
  }

  const coveredTopics = evidence.topicFrequency.length;
  const maxUnitQuestions = Math.max(1, ...evidence.unitDistribution.map((u) => u.questionCount));

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="card p-4">
        <p className="flex items-center gap-1.5 text-[0.68rem] font-extrabold uppercase tracking-wide text-[var(--muted)]">
          <FileSearch width={13} height={13} style={{ color: "var(--brand)" }} />
          PYQ evidence summary
        </p>
        <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
          <div>
            <p className="text-[0.66rem] uppercase tracking-wide text-[var(--muted)]">Papers</p>
            <p className="text-sm font-extrabold" style={{ color: "var(--brand)" }}>
              {evidence.papersAnalyzed}
            </p>
          </div>
          <div>
            <p className="text-[0.66rem] uppercase tracking-wide text-[var(--muted)]">Questions</p>
            <p className="text-sm font-extrabold">{evidence.questionsAnalyzed}</p>
          </div>
          <div>
            <p className="text-[0.66rem] uppercase tracking-wide text-[var(--muted)]">Exact repeats</p>
            <p className="text-sm font-extrabold">{evidence.exactCount}</p>
          </div>
          <div>
            <p className="text-[0.66rem] uppercase tracking-wide text-[var(--muted)]">Similar concepts</p>
            <p className="text-sm font-extrabold">{evidence.similarCount}</p>
          </div>
          <div>
            <p className="text-[0.66rem] uppercase tracking-wide text-[var(--muted)]">Topics covered</p>
            <p className="text-sm font-extrabold">
              {coveredTopics}
              {evidence.unmappedQuestions > 0 && (
                <span className="text-[var(--muted)]"> · {evidence.unmappedQuestions} unmatched</span>
              )}
            </p>
          </div>
          {evidence.crossPaperTopics.length > 0 && (
            <div>
              <p className="text-[0.66rem] uppercase tracking-wide text-[var(--muted)]">
                Asked in 2+ papers
              </p>
              <p className="text-sm font-extrabold" style={{ color: "var(--brand)" }}>
                {evidence.crossPaperTopics.length} topics
              </p>
            </div>
          )}
        </div>
        {evidence.singlePaper && (
          <p
            className="mt-2.5 rounded-lg px-3 py-2 text-[0.72rem] leading-relaxed"
            style={{ background: "color-mix(in srgb, var(--brand) 8%, transparent)" }}
          >
            ⓘ Single paper analysed — sab numbers usi paper se hain. Koi multi-year trend claim
            nahi kiya ja raha.
          </p>
        )}
      </div>

      {/* Repeated questions */}
      <div className="card p-4">
        <p className="text-xs font-extrabold uppercase tracking-wide text-[var(--muted)]">
          Repeated questions — exact wording vs similar concept
        </p>
        {evidence.repeats.length === 0 ? (
          <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
            In papers me koi repeated (ya similar-worded) question nahi mila — ye ek honest
            finding hai, khali list nahi chhupayi gayi.
          </p>
        ) : (
          <div className="mt-2 space-y-1.5">
            {evidence.repeats.map((group, index) => (
              <GroupBlock key={`${group.kind}-${index}`} group={group} />
            ))}
          </div>
        )}
      </div>

      {/* Topic-wise frequency */}
      <div className="card p-4">
        <p className="text-xs font-extrabold uppercase tracking-wide text-[var(--muted)]">
          Topic-wise question frequency (sirf aapke papers se)
        </p>
        {evidence.topicFrequency.length === 0 ? (
          <p className="mt-2 text-xs text-[var(--muted)]">
            Koi question kisi syllabus topic se match nahi hua — PYQ tab me mapping dobara check
            karo.
          </p>
        ) : (
          <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto pr-1">
            {evidence.topicFrequency.map((row) => (
              <div
                key={row.topicId}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-lg px-2.5 py-1.5"
                style={{ background: "var(--surface-2)" }}
              >
                <span className="min-w-0 flex-1 truncate text-xs font-bold" title={topicTitle(row.topicId)}>
                  {topicTitle(row.topicId)}
                  <span className="ml-1.5 font-normal text-[var(--muted)]">
                    · {topicUnit(row.topicId)}
                  </span>
                </span>
                <span className="shrink-0 text-[0.7rem] text-[var(--muted)]">
                  <strong className="text-[var(--text)]">{row.questionCount}</strong> q ·{" "}
                  {row.papersAppeared} paper{row.papersAppeared > 1 ? "s" : ""}
                  {row.totalMarks > 0 && <> · {row.totalMarks} marks</>}
                  {row.years.length > 0 && <> · {row.years.join(", ")}</>}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Unit-wise distribution */}
      {evidence.unitDistribution.length > 0 && (
        <div className="card p-4">
          <p className="text-xs font-extrabold uppercase tracking-wide text-[var(--muted)]">
            Unit-wise question distribution
          </p>
          <div className="mt-2 space-y-2">
            {evidence.unitDistribution.map((row) => (
              <div key={row.unit}>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="min-w-0 truncate text-xs font-bold" title={row.unit}>
                    {row.unit}
                  </p>
                  <p className="shrink-0 text-[0.7rem] text-[var(--muted)]">
                    {row.questionCount} q · {row.papersAppeared} paper
                    {row.papersAppeared > 1 ? "s" : ""}
                    {row.totalMarks > 0 && <> · {row.totalMarks} marks</>}
                  </p>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--surface-2)" }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(2, Math.round((row.questionCount / maxUnitQuestions) * 100))}%`,
                      background: "linear-gradient(90deg, var(--brand), var(--brand-2))",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Year-wise + marks, side by side on wide screens */}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="card p-4">
          <p className="text-xs font-extrabold uppercase tracking-wide text-[var(--muted)]">
            Year-wise pattern
          </p>
          {evidence.years.length === 0 ? (
            <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
              Kisi paper me recognizable year nahi mila — year-wise pattern unavailable hai
              (guess nahi kiya ja raha).
            </p>
          ) : (
            <>
              {!evidence.yearsIdentifiable && (
                <p className="mt-2 text-[0.7rem] text-[var(--muted)]">
                  Sirf {evidence.years.length} dated paper — trend ke liye 2+ chahiye.
                </p>
              )}
              <table className="mt-2 w-full text-left text-xs">
                <thead>
                  <tr className="text-[0.66rem] uppercase tracking-wide text-[var(--muted)]">
                    <th className="pb-1 font-bold">Year</th>
                    <th className="pb-1 font-bold">Questions</th>
                    <th className="pb-1 font-bold">Topics</th>
                  </tr>
                </thead>
                <tbody>
                  {evidence.years.map((row) => (
                    <tr key={row.year} className="border-t" style={{ borderColor: "var(--line)" }}>
                      <td className="py-1.5 font-bold">{row.year}</td>
                      <td className="py-1.5">{row.questionCount}</td>
                      <td className="py-1.5">{row.topicsTouched}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        <div className="card p-4">
          <p className="text-xs font-extrabold uppercase tracking-wide text-[var(--muted)]">
            Marks distribution
          </p>
          {evidence.marks ? (
            <>
              <p className="mt-2 text-xs text-[var(--muted)]">
                {evidence.marks.withMarks}/{evidence.questionsAnalyzed} questions par marks printed
                · total {evidence.marks.total} marks
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {evidence.marks.distribution.map((row) => (
                  <span key={row.marks} className="chip">
                    {row.marks} marks × {row.count}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
              Parsed questions me koi marks print nahi mila — marks distribution unavailable hai
              (numbers invent nahi kiye ja rahe).
            </p>
          )}
        </div>
      </div>

      {/* Honesty notes */}
      {evidence.notes.length > 0 && (
        <div className="card p-4">
          <p className="text-xs font-extrabold uppercase tracking-wide text-[var(--muted)]">
            Analysis notes (kya padha gaya, kya nahi)
          </p>
          <ul className="mt-1.5 space-y-1 text-xs leading-relaxed text-[var(--muted)]">
            {evidence.notes.map((note, index) => (
              <li key={index}>• {note}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
