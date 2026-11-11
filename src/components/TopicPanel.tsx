"use client";

import { useState } from "react";
import { CheckIcon } from "@/components/Icons";
import { AlertIcon } from "@/components/Icons";
import { BAND_LABEL, TREND_LABEL } from "@/lib/exam";
import type { ExamTopic, PyqQuestion, Topic, TopicResult } from "@/lib/types";
import { PyqPractice } from "./PyqPractice";
import { TopicNotes } from "./TopicNotes";
import { TopicVideos, useTopicVideos } from "./TopicVideos";
import { VideoPlayerModal, type PlayerVideo } from "./VideoPlayerModal";

const BAND_COLOR: Record<ExamTopic["band"], string> = {
  must: "var(--bad)",
  should: "var(--warn)",
  "if-time": "var(--muted)",
};

interface TopicPanelProps {
  topic: Topic;
  index: number;
  result?: TopicResult;
  studied: boolean;
  /** Course name and syllabus excerpt for the notes generator. */
  subject: string;
  syllabus: string;
  /** Set once Exam Mode has ranked this topic against the real papers. */
  examEntry?: ExamTopic;
  /** Must / Might / Can skip — from PYQ trend when available, else syllabus. */
  band: ExamTopic["band"];
  /** Real past questions that map to this topic. */
  pyqQuestions?: PyqQuestion[];
  /** Language code from the form (en / hi / hinglish / …) — video queries. */
  language: string;
  /** ALL syllabus topics — per-topic video coverage is measured against these. */
  allTopics: Topic[];
  subtopicsByTopicId: Record<string, string[]>;
  onToggleStudied: () => void;
}

/**
 * ONE surface per syllabus topic: what the exam asks (real PYQ), what to
 * watch (a real recommended YouTube video + alternatives, discovered
 * server-side), what to read (12-element notes), and a completion tick —
 * without navigating anywhere else.
 */
export function TopicPanel({
  topic,
  index,
  result,
  studied,
  subject,
  syllabus,
  examEntry,
  band,
  pyqQuestions,
  language,
  allTopics,
  subtopicsByTopicId,
  onToggleStudied,
}: TopicPanelProps) {
  /* ---- real videos for THIS topic (lazy, batched, cached) ---- */
  const videos = useTopicVideos({
    topic,
    subject,
    language,
    allTopics,
    subtopicsByTopicId,
    enabled: Boolean(result) && !result?.skipped,
  });

  /* ---- the four per-topic actions, all driven from here ---- */
  const [notesOpen, setNotesOpen] = useState(false);
  const [preview, setPreview] = useState<PlayerVideo | null>(null);

  const recommended = videos.videos && videos.videos.length > 0 ? videos.videos[0] : null;
  const videoCount = videos.videos?.length ?? 0;

  const focusNotes = () => {
    setNotesOpen(true);
    document.getElementById(`topic-notes-${topic.id}`)?.scrollIntoView({ block: "nearest" });
  };

  const playRecommended = () => {
    if (!recommended) return;
    setPreview({ id: recommended.id, title: recommended.title, channelTitle: recommended.channel });
  };

  const focusOthers = () => {
    document.getElementById(`topic-others-${topic.id}`)?.scrollIntoView({ block: "nearest" });
  };

  return (
    <section
      id={`topic-${topic.id}`}
      data-topic-id={topic.id}
      className="scroll-mt-28"
      style={{
        contentVisibility: "auto",
        opacity: studied ? 0.72 : 1,
        transition: "opacity .25s ease",
      }}
    >
      <header className="mb-3 flex items-start gap-3">
        <span
          className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl text-sm font-extrabold text-white"
          style={{
            background: studied
              ? "var(--good)"
              : "linear-gradient(135deg, var(--brand), var(--brand-2))",
          }}
        >
          {studied ? <CheckIcon width={17} height={17} /> : index + 1}
        </span>

        <div className="min-w-0 flex-1">
          <h3
            className="text-[1.05rem] font-extrabold leading-tight"
            style={
              studied
                ? { textDecoration: "line-through", textDecorationColor: "var(--good)" }
                : undefined
            }
          >
            {topic.title}
          </h3>

          {topic.description && (
            <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{topic.description}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {/* Must / Might / Can skip — the one tag that decides study order */}
            <span
              className="chip font-bold"
              style={{
                color: BAND_COLOR[band],
                borderColor: `color-mix(in srgb, ${BAND_COLOR[band]} 50%, var(--line))`,
              }}
              title={
                examEntry
                  ? "Ranked by how many marks this topic is worth per minute of study"
                  : "Syllabus importance — upload past papers for the real exam trend"
              }
            >
              {BAND_LABEL[band]}
              {examEntry ? ` · #${examEntry.priority}` : ""}
            </span>
            {examEntry && examEntry.signal.trend !== "rare" && (
              <span className="chip">{TREND_LABEL[examEntry.signal.trend]}</span>
            )}
            {examEntry && examEntry.signal.totalMarks > 0 && (
              <span className="chip">{examEntry.signal.totalMarks} marks in papers</span>
            )}
            {topic.chapter && <span className="chip">{topic.chapter}</span>}
            <span className="chip">{topic.difficulty}</span>
            <span className="chip">~{topic.estimatedMinutes} min</span>
            {examEntry && <span className="chip">plan: {examEntry.minutes} min</span>}
          </div>
        </div>
      </header>

      <div className="ml-0 space-y-3 sm:ml-11">
        {/* The four per-topic actions in one row — notes, the recommended
            video, the alternatives, and the completion tick. */}
        <div
          className="flex flex-wrap gap-1.5"
          role="group"
          aria-label={`Actions for ${topic.title}`}
        >
          <button
            type="button"
            onClick={focusNotes}
            aria-expanded={notesOpen}
            className="btn-ghost flex items-center gap-1 px-2.5 py-1 text-xs"
          >
            📒 View Notes
          </button>
          <button
            type="button"
            onClick={playRecommended}
            disabled={!recommended}
            title={
              recommended
                ? `Preview: ${recommended.title}`
                : videos.status === "loading"
                  ? "Videos load ho rahe hain…"
                  : "Is topic ke liye abhi koi video nahi mila"
            }
            className="btn-primary flex items-center gap-1 px-2.5 py-1 text-xs"
          >
            ▶ Watch recommended video
          </button>
          <button
            type="button"
            onClick={focusOthers}
            disabled={videoCount < 2}
            title={
              videoCount >= 2
                ? "Alternative lectures dekho"
                : "Abhi alternatives nahi mile"
            }
            className="btn-ghost flex items-center gap-1 px-2.5 py-1 text-xs"
          >
            🎞 View other videos{videoCount > 1 ? ` (${videoCount - 1})` : ""}
          </button>
          <button
            type="button"
            onClick={onToggleStudied}
            aria-pressed={studied}
            className="btn-ghost flex items-center gap-1 px-2.5 py-1 text-xs"
            style={
              studied
                ? {
                    borderColor: "color-mix(in srgb, var(--good) 55%, var(--line))",
                    color: "var(--good)",
                  }
                : undefined
            }
          >
            <span
              className="grid h-4 w-4 place-items-center rounded border"
              style={{
                borderColor: studied ? "var(--good)" : "var(--line)",
                background: studied ? "var(--good)" : "transparent",
              }}
            >
              {studied && <CheckIcon width={11} height={11} />}
            </span>
            {studied ? "Completed ✓" : "Mark as completed"}
          </button>
        </div>

        {/* What the exam actually asks — shown first so the student knows what
            to watch FOR rather than watching passively. */}
        {pyqQuestions && pyqQuestions.length > 0 && (
          <PyqPractice
            topic={topic}
            questions={pyqQuestions}
            subject={subject}
            syllabus={syllabus}
            topics={[topic]}
          />
        )}

        {result?.skipped && (
          <div className="rounded-xl border border-dashed border-[var(--line)] px-4 py-4 text-sm text-[var(--muted)]">
            ✅ Tumne ye topic pehle padh liya hai — isliye search links skip kar di.
          </div>
        )}

        {!result && <SkeletonCard />}
        {!result && <SkeletonCard />}

        {result?.error && (
          <div
            className="rounded-xl border px-3 py-2.5 text-sm"
            style={{
              borderColor: "color-mix(in srgb, var(--bad) 40%, var(--line))",
              background: "color-mix(in srgb, var(--bad) 6%, var(--surface))",
            }}
          >
            <p className="flex items-start gap-2 font-semibold" style={{ color: "var(--bad)" }}>
              <span className="mt-0.5 shrink-0">
                <AlertIcon width={15} height={15} />
              </span>
              Search links nahi ban paaye
            </p>
            <p className="mt-1 pl-6 text-xs text-[var(--muted)]">{result.error}</p>
          </div>
        )}

        {/* Real YouTube videos for this topic — one recommendation plus
            alternatives; honest search-link fallback inside when discovery
            is unavailable. */}
        <TopicVideos
          topic={topic}
          state={videos}
          searches={result?.searches ?? []}
          queries={result?.queries ?? []}
          totalTopics={allTopics.length}
          onRetry={videos.retry}
          onPreview={setPreview}
        />

        {/* Notes + flashcards for this topic, straight from the syllabus */}
        <TopicNotes
          topic={topic}
          subject={subject}
          syllabus={syllabus}
          examQuestions={pyqQuestions?.map((q) => q.text)}
          open={notesOpen}
          onOpenChange={setNotesOpen}
        />
      </div>

      {/* In-app preview of a REAL video id — watch here, close, and you are
          exactly where you left off. */}
      <VideoPlayerModal video={preview} onClose={() => setPreview(null)} />
    </section>
  );
}

function SkeletonCard() {
  return (
    <div className="card flex gap-3 p-3">
      <div className="skeleton aspect-video w-full shrink-0 rounded-xl sm:w-52" />
      <div className="flex-1 space-y-2 py-1">
        <div className="skeleton h-4 w-4/5 rounded" />
        <div className="skeleton h-3 w-2/5 rounded" />
        <div className="flex gap-1.5 pt-1">
          <div className="skeleton h-5 w-20 rounded-full" />
          <div className="skeleton h-5 w-24 rounded-full" />
          <div className="skeleton h-5 w-16 rounded-full" />
        </div>
      </div>
    </div>
  );
}
