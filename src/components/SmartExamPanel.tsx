"use client";

import { ChevronDown, Target, Upload } from "lucide-react";
import type { ExamPlanResponse, SmartPriorityResult, Topic } from "@/lib/types";

interface SmartExamPanelProps {
  priority: SmartPriorityResult;
  /** Every syllabus topic — all of them stay visible in this mode. */
  topics: Topic[];
  plan: ExamPlanResponse | null;
  /** Switches to the PYQ Analysis tab to upload papers. */
  onGoUpload: () => void;
}

const SECTIONS: Array<{
  key: "high" | "medium" | "low" | "unobserved";
  label: string;
  dot: string;
  blurb: string;
}> = [
  {
    key: "high",
    label: "High Priority",
    dot: "var(--bad)",
    blurb: "Asked across many of your papers (or carried the most marks) — revise these first.",
  },
  {
    key: "medium",
    label: "Medium Priority",
    dot: "var(--brand)",
    blurb: "Appeared in your papers but not dominant — cover after the high-priority block.",
  },
  {
    key: "low",
    label: "Low Priority",
    dot: "var(--muted)",
    blurb:
      "Observed in your papers but with weak evidence (asked rarely, few marks) — keep for last.",
  },
  {
    key: "unobserved",
    label: "Not observed in uploaded papers",
    dot: "var(--line)",
    blurb:
      "No question in YOUR uploaded papers matched this topic — that is missing evidence, NOT low importance. Cover these in Complete Syllabus.",
  },
];

/**
 * Smart Exam Preparation — High / Medium / Low with the evidence for each
 * label. Every syllabus topic is listed here (grouped, never hidden), and a
 * topic with no observed questions gets its own "not observed" section so it
 * can never be passed off as unimportant.
 */
export function SmartExamPanel({ priority, topics, plan, onGoUpload }: SmartExamPanelProps) {
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  const entryById = new Map((plan?.topics ?? []).map((entry) => [entry.topic.id, entry]));

  /* -------- no papers: honest limitation, topics still reachable -------- */
  if (!priority.hasPapers) {
    return (
      <div className="space-y-3">
        <div className="card p-5 text-center">
          <Target width={22} height={22} className="mx-auto" style={{ color: "var(--brand)" }} />
          <p className="mt-2 text-sm font-bold">PYQ-based prioritisation abhi unavailable hai</p>
          <p className="mx-auto mt-1 max-w-lg text-xs leading-relaxed text-[var(--muted)]">
            Bina previous-year papers ke koi topic High/Low nahi label ho sakta — bina evidence ke
            koi label dikhana honest nahi hoga. Papers upload karo, sab numbers aapke papers se
            ginne jaayenge. Tab tak Complete Syllabus Preparation har topic cover karti hai.
          </p>
          <button
            type="button"
            onClick={onGoUpload}
            className="btn-primary mt-3 inline-flex items-center gap-1.5 px-4 py-2 text-xs"
          >
            <Upload width={14} height={14} /> Papers upload karo →
          </button>
        </div>

        {/* All topics stay reachable here too — syllabus order, no labels. */}
        <div className="card p-4">
          <p className="text-xs font-extrabold uppercase tracking-wide text-[var(--muted)]">
            Poora syllabus (koi priority label nahi — evidence nahi hai)
          </p>
          <div className="mt-2 space-y-2.5">
            {[...new Set(topics.map((t) => t.chapter ?? "General"))].map((unit) => (
              <div key={unit}>
                <p className="text-xs font-bold">{unit}</p>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {topics
                    .filter((t) => (t.chapter ?? "General") === unit)
                    .map((topic) => (
                      <li key={topic.id} className="chip max-w-full truncate" title={topic.title}>
                        {topic.title}
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ------------------------- with papers: labelled evidence ------------------------- */
  const notes = priority.notes;

  return (
    <div className="space-y-3">
      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-[0.68rem] font-extrabold uppercase tracking-wide text-[var(--muted)]">
              <Target width={13} height={13} style={{ color: "var(--brand)" }} />
              Smart Exam Preparation
            </p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
              Har label ke saath wahi evidence hai jo aapke papers me likha hai — frequency, marks
              aur repeated wording. Sab {topics.length} topics yahan maujood hain.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span className="chip" style={{ color: "var(--bad)", borderColor: "var(--bad)" }}>
              {priority.counts.high} High
            </span>
            <span className="chip" style={{ color: "var(--brand)" }}>
              {priority.counts.medium} Medium
            </span>
            <span className="chip">{priority.counts.low} Low</span>
            <span className="chip">{priority.counts.unobserved} Not observed</span>
          </div>
        </div>
      </div>

      {SECTIONS.map((section) => {
        const rows = priority.topics.filter((row) => row.priority === section.key);
        if (rows.length === 0) return null;
        return (
          <section key={section.key} className="card overflow-hidden" style={{ padding: 0 }}>
            <div className="flex items-center gap-2.5 border-b px-4 py-3" style={{ borderColor: "var(--line)" }}>
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: section.dot, boxShadow: `0 0 0 3px color-mix(in srgb, ${section.dot} 22%, transparent)` }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-extrabold">
                  {section.label} <span className="text-[var(--muted)]">· {rows.length}</span>
                </p>
                <p className="mt-0.5 text-[0.7rem] leading-relaxed text-[var(--muted)]">
                  {section.blurb}
                </p>
              </div>
            </div>

            <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
              {rows.map((row) => {
                const topic = topicById.get(row.topicId);
                const entry = entryById.get(row.topicId);
                const realQuestions = entry?.signal.questions.slice(0, 4) ?? [];
                return (
                  <li key={row.topicId} className="px-4 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <p className="min-w-0 text-sm font-bold">{topic?.title ?? row.topicId}</p>
                      {topic?.chapter && (
                        <span className="chip shrink-0 text-[0.62rem]">{topic.chapter}</span>
                      )}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{row.reason}</p>

                    {realQuestions.length > 0 && (
                      <details className="mt-1.5">
                        <summary className="flex cursor-pointer list-none items-center gap-1 text-[0.7rem] font-bold [&::-webkit-details-marker]:hidden" style={{ color: "var(--brand)" }}>
                          <ChevronDown
                            width={12}
                            height={12}
                            strokeWidth={2.6}
                            style={{ transform: "rotate(-90deg)" }}
                          />
                          Asli questions ({entry?.signal.questions.length ?? 0}) — source papers
                        </summary>
                        <ul className="mt-1.5 space-y-1">
                          {realQuestions.map((question) => (
                            <li
                              key={question.id}
                              className="rounded-lg px-2.5 py-1.5 text-[0.72rem] leading-relaxed"
                              style={{ background: "var(--surface-2)" }}
                            >
                              <span className="font-bold">
                                {question.paperYear || "Year?"} · {question.paperLabel}
                                {question.number ? ` · ${question.number}` : ""}
                                {question.marks ? ` · ${question.marks} marks` : ""}
                              </span>
                              <span className="text-[var(--muted)]"> — {question.text}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <div className="card p-4">
        <p className="text-xs font-extrabold uppercase tracking-wide text-[var(--muted)]">
          How these labels were decided
        </p>
        <ul className="mt-1.5 space-y-1 text-xs leading-relaxed text-[var(--muted)]">
          {notes.map((note, index) => (
            <li key={index}>• {note}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
