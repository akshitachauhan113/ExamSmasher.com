"use client";

import { useCallback, useState } from "react";
import { buildQuiz, type QuizTopicInput } from "@/lib/engine";
import type { EngineSource, ExamTopic, QuizQuestion, QuizResponse } from "@/lib/types";
import { AlertIcon, RefreshIcon } from "./Icons";

interface QuizBoxProps {
  topics: ExamTopic[];
  subject: string;
}

const QUIZ_SIZES = [
  { label: "5 Q", count: 5 },
  { label: "10 Q", count: 10 },
  { label: "15 Q", count: 15 },
];

/**
 * Practice quiz built from the student's REAL past questions, weighted toward
 * the topics their papers actually repeat. Answering reveals the explanation
 * immediately so it doubles as revision.
 */
export function QuizBox({ topics, subject }: QuizBoxProps) {
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [count, setCount] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  /** Which engine produced this set of questions — shown in the result. */
  const [source, setSource] = useState<EngineSource | null>(null);

  const start = useCallback(
    async (size: number) => {
      setLoading(true);
      setError(null);
      try {
        // Weight the quiz toward repeating topics — that is what the exam does.
        const chosen: QuizTopicInput[] = [...topics]
          .sort((a, b) => b.signal.examScore - a.signal.examScore)
          .slice(0, Math.max(6, size))
          .map((entry) => ({
            id: entry.topic.id,
            title: entry.topic.title,
            chapter: entry.topic.chapter,
            keywords: entry.topic.keywords,
            description: entry.topic.description,
            importance: entry.topic.importance,
            difficulty: entry.topic.difficulty,
            pastQuestions: entry.signal.questions.slice(0, 4).map((q) => ({
              text: q.text,
              year: q.paperYear,
              label: q.paperLabel,
              marks: q.marks,
            })),
          }));

        const data: QuizResponse = await buildQuiz({ subject, count: size, topics: chosen });
        if (!data.ok || !data.questions?.length) {
          throw new Error(data.error || "Could not build the quiz.");
        }

        setSource(data.source ?? "rules");
        setQuestions(data.questions);
        setIndex(0);
        setPicked(null);
        setRevealed(false);
        setScore(0);
        setAnswers([]);
        setStarted(true);
        setCount(size);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Quiz failed.");
      } finally {
        setLoading(false);
      }
    },
    [topics, subject],
  );

  const pick = (optionIndex: number) => {
    if (revealed) return;
    setPicked(optionIndex);
  };

  const confirm = () => {
    if (picked === null || revealed) return;
    const current = questions[index];
    const right = picked === current.answer;
    setRevealed(true);
    setScore((s) => s + (right ? 1 : 0));
    setAnswers((prev) => [...prev, right ? 1 : 0]);
  };

  const next = () => {
    setPicked(null);
    setRevealed(false);
    setIndex((i) => i + 1);
  };

  const finished = started && index >= questions.length;
  const current = questions[index];

  return (
    <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--line)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-extrabold">⚡ Quiz — test yourself</h3>
        {!started && (
          <div className="flex flex-wrap gap-1.5">
            {QUIZ_SIZES.map((size) => (
              <button
                key={size.count}
                type="button"
                disabled={loading}
                onClick={() => {
                  setCount(size.count);
                  void start(size.count);
                }}
                className="btn-ghost px-2.5 py-1 text-xs disabled:opacity-50"
              >
                {size.label}
              </button>
            ))}
          </div>
        )}
        {started && !finished && (
          <button
            type="button"
            onClick={() => void start(count)}
            disabled={loading}
            className="flex items-center gap-1 text-[0.72rem] font-bold text-[var(--muted)] hover:text-[var(--text)]"
          >
            <RefreshIcon width={12} height={12} /> New quiz
          </button>
        )}
      </div>

      {loading && (
        <p className="mt-2 text-xs text-[var(--muted)]">Aapke real PYQs se quiz bana raha hoon…</p>
      )}

      {error && (
        <p className="mt-2 flex items-start gap-1.5 text-xs" style={{ color: "var(--bad)" }}>
          <span className="mt-0.5 shrink-0">
            <AlertIcon width={13} height={13} />
          </span>
          {error}
        </p>
      )}

      {!started && !loading && !error && (
        <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
          Repeat hone wale topics se sawaal — wahi cheez jo exam me sabse zyada aati hai.
        </p>
      )}

      {started && !finished && current && (
        <div className="mt-3 rounded-xl border p-3" style={{ borderColor: "var(--line)", background: "var(--surface-2)" }}>
          <div className="flex items-center justify-between gap-2 text-[0.72rem] text-[var(--muted)]">
            <span>
              Question {index + 1} / {questions.length}
            </span>
            <span>
              Score {score}/{answers.length}
            </span>
          </div>

          <p className="mt-2 text-[0.9rem] font-bold leading-relaxed">{current.question}</p>

          <ul className="mt-2.5 space-y-1.5">
            {current.options.map((option, i) => {
              const isPicked = picked === i;
              const isCorrect = i === current.answer;
              const state = !revealed
                ? isPicked
                  ? "picked"
                  : "idle"
                : isCorrect
                  ? "correct"
                  : isPicked
                    ? "wrong"
                    : "idle";

              return (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => pick(i)}
                    disabled={revealed}
                    className="flex w-full items-start gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[0.82rem] transition-colors"
                    style={{
                      borderColor:
                        state === "correct"
                          ? "var(--good)"
                          : state === "wrong"
                            ? "var(--bad)"
                            : state === "picked"
                              ? "var(--brand)"
                              : "var(--line)",
                      background:
                        state === "correct"
                          ? "color-mix(in srgb, var(--good) 10%, transparent)"
                          : state === "wrong"
                            ? "color-mix(in srgb, var(--bad) 10%, transparent)"
                            : state === "picked"
                              ? "color-mix(in srgb, var(--brand) 10%, transparent)"
                              : "transparent",
                    }}
                  >
                    <span className="shrink-0 font-extrabold">
                      {String.fromCharCode(65 + i)}.
                    </span>
                    <span>{option}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          {!revealed ? (
            <button
              type="button"
              onClick={confirm}
              disabled={picked === null}
              className="btn-primary mt-3 px-3 py-1.5 text-xs disabled:opacity-50"
            >
              Check answer
            </button>
          ) : (
            <div className="mt-3">
              {current.explanation && (
                <p className="rounded-lg p-2.5 text-[0.8rem] leading-relaxed" style={{ background: "var(--surface)" }}>
                  <strong>{picked === current.answer ? "Sahi! ✅" : "Galat ❌ "}</strong>
                  {current.explanation}
                </p>
              )}
              <button type="button" onClick={next} className="btn-primary mt-2 px-3 py-1.5 text-xs">
                {index + 1 >= questions.length ? "See result →" : "Next question →"}
              </button>
            </div>
          )}
        </div>
      )}

      {finished && (
        <div className="mt-3 rounded-xl border p-4 text-center" style={{ borderColor: "var(--line)", background: "var(--surface-2)" }}>
          <p className="text-lg font-extrabold" style={{ color: score >= questions.length * 0.7 ? "var(--good)" : "var(--warn)" }}>
            {score} / {questions.length}
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {score >= questions.length * 0.8
              ? "Solid — ye topics exam ke liye taiyaar hain."
              : score >= questions.length * 0.5
                ? "Theek hai — galat wale topics ke notes dobara padho."
                : "Ye topics abhi kamzor hain — must-do band se shuru karo."}
          </p>
          <p
            className="mt-1.5 text-[0.68rem] text-[var(--muted)]"
            title={
              source === "ai"
                ? "Questions written by the model running locally in this browser"
                : "Questions assembled from your own syllabus lines and real past questions"
            }
          >
            {source === "ai"
              ? "🧠 Browser AI model se bane sawaal — apne syllabus se check karo."
              : "📄 Aapke syllabus aur asli PYQs se bane sawaal — ye past paper ke sawaal nahi hain."}
          </p>
          <div className="mt-3 flex justify-center gap-2">
            <button type="button" onClick={() => void start(count)} className="btn-primary px-3 py-1.5 text-xs">
              Try another quiz
            </button>
            <button
              type="button"
              onClick={() => {
                setStarted(false);
                setQuestions([]);
              }}
              className="btn-ghost px-3 py-1.5 text-xs"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
