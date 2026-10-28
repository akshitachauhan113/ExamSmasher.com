"use client";

import { LANGUAGES } from "@/lib/languages";
import { FileDropzone } from "./FileDropzone";
import { AlertIcon, GlobeIcon, PlayIcon, RefreshIcon, SearchIcon } from "./Icons";

interface SyllabusFormProps {
  syllabus: string;
  onSyllabusChange: (value: string) => void;
  subject: string;
  onSubjectChange: (value: string) => void;
  language: string;
  onLanguageChange: (value: string) => void;
  perTopic: number;
  onPerTopicChange: (value: number) => void;
  onStart: () => void;
  onReset: () => void;
  onLoadSample: () => void;
  /** Called when an uploaded file's text has been extracted. */
  onFileText: (text: string, fileName: string) => void;
  /** Called when an uploaded file could not be read. */
  onFileError: (message: string) => void;
  busy: boolean;
  hasResults: boolean;
  error: string | null;
}

const MAX_CHARS = 8000;

export function SyllabusForm(props: SyllabusFormProps) {
  const {
    syllabus,
    onSyllabusChange,
    subject,
    onSubjectChange,
    language,
    onLanguageChange,
    perTopic,
    onPerTopicChange,
    onStart,
    onReset,
    onLoadSample,
    onFileText,
    onFileError,
    busy,
    hasResults,
    error,
  } = props;

  const tooLong = syllabus.length > MAX_CHARS;

  return (
    <section className="card animate-fade-up p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold">1 · Paste your syllabus</h2>
          <p className="text-sm text-[var(--muted)]">
            Chapters, unit list, topic names — anything works. The AI will break it into study
            topics.
          </p>
        </div>
        <button type="button" onClick={onLoadSample} className="btn-ghost px-3 py-1.5 text-sm">
          Try a sample syllabus
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
            <GlobeIcon width={16} height={16} /> Video language
          </span>
          <select
            value={language}
            onChange={(e) => onLanguageChange(e.target.value)}
            className="field w-full px-3 py-2.5 text-sm"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold">
            <PlayIcon width={16} height={16} /> Videos per topic
          </span>
          <select
            value={perTopic}
            onChange={(e) => onPerTopicChange(Number(e.target.value))}
            className="field w-full px-3 py-2.5 text-sm"
          >
            {[1, 2, 3, 4, 5, 6, 8].map((n) => (
              <option key={n} value={n}>
                {n} best video{n > 1 ? "s" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="mt-3 block">
        <span className="mb-1.5 block text-sm font-semibold">
          Course / subject <span className="font-normal text-[var(--muted)]">(optional)</span>
        </span>
        <input
          value={subject}
          onChange={(e) => onSubjectChange(e.target.value)}
          placeholder="e.g. Physics (JEE Main), Data Structures, UPSC GS2…"
          className="field w-full px-3 py-2.5 text-sm"
        />
      </label>

      <div className="mt-4">
        <FileDropzone
          onExtracted={onFileText}
          onError={onFileError}
          disabled={busy}
        />
      </div>

      <label className="mt-3 block">
        <span className="mb-1.5 flex items-center justify-between text-sm font-semibold">
          Syllabus text
          <span
            className="font-mono text-xs font-normal"
            style={{ color: tooLong ? "var(--bad)" : "var(--muted)" }}
          >
            {syllabus.length}/{MAX_CHARS}
          </span>
        </span>
        <textarea
          value={syllabus}
          onChange={(e) => onSyllabusChange(e.target.value)}
          rows={9}
          placeholder={`Unit-I: Relations and Functions\n1. Types of relations, equivalence relations, one-one and onto functions…\n\nUnit-II: Algebra\n2. Matrices, determinants…`}
          className="field w-full resize-y px-3 py-2.5 text-sm leading-relaxed"
        />
      </label>

      {error && (
        <p
          className="mt-3 flex items-start gap-2 rounded-xl border px-3 py-2 text-sm"
          style={{
            borderColor: "color-mix(in srgb, var(--bad) 40%, var(--line))",
            color: "var(--bad)",
          }}
        >
          <span className="mt-0.5 shrink-0">
            <AlertIcon width={16} height={16} />
          </span>
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onStart}
          disabled={busy || tooLong || syllabus.trim().length < 20}
          className="btn-primary flex items-center gap-2 px-5 py-3 text-sm"
        >
          {busy ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              Analysing…
            </>
          ) : (
            <>
              <SearchIcon width={17} height={17} />
              Analyse syllabus &amp; find best videos
            </>
          )}
        </button>

        {hasResults && (
          <button
            type="button"
            onClick={onReset}
            disabled={busy}
            className="btn-ghost flex items-center gap-2 px-4 py-3 text-sm"
          >
            <RefreshIcon width={16} height={16} /> Start over
          </button>
        )}

        <span className="text-xs text-[var(--muted)]">
          AI extracts topics → YouTube search → content match → ranked videos
        </span>
      </div>
    </section>
  );
}
