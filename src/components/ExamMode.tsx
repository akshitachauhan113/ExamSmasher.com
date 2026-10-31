"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BAND_LABEL,
  TREND_LABEL,
} from "@/lib/exam";
import type {
  ExamPlanResponse,
  ExamTopic,
  PyqPaper,
  PyqQuestion,
  Topic,
} from "@/lib/types";
import { AlertIcon, CalendarIcon, RefreshIcon, UploadIcon } from "./Icons";
import { DocPanel } from "./DocPanel";
import { QuizBox } from "./QuizBox";

interface ExamModeProps {
  topics: Topic[];
  subject: string;
  /** Exam state lives in the page so re-analysing does not wipe uploaded papers. */
  exam: ExamState;
  setExam: (patch: Partial<ExamState>) => void;
  /** Called after a plan is built, so the page can toast + reorder topics. */
  onPlanBuilt: (plan: ExamPlanResponse) => void;
  onJumpToTopic: (topicId: string) => void;
}

/** Everything Exam Mode produces. Owned by the page, edited by this panel. */
export interface ExamState {
  papers: PendingPaper[];
  questions: PyqQuestion[];
  parsedPapers: PyqPaper[];
  plan: ExamPlanResponse | null;
}

export const EMPTY_EXAM_STATE: ExamState = {
  papers: [],
  questions: [],
  parsedPapers: [],
  plan: null,
};

/** One uploaded paper, already read into text, waiting to be parsed. */
export interface PendingPaper {
  id: string;
  year: string;
  label: string;
  fileName: string;
  text: string;
}

interface ExtractResponse {
  ok: boolean;
  text?: string;
  method?: string;
  error?: string;
}

interface PapersResponse {
  ok: boolean;
  questions?: PyqQuestion[];
  papers?: PyqPaper[];
  error?: string;
}

const ACCEPT = ".pdf,.docx,.txt,.md,.markdown,.csv,image/*";
const MAX_PAPERS = 6;

/** Quick presets so nobody has to type — this is a revision tool, not a form. */
const TIME_PRESETS: Array<{ label: string; hours: number }> = [
  { label: "1 day", hours: 24 },
  { label: "3 days", hours: 72 },
  { label: "1 week", hours: 168 },
  { label: "2 weeks", hours: 336 },
];

const BAND_ORDER: ExamTopic["band"][] = ["must", "should", "if-time"];

/**
 * The exam-crash section: upload real previous-year papers, get a study order
 * ranked by return-per-minute, plus the questions that actually repeat.
 *
 * Every number shown is computed from the uploaded papers — nothing is
 * presented as a trend unless a real paper backs it.
 */
export function ExamMode({
  topics,
  subject,
  exam,
  setExam,
  onPlanBuilt,
  onJumpToTopic,
}: ExamModeProps) {
  // Page-owned state: survives a re-analysis of the syllabus, so the student
  // never has to re-OCR their papers just because they edited the syllabus.
  const { papers, questions, parsedPapers, plan } = exam;
  const [hours, setHours] = useState<number | null>(72);
  const [busyExtract, setBusyExtract] = useState(false);
  const [busyPlan, setBusyPlan] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const planRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buildPlanRef = useRef<
    ((questions: PyqQuestion[], papers?: PyqPaper[]) => Promise<void>) | null
  >(null);

  /* ------------------------------ upload ------------------------------ */

  const addFiles = useCallback(
    async (files: FileList | File[] | null) => {
      const list = Array.from(files ?? []);
      if (list.length === 0 || busyExtract) return;

      const room = MAX_PAPERS - papers.length;
      if (room <= 0) {
        setError(`At most ${MAX_PAPERS} papers. Trend is reliable with 2-3 anyway.`);
        return;
      }

      setBusyExtract(true);
      setError(null);
      const added: PendingPaper[] = [];

      for (const file of list.slice(0, room)) {
        try {
          const form = new FormData();
          form.append("file", file);
          const response = await fetch("/api/extract", { method: "POST", body: form });
          const data: ExtractResponse = await response.json();
          if (!data.ok || !data.text) throw new Error(data.error || "Could not read that file.");

          added.push({
            id: `p${Date.now().toString(36)}-${added.length}`,
            year: guessYear(file.name) ?? "",
            label: "Question paper",
            fileName: file.name,
            text: data.text,
          });
        } catch (err) {
          setError(
            err instanceof Error
              ? `${file.name}: ${err.message}`
              : `Could not read ${file.name}.`,
          );
        }
      }

      if (added.length > 0) {
        // A new paper invalidates the old trend — the student re-reads + rebuilds.
        setExam({ papers: [...papers, ...added], questions: [], parsedPapers: [], plan: null });
      }
      setBusyExtract(false);
      if (inputRef.current) inputRef.current.value = "";
    },
    [busyExtract, papers, setExam],
  );

  /* ------------------------------ parsing ----------------------------- */

  const parsePapers = useCallback(async () => {
    if (papers.length === 0 || busyPlan) return;
    const incomplete = papers.filter((p) => !p.year.trim());
    if (incomplete.length > 0) {
      setError("Add the year for every paper — without it the trend has no meaning.");
      return;
    }

    setBusyPlan(true);
    setError(null);
    try {
      const response = await fetch("/api/papers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          papers: papers.map((p) => ({
            id: p.id,
            year: p.year.trim(),
            label: p.label.trim() || "Question paper",
            text: p.text,
          })),
        }),
      });
      const data: PapersResponse = await response.json();
      if (!data.ok || !data.questions?.length) {
        throw new Error(data.error || "No questions could be read.");
      }

      const parsed = data.papers ?? [];
      setExam({ questions: data.questions, parsedPapers: parsed });
      // Straight into the plan — a time-starved student should not need
      // three clicks to get the thing they came for.
      await buildPlanRef.current?.(data.questions, parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the papers.");
    } finally {
      setBusyPlan(false);
    }
  }, [papers, busyPlan, subject, setExam]);

  /* ------------------------------- plan ------------------------------- */

  const buildPlan = useCallback(
    async (questionList: PyqQuestion[], parsedList?: PyqPaper[]) => {
      if (questionList.length === 0) return;
      setBusyPlan(true);
      setError(null);
      try {
        const response = await fetch("/api/examplan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject,
            topics,
            questions: questionList,
            totalMinutes: hours ? hours * 60 : undefined,
          }),
        });
        const data: ExamPlanResponse = await response.json();
        if (!data.ok || !data.topics?.length) {
          throw new Error(data.error || "Could not build the exam plan.");
        }
        setExam({
          plan: data,
          questions: questionList,
          parsedPapers: parsedList ?? parsedPapers,
        });
        onPlanBuilt(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not build the exam plan.");
      } finally {
        setBusyPlan(false);
      }
    },
    [subject, topics, hours, parsedPapers, setExam, onPlanBuilt],
  );

  // parsePapers (defined above) needs the newest buildPlan without being
  // re-created every render — a ref keeps both callbacks in sync.
  useEffect(() => {
    buildPlanRef.current = buildPlan;
  }, [buildPlan]);

  // Rebuild the plan when the time budget changes — but only if one exists.
  useEffect(() => {
    if (!plan || questions.length === 0 || busyPlan) return;
    if (planRef.current) clearTimeout(planRef.current);
    planRef.current = setTimeout(() => void buildPlan(questions), 500);
    return () => {
      if (planRef.current) clearTimeout(planRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hours]);

  const updatePaper = (id: string, patch: Partial<PendingPaper>) => {
    setExam({ papers: papers.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  };

  const removePaper = (id: string) => {
    setExam({
      papers: papers.filter((p) => p.id !== id),
      questions: [],
      parsedPapers: [],
      plan: null,
    });
  };

  const hasQuestions = questions.length > 0;

  return (
    <section
      className="card mt-6 overflow-hidden"
      style={{ borderColor: "color-mix(in srgb, var(--brand) 35%, var(--line))" }}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "var(--line)" }}>
        <div>
          <h2 className="text-[1.05rem] font-extrabold">🎯 Exam Mode</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">
            Apne <strong className="text-[var(--text)]">purane papers (2-3 saal)</strong> daalo —
            app nikalega ki kaunsa topic har saal aata hai, kaunsa nahi. Phir usi trend ke hisaab
            se kam time me sabse zyada marks dene wale topics pehle.
          </p>
        </div>
        {plan?.papers && plan.papers.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {plan.papers.map((p) => (
              <span key={`${p.label}-${p.year}`} className="chip">
                {p.year} · {p.questionCount}Q
              </span>
            ))}
          </div>
        )}
      </header>

      {/* ---------------------------- paper upload --------------------------- */}
      <div className="px-4 py-3">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!busyExtract) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!busyExtract) void addFiles(e.dataTransfer.files);
          }}
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed px-4 py-3 transition-colors"
          style={{
            borderColor: dragging ? "var(--brand)" : "var(--line)",
            background: dragging ? "color-mix(in srgb, var(--brand) 8%, transparent)" : "transparent",
          }}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
              style={{ background: "var(--surface-2)", color: "var(--brand)" }}
            >
              {busyExtract ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--line)] border-t-[var(--brand)]" />
              ) : (
                <UploadIcon width={17} height={17} />
              )}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">
                {busyExtract ? "Reading your papers…" : "Previous-year papers upload karo"}
              </p>
              <p className="truncate text-xs text-[var(--muted)]">
                PDF · DOCX · TXT · ya paper ki photo · {papers.length}/{MAX_PAPERS} added
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={busyExtract}
            onClick={() => inputRef.current?.click()}
            className="btn-ghost shrink-0 px-3 py-2 text-xs"
          >
            Choose papers
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => void addFiles(e.target.files)}
            aria-label="Upload previous-year papers"
          />
        </div>

        {papers.length > 0 && (
          <ul className="mt-3 space-y-2">
            {papers.map((paper) => (
              <li
                key={paper.id}
                className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2"
                style={{ borderColor: "var(--line)", background: "var(--surface-2)" }}
              >
                <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                  {paper.fileName}
                </span>
                <input
                  value={paper.year}
                  onChange={(e) => updatePaper(paper.id, { year: e.target.value })}
                  placeholder="Year (2023)"
                  aria-label="Paper year"
                  className="w-24 rounded-lg border bg-transparent px-2 py-1 text-xs"
                  style={{ borderColor: "var(--line)" }}
                />
                <input
                  value={paper.label}
                  onChange={(e) => updatePaper(paper.id, { label: e.target.value })}
                  placeholder="End Semester"
                  aria-label="Paper label"
                  className="w-36 rounded-lg border bg-transparent px-2 py-1 text-xs"
                  style={{ borderColor: "var(--line)" }}
                />
                <span className="chip shrink-0">{Math.round(paper.text.length / 1000)}k chars</span>
                <button
                  type="button"
                  onClick={() => removePaper(paper.id)}
                  className="text-xs font-bold text-[var(--muted)] hover:text-[var(--bad)]"
                  aria-label={`Remove ${paper.fileName}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p className="mt-2 flex items-start gap-1.5 text-xs" style={{ color: "var(--bad)" }}>
            <span className="mt-0.5 shrink-0">
              <AlertIcon width={13} height={13} />
            </span>
            {error}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void parsePapers()}
            disabled={papers.length === 0 || busyPlan}
            className="btn-primary flex items-center gap-1.5 px-3.5 py-2 text-xs disabled:opacity-50"
          >
            {busyPlan && !hasQuestions ? "Reading questions…" : hasQuestions ? "Re-read papers" : "Read questions"}
          </button>

          {hasQuestions && (
            <>
              <span className="text-xs text-[var(--muted)]">
                {questions.length} questions read · {parsedPapers.length} papers
              </span>
              <button
                type="button"
                onClick={() => void buildPlan(questions)}
                disabled={busyPlan}
                className="btn-ghost flex items-center gap-1.5 px-3 py-2 text-xs disabled:opacity-50"
              >
                <RefreshIcon width={13} height={13} />
                {plan ? "Rebuild plan" : "Build exam plan"}
              </button>
            </>
          )}

          {busyPlan && hasQuestions && (
            <span className="text-xs text-[var(--muted)]">Trend nikaal raha hoon…</span>
          )}
        </div>
      </div>

      {/* ---------------------------- time budget ---------------------------- */}
      {hasQuestions && (
        <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3" style={{ borderColor: "var(--line)" }}>
          <span className="flex items-center gap-1.5 text-xs font-bold">
            <CalendarIcon width={14} height={14} /> Mere paas itna time hai:
          </span>
          {TIME_PRESETS.map((preset) => (
            <button
              key={preset.hours}
              type="button"
              onClick={() => setHours(preset.hours)}
              className="rounded-lg px-2.5 py-1 text-xs font-bold transition-colors"
              style={{
                background: hours === preset.hours ? "var(--brand)" : "transparent",
                color: hours === preset.hours ? "var(--brand-contrast, #fff)" : "var(--muted)",
              }}
            >
              {preset.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setHours(null)}
            className="rounded-lg px-2.5 py-1 text-xs font-bold transition-colors"
            style={{
              background: hours === null ? "var(--brand)" : "transparent",
              color: hours === null ? "var(--brand-contrast, #fff)" : "var(--muted)",
            }}
          >
            Full syllabus
          </button>
          <span className="text-[0.7rem] text-[var(--muted)]">
            Plan isi time ke hisaab se topics ko minutes baant dega.
          </span>
        </div>
      )}

      {/* ------------------------------- plan -------------------------------- */}
      {plan && plan.topics && plan.topics.length > 0 && (
        <div className="border-t px-4 py-3" style={{ borderColor: "var(--line)" }}>
          <PlanBands plan={plan} onJump={onJumpToTopic} />

          {plan.expected && plan.expected.length > 0 && (
            <ExpectedQuestions
              questions={plan.expected}
              topicTitle={(id) =>
                id ? (plan.topics ?? []).find((t) => t.topic.id === id)?.topic.title ?? null : null
              }
            />
          )}

          {plan.notes && plan.notes.length > 0 && (
            <ul className="mt-4 space-y-1.5 border-t pt-3" style={{ borderColor: "var(--line)" }}>
              {plan.notes.map((note, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[0.72rem] leading-relaxed text-[var(--muted)]">
                  <span className="mt-0.5 shrink-0">ℹ️</span>
                  {note}
                </li>
              ))}
            </ul>
          )}

          {/* Answer key + a paper with the same shape as the real thing */}
          <PaperOutputs questions={questions} plan={plan} />

          <QuizBox
            topics={plan.topics}
            subject={plan.subject ?? subject}
          />
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The two documents a student needs AFTER reading the plan: the answer key for
 * the papers they already sat, and a fresh paper with the same shape.
 *
 * Solutions are generated per paper so each paper's key stays in its own
 * printed order — mixing two years into one list makes it unusable against a
 * real sheet.
 */
function PaperOutputs({
  questions,
  plan,
}: {
  questions: PyqQuestion[];
  plan: ExamPlanResponse;
}) {
  const realQuestions = questions.filter((q) => !q.isVariant);
  const [mockNote, setMockNote] = useState<string | null>(null);
  if (realQuestions.length === 0) return null;

  const papers = groupByPaper(realQuestions);
  const subject = plan.subject ?? "";

  const getSolutions = async (paper: PaperGroup): Promise<string> => {
    const response = await fetch("/api/solutions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject,
        papers: [
          {
            label: paper.label,
            year: paper.year,
            questions: paper.questions.map((q) => ({
              text: q.text,
              marks: q.marks,
              number: q.number,
            })),
          },
        ],
      }),
    });
    const data: { ok: boolean; markdown?: string; error?: string } = await response.json();
    if (!data.ok || !data.markdown) throw new Error(data.error || "Solutions nahi ban paaye.");
    return data.markdown;
  };

  const getMockTest = async (): Promise<string> => {
    const response = await fetch("/api/mocktest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject,
        questions: realQuestions,
        topics: plan.topics ?? [],
      }),
    });
    const data: {
      ok: boolean;
      markdown?: string;
      structure?: { sections: number; totalMarks: number; years: string };
      error?: string;
    } = await response.json();
    if (!data.ok || !data.markdown) throw new Error(data.error || "Mock test nahi ban paaya.");

    // Echo what was actually measured in their papers, so "same pattern" is
    // a checkable claim rather than a promise.
    if (data.structure) {
      setMockNote(
        `Tumhare papers se nikaala gaya pattern: ${data.structure.sections} sections · ${data.structure.totalMarks} marks · ${data.structure.years}`,
      );
    }
    return data.markdown;
  };

  return (
    <div className="mt-5 space-y-3 border-t pt-4" style={{ borderColor: "var(--line)" }}>
      <div>
        <h3 className="text-sm font-extrabold">📜 Solutions & mock test</h3>
        <p className="mt-0.5 text-[0.72rem] leading-relaxed text-[var(--muted)]">
          Pehle apne purane papers ka poora answer key lo, phir usi pattern ka naya paper —
          structure copy kiya hua, sawaal naye.
        </p>
      </div>

      {papers.map((paper) => (
        <DocPanel
          key={paper.key}
          title={`${paper.label} ${paper.year} — ${paper.questions.length} sawaal ke solutions`}
          subtitle="Uttane hi order me jaise paper me the, working + marks breakdown ke saath."
          buttonLabel="Solutions banao"
          filename={`${paper.year}-${paper.label}-solutions`.replace(/[^\w-]+/g, "-").toLowerCase()}
          onGenerate={() => getSolutions(paper)}
        />
      ))}

      <DocPanel
        title="🧪 Mock test — in papers jaisa exact pattern"
        subtitle="Sections, sawaalon ki sankhya aur marks-per-question sab tumhare asli papers jaisa. Sawaal naye, topic wahi jo repeat hote hain."
        buttonLabel="Mock test banao"
        filename="mock-test"
        note={
          mockNote ??
          (plan.topics && plan.topics.length > 0
            ? `Topics: ${plan.topics.filter((t) => t.signal.trend === "repeating").length} repeating + ${
                plan.topics.filter((t) => t.signal.trend === "important").length
              } important se sawaal honge.`
            : null)
        }
        onGenerate={getMockTest}
      />
    </div>
  );
}

interface PaperGroup {
  key: string;
  label: string;
  year: string;
  questions: PyqQuestion[];
}

/** Buckets questions by the paper they were actually printed in. */
function groupByPaper(questions: PyqQuestion[]): PaperGroup[] {
  const map = new Map<string, PaperGroup>();
  for (const q of questions) {
    const key = `${q.paperLabel}|${q.paperYear}`;
    const group = map.get(key) ?? {
      key,
      label: q.paperLabel || "Question paper",
      year: q.paperYear || "",
      questions: [],
    };
    group.questions.push(q);
    map.set(key, group);
  }
  return [...map.values()];
}

/* -------------------------------------------------------------------------- */

function PlanBands({
  plan,
  onJump,
}: {
  plan: ExamPlanResponse;
  onJump: (topicId: string) => void;
}) {
  const topics = plan.topics ?? [];
  const mustCount = topics.filter((t) => t.band === "must").length;
  const mustMinutes = topics
    .filter((t) => t.band === "must")
    .reduce((sum, t) => sum + t.minutes, 0);

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-extrabold">Study order — highest marks per minute first</h3>
        <span className="text-[0.72rem] text-[var(--muted)]">
          {mustCount} must-do topics · ~{Math.round(mustMinutes / 60)}h · {plan.totalMarks ?? 0} marks
          seen across papers
        </span>
      </div>

      <div className="mt-3 space-y-4">
        {BAND_ORDER.map((band) => {
          const entries = topics.filter((t) => t.band === band);
          if (entries.length === 0) return null;
          return (
            <div key={band}>
              <p className="mb-1.5 text-[0.72rem] font-extrabold uppercase tracking-wide text-[var(--muted)]">
                {BAND_LABEL[band]} · {entries.length} topics · ~
                {Math.round(entries.reduce((s, t) => s + t.minutes, 0) / 60)}h
              </p>
              <ol className="space-y-1.5">
                {entries.map((entry) => (
                  <li key={entry.topic.id}>
                    <button
                      type="button"
                      onClick={() => onJump(entry.topic.id)}
                      className="flex w-full items-start gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors hover:border-[var(--brand)]"
                      style={{ borderColor: "var(--line)", background: "var(--surface-2)" }}
                    >
                      <span
                        className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg text-[0.7rem] font-extrabold text-white"
                        style={{
                          background:
                            band === "must"
                              ? "var(--bad)"
                              : band === "should"
                                ? "var(--warn)"
                                : "var(--muted)",
                        }}
                      >
                        {entry.priority}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[0.85rem] font-bold leading-snug">
                          {entry.topic.title}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5">
                          <span className="chip">{TREND_LABEL[entry.signal.trend]}</span>
                          {entry.signal.appearances > 0 && (
                            <span className="chip">
                              in {entry.signal.appearances}/{plan.papers?.length ?? 0} papers
                            </span>
                          )}
                          {entry.signal.totalMarks > 0 && (
                            <span className="chip">{entry.signal.totalMarks} marks</span>
                          )}
                          <span className="chip">~{entry.minutes} min</span>
                          {entry.signal.questions.length > 0 && (
                            <span className="chip">
                              {entry.signal.questions.length} past Q
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ExpectedQuestions({
  questions,
  topicTitle,
}: {
  questions: PyqQuestion[];
  topicTitle: (id?: string) => string | null;
}) {
  const [open, setOpen] = useState(true);
  const visible = open ? questions : questions.slice(0, 3);

  return (
    <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--line)" }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-extrabold">🔥 Most expected next exam</h3>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-[0.72rem] font-bold"
          style={{ color: "var(--brand)" }}
        >
          {open ? "Show less" : `Show all ${questions.length}`}
        </button>
      </div>
      <p className="mt-0.5 text-[0.72rem] text-[var(--muted)]">
        In papers ke repeating patterns se banaya gaya prediction — leaked paper nahi hai.
      </p>

      <ol className="mt-2.5 space-y-1.5">
        {visible.map((q, i) => {
          const title = topicTitle(q.topicId);
          return (
            <li
              key={q.id}
              className="rounded-xl border px-3 py-2"
              style={{ borderColor: "var(--line)", background: "var(--surface-2)" }}
            >
              <div className="flex gap-2.5">
                <span
                  className="mt-0.5 shrink-0 text-xs font-extrabold"
                  style={{ color: "var(--brand)" }}
                >
                  {i + 1}.
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[0.85rem] leading-relaxed">{q.text}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {q.marks && <span className="chip">{q.marks} marks</span>}
                    {title && <span className="chip">{title}</span>}
                    {q.paperLabel && <span className="chip">{q.paperLabel}</span>}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** Pulls a plausible year out of a filename like "ques2023_endsem.pdf". */
function guessYear(fileName: string): string | null {
  const match = /(20[0-2][0-9])/.exec(fileName);
  return match ? match[1] : null;
}
