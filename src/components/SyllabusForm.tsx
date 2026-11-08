"use client";

import { useState, type ReactNode } from "react";
import { LANGUAGES } from "@/lib/languages";
import { FileDropzone } from "./FileDropzone";
import { AlertIcon, GlobeIcon, PlayIcon, RefreshIcon, SearchIcon } from "./Icons";

interface SyllabusFormProps {
  syllabus: string;
  subject: string;
  onSubjectChange: (value: string) => void;
  language: string;
  onLanguageChange: (value: string) => void;
  perTopic: number;
  onPerTopicChange: (value: number) => void;
  /** Starts the analysis with the CURRENT textarea text (passed directly —
   *  typing itself never lifts state to the page). */
  onStart: (text: string) => void;
  onReset: () => void;
  onLoadSample: () => void;
  /** Called when an uploaded file's text has been extracted. */
  onFileText: (text: string, fileName: string) => void;
  /** Called when an uploaded file could not be read. */
  onFileError: (message: string) => void;
  busy: boolean;
  /** Short processing-stage label shown on the button while busy. */
  stage?: string | null;
  hasResults: boolean;
  error: string | null;
}

const MAX_CHARS = 24000;

/**
 * One labelled shelf of the form — like a photo editor's toolbar: the label
 * sits OUTSIDE the box and tells you what's inside before you touch it, so
 * the whole form reads top-to-bottom as a sequence instead of a wall of
 * inputs.
 */
function Group({
  icon,
  label,
  hint,
  children,
}: {
  icon: ReactNode;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div
      className="rounded-2xl border border-dashed p-3"
      style={{ borderColor: "var(--line)", background: "var(--surface-2)" }}
    >
      <p className="mb-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[0.7rem] font-extrabold uppercase tracking-wider text-[var(--muted)]">
        <span style={{ color: "var(--brand)" }} aria-hidden>
          {icon}
        </span>
        {label}
        {hint && (
          <span className="font-normal normal-case tracking-normal text-[0.68rem]">
            — {hint}
          </span>
        )}
      </p>
      {children}
    </div>
  );
}

export function SyllabusForm(props: SyllabusFormProps) {
  const {
    syllabus,
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
    stage,
    hasResults,
    error,
  } = props;

  // Typing buffer: the textarea holds its own text so every keystroke only
  // re-renders this form, not the whole page. The page's copy is adopted from
  // OUTSIDE (file extraction, sample, restore) by adjusting during render —
  // the documented alternative to a synchronizing effect — and the current
  // text travels to the page directly when Analyse is pressed.
  const [text, setText] = useState(syllabus);
  const [prevSyllabus, setPrevSyllabus] = useState(syllabus);
  if (syllabus !== prevSyllabus) {
    setPrevSyllabus(syllabus);
    setText(syllabus);
  }

  const tooLong = text.length > MAX_CHARS;

  return (
    <section className="card animate-fade-up p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold">1 · Syllabus daalo</h2>
          <p className="text-sm text-[var(--muted)]">
            Chapters, unit list, topic names — kuch bhi chalega. Browser AI (ya rule engine) har
            unit ke alag study topics bana dega.
          </p>
        </div>
        <button type="button" onClick={onLoadSample} className="btn-ghost px-3 py-1.5 text-sm">
          Try a sample syllabus
        </button>
      </div>

      <div className="mt-4 space-y-3">
        {/* Shelf 1 — the main input: file OR paste. */}
        <Group icon="📄" label="Syllabus" hint="file daalo ya seedha text paste karo">
          <FileDropzone
            onExtracted={onFileText}
            onError={onFileError}
            disabled={busy}
          />

          <label className="mt-3 block">
            <span className="mb-1.5 flex items-center justify-between text-sm font-semibold">
              Ya text paste karo
              <span
                className="font-mono text-xs font-normal"
                style={{ color: tooLong ? "var(--bad)" : "var(--muted)" }}
              >
                {text.length}/{MAX_CHARS}
              </span>
            </span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={9}
              aria-label="Syllabus text"
              placeholder={`Unit-I: Relations and Functions\n1. Types of relations, equivalence relations, one-one and onto functions…\n\nUnit-II: Algebra\n2. Matrices, determinants…`}
              className="field w-full resize-y px-3 py-2.5 text-sm leading-relaxed"
            />
          </label>
        </Group>

        {/* Shelf 2 — what kind of videos come back. */}
        <Group
          icon="🎥"
          label="Video settings"
          hint="kis language ke search links chahiye aur kitni per topic"
        >
          <div className="grid gap-3 sm:grid-cols-2">
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
                <PlayIcon width={16} height={16} /> Links per topic
              </span>
              <select
                value={perTopic}
                onChange={(e) => onPerTopicChange(Number(e.target.value))}
                className="field w-full px-3 py-2.5 text-sm"
              >
                {[2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n} search link{n > 1 ? "s" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Group>

        {/* Shelf 3 — optional context for better matching. */}
        <Group icon="🏷️" label="Subject" hint="optional — daaloge toh aur sahi match hoga">
          <input
            value={subject}
            onChange={(e) => onSubjectChange(e.target.value)}
            placeholder="e.g. Physics (JEE Main), Data Structures, UPSC GS2…"
            className="field w-full px-3 py-2.5 text-sm"
          />
        </Group>
      </div>

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
          onClick={() => onStart(text)}
          disabled={busy || tooLong || text.trim().length < 20}
          className="btn-primary flex items-center gap-2 px-5 py-3 text-sm"
        >
          {busy ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              {stage ?? "Analysing…"}
            </>
          ) : (
            <>
              <SearchIcon width={17} height={17} />
              Syllabus analyse karo →
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
          Topics nikalte hain → phir PYQ importance → uske baad search links
        </span>
      </div>
    </section>
  );
}
