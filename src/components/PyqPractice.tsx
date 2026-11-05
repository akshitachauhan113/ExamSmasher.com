"use client";

import { useState } from "react";
import { buildAnswer } from "@/lib/engine";
import { renderMarkdown } from "@/lib/markdown";
import type { AnswerResponse, PyqQuestion, Topic } from "@/lib/types";
import { AlertIcon, RefreshIcon } from "./Icons";
import { Tex } from "./Tex";

interface PyqPracticeProps {
  topic: Topic;
  /** Real past questions that map to THIS topic. */
  questions: PyqQuestion[];
  subject: string;
  /** Syllabus text, so the answer framework can quote the student's own points. */
  syllabus?: string;
  /** All extracted topics, so the answer can name the right one. */
  topics?: Topic[];
}

/**
 * Solve the actual past questions for one topic.
 *
 * The student can attempt first (so practice is active, not passive) and then
 * reveal an answer framework scaled to the question's real marks. It is
 * labelled a framework, not a verified model answer — it is built from the
 * syllabus the student pasted, not from a textbook we have not read.
 */
export function PyqPractice({ topic, questions, subject, syllabus, topics = [] }: PyqPracticeProps) {
  const [open, setOpen] = useState(false);

  if (questions.length === 0) return null;

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs font-bold"
        style={{ color: "var(--warn)" }}
      >
        📝 {questions.length} past question{questions.length > 1 ? "s" : ""} on this topic
        {open ? " — hide" : " — solve them"}
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {questions.map((question) => (
            <PracticeCard
              key={question.id}
              question={question}
              topicTitle={topic.title}
              subject={subject}
              syllabus={syllabus}
              topics={topics}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PracticeCard({
  question,
  topicTitle,
  subject,
  syllabus,
  topics,
}: {
  question: PyqQuestion;
  topicTitle: string;
  subject: string;
  syllabus?: string;
  topics: Topic[];
}) {
  const [attempt, setAttempt] = useState("");
  const [showAnswer, setShowAnswer] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [source, setSource] = useState<"ai" | "rules" | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selfMark, setSelfMark] = useState<"got" | "missed" | null>(null);

  const fetchAnswer = async () => {
    if (loading || answer) {
      setShowAnswer((s) => !s);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data: AnswerResponse = await buildAnswer({
        question: question.text,
        subject,
        topicTitle,
        marks: question.marks,
        year: question.paperYear,
        syllabus,
        topics,
      });
      if (!data.ok || !data.answer) throw new Error(data.error || "Could not write an answer.");
      setAnswer(data.answer);
      setSource(data.source ?? "rules");
      setShowAnswer(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not write an answer.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <article
      className="rounded-xl border p-3"
      style={{ borderColor: "var(--line)", background: "var(--surface-2)" }}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {question.paperYear && question.paperYear !== "Expected" && (
          <span className="chip">
            {question.paperYear} {question.paperLabel}
          </span>
        )}
        {question.number && <span className="chip">{question.number}</span>}
        {question.marks && <span className="chip">{question.marks} marks</span>}
        <span className="chip">{question.type}</span>
        {question.section && <span className="chip">{question.section}</span>}
        {(question.repeatCount ?? 1) > 1 && (
          <span className="chip" style={{ color: "var(--bad)" }}>
            🔁 repeated {question.repeatCount}×
          </span>
        )}
      </div>

      <p className="mt-2 text-[0.88rem] font-semibold leading-relaxed">
        <Tex text={question.text} />
      </p>

      {/* Active recall: write it out before looking. */}
      <textarea
        value={attempt}
        onChange={(e) => setAttempt(e.target.value)}
        rows={3}
        placeholder="Yahan apna answer likho (ya seedha model answer dekho)…"
        className="mt-2 w-full resize-y rounded-lg border bg-transparent px-2.5 py-2 text-[0.82rem] leading-relaxed outline-none"
        style={{ borderColor: "var(--line)" }}
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void fetchAnswer()}
          disabled={loading}
          className="btn-ghost flex items-center gap-1 px-2.5 py-1 text-xs disabled:opacity-50"
        >
          {loading ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--line)] border-t-[var(--brand)]" />
              Writing…
            </>
          ) : showAnswer ? (
            "Hide answer"
          ) : answer ? (
            <>
              <RefreshIcon width={12} height={12} /> Show answer
            </>
          ) : (
            "📖 Answer"
          )}
        </button>

        {attempt.trim().length > 10 && !showAnswer && (
          <span className="text-[0.7rem] text-[var(--muted)]">
            Attempt likha hua hai — ab answer se compare karo.
          </span>
        )}

        {showAnswer && (
          <>
            <button
              type="button"
              onClick={() => setSelfMark(selfMark === "got" ? null : "got")}
              className="rounded-lg px-2 py-1 text-xs font-bold"
              style={{ color: selfMark === "got" ? "var(--good)" : "var(--muted)" }}
            >
              {selfMark === "got" ? "✓ Got it" : "Mark: got it"}
            </button>
            <button
              type="button"
              onClick={() => setSelfMark(selfMark === "missed" ? null : "missed")}
              className="rounded-lg px-2 py-1 text-xs font-bold"
              style={{ color: selfMark === "missed" ? "var(--bad)" : "var(--muted)" }}
            >
              {selfMark === "missed" ? "✗ Missed it" : "Mark: missed"}
            </button>
          </>
        )}
      </div>

      {error && (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs" style={{ color: "var(--bad)" }}>
          <span className="mt-0.5 shrink-0">
            <AlertIcon width={13} height={13} />
          </span>
          {error}
        </p>
      )}

      {/* The answer, scaled to the question's real marks — headings, steps,
          and equations typeset instead of raw LaTeX. */}
      {showAnswer && answer && (
        <>
          <div
            className="plan-markdown mt-2.5 rounded-lg p-3 text-[0.82rem] leading-relaxed"
            style={{ background: "var(--surface)" }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(answer) }}
          />
          <p
            className="mt-1.5 text-[0.68rem] text-[var(--muted)]"
            title={
              source === "ai"
                ? "Written by the model running locally in this browser"
                : "An answer framework built from your own syllabus — not a verified textbook answer"
            }
          >
            {source === "ai"
              ? "🧠 Browser AI model ne likha — apne textbook se match zaroor karna."
              : "📄 Syllabus se bana answer framework — ye verified textbook answer nahi hai."}
          </p>
        </>
      )}

      {showAnswer && attempt.trim().length > 10 && !answer && !loading && (
        <p className="mt-1.5 text-[0.7rem] text-[var(--muted)]">
          Apna attempt upar likha hai — answer khulne ke baad khud compare karo.
        </p>
      )}
    </article>
  );
}
