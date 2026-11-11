"use client";

import { useMemo, useState } from "react";
import { fullNotes } from "@/lib/engine";
import type { EngineSource, FullNotesResponse, NotesLang, Topic } from "@/lib/types";
import { downloadFile } from "@/lib/exporters";
import { renderMarkdown } from "@/lib/markdown";
import { useNotesLang } from "@/lib/notesLang";
import { AlertIcon, BookIcon, CopyIcon, DownloadIcon } from "./Icons";
import { NotesLangToggle } from "./NotesLangToggle";

interface FullNotesProps {
  syllabus: string;
  subject: string;
  /** Extracted topics, so the rule engine can split the document by unit. */
  topics: Topic[];
}

/* --------------------------- saved documents --------------------------- */

const STORAGE_KEY = "es-fullnotes-v1";
const MAX_STORED = 6;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface StoredDoc {
  at: number;
  markdown: string;
  source?: EngineSource;
  via?: "server" | "browser";
}

/** FNV-1a — cheap content hash for cache keys (syllabus can be large). */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Identity of one generated document: syllabus + subject + language + scope. */
function docSig(syllabus: string, subject: string, lang: NotesLang, unit: string): string {
  return `${lang}|${unit}|${fnv1a(`${subject}###${syllabus}`)}`;
}

function readStored(sig: string): StoredDoc | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const store = JSON.parse(raw) as Record<string, StoredDoc>;
    const entry = store[sig];
    return entry && Date.now() - entry.at <= TTL_MS && typeof entry.markdown === "string"
      ? entry
      : null;
  } catch {
    return null;
  }
}

function writeStored(sig: string, doc: StoredDoc): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const store: Record<string, StoredDoc> = raw ? (JSON.parse(raw) as Record<string, StoredDoc>) : {};
    store[sig] = doc;
    // LRU cap so a semester of syllabi cannot blow the storage quota.
    const sigs = Object.keys(store).sort((a, b) => store[b].at - store[a].at);
    for (const stale of sigs.slice(MAX_STORED)) delete store[stale];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* storage blocked — the document just won't survive a refresh */
  }
}

/**
 * Whole-syllabus (or ONE unit's) notes in one go — read it top to bottom
 * like a textbook chapter, rather than clicking into topic after topic.
 *
 * The server-side model writes it when a key is configured; otherwise the
 * rule engine in this browser does. Either way the document is saved
 * locally per scope + language, so a refresh brings it straight back.
 */
export function FullNotesPanel({ syllabus, subject, topics }: FullNotesProps) {
  const [open, setOpen] = useState(false);
  const [markdown, setMarkdown] = useState<string | null>(null);
  /** Which language the current markdown was written in — a flip means rebuild. */
  const [builtFor, setBuiltFor] = useState<NotesLang | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /** Which engine wrote the document currently on screen. */
  const [source, setSource] = useState<EngineSource | null>(null);
  const [via, setVia] = useState<"server" | "browser" | undefined>(undefined);
  /** "" = the whole syllabus; otherwise one unit/chapter (unit-wise notes). */
  const [unit, setUnit] = useState<string>("");
  const [lang] = useNotesLang();

  const units = useMemo(
    () => [...new Set(topics.map((topic) => topic.chapter).filter((c): c is string => Boolean(c)))],
    [topics],
  );

  const sig = docSig(syllabus, subject, lang, unit);

  // Restore the saved document for THIS scope + language (a refresh never
  // loses it), and drop the on-screen copy when the scope/language changes.
  // Done during render (the React-recommended "adjust state when a prop
  // changes" pattern) — it runs exactly once per scope change.
  const [restoredFor, setRestoredFor] = useState<string | null>(null);
  if (restoredFor !== sig) {
    setRestoredFor(sig);
    const stored = readStored(sig);
    if (stored) {
      setMarkdown(stored.markdown);
      setSource(stored.source ?? "rules");
      setVia(stored.via);
      setBuiltFor(lang);
      setOpen(true);
    } else {
      setMarkdown(null);
      setSource(null);
      setVia(undefined);
      setBuiltFor(null);
    }
    setError(null);
  }

  const fresh = markdown !== null && builtFor === lang;

  const generate = async (force = false) => {
    if (loading) return;
    setOpen(true);
    // `fresh` skips a rebuild when the document is already in this language;
    // `force` is what the "Dobara banao" button passes to override that.
    if (fresh && !force) return;

    setLoading(true);
    setError(null);
    try {
      const data: FullNotesResponse = await fullNotes({
        syllabus,
        subject,
        topics,
        language: lang,
        unit: unit || undefined,
      });
      if (!data.ok || !data.markdown) {
        throw new Error(data.error || "Notes nahi ban paaye.");
      }
      setMarkdown(data.markdown);
      setSource(data.source ?? "rules");
      setVia(data.via);
      setBuiltFor(lang);
      writeStored(sig, {
        at: Date.now(),
        markdown: data.markdown,
        source: data.source ?? "rules",
        via: data.via,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Notes banate waqt dikkat aa gayi.");
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!markdown) return;
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Copy nahi hua — Download use kar lo.");
    }
  };

  const scopeSlug = (unit || "syllabus").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase();

  return (
    <section className="card mt-6">
      <header className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-[1.05rem] font-extrabold">
            {unit ? `📖 ${unit} — detailed notes` : "📖 Poore syllabus ke detailed notes"}
          </h2>
          <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">
            Unit-wise ya poore syllabus ke notes ek click me — concept samajh aaye aise detail me,
            har section ke end me <em>“Exam corner”</em> ke saath. Neeche se padho, ya download kar
            le.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-[var(--muted)]">
            Scope
            <select
              value={unit}
              onChange={(event) => setUnit(event.target.value)}
              aria-label="Notes scope — whole syllabus or one unit"
              className="max-w-[14rem] truncate rounded-lg border px-2 py-1.5 text-xs font-semibold"
              style={{ background: "var(--surface)", borderColor: "var(--line)", color: "var(--text)" }}
            >
              <option value="">Poora syllabus</option>
              {units.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          <NotesLangToggle />
          <button
            type="button"
            onClick={() => void generate(true)}
            disabled={loading}
            className="btn-primary flex items-center gap-1.5 px-3.5 py-2 text-xs disabled:opacity-60"
          >
            {loading ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Likha ja raha hai…
              </>
            ) : fresh ? (
              <>
                <BookIcon width={14} height={14} /> Dobara banao
              </>
            ) : (
              <>
                <BookIcon width={14} height={14} /> Notes banao
              </>
            )}
          </button>

          {markdown && !fresh && !loading && (
            <p className="w-full text-right text-[0.65rem] font-semibold" style={{ color: "var(--warn)" }}>
              Language badal di — Notes banao dabao, nayi language me ban jayenge.
            </p>
          )}

          {markdown && !loading && (
            <>
              <button
                type="button"
                onClick={() =>
                  downloadFile(
                    `${subject.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "syllabus"}-${scopeSlug}-notes.md`,
                    markdown,
                    "text/markdown",
                  )
                }
                className="btn-ghost flex items-center gap-1 px-2.5 py-2 text-xs"
                aria-label="Download notes as Markdown"
              >
                <DownloadIcon width={13} height={13} /> Download
              </button>
              <button
                type="button"
                onClick={() => void copy()}
                className="btn-ghost flex items-center gap-1 px-2.5 py-2 text-xs"
                aria-label="Copy notes"
              >
                <CopyIcon width={13} height={13} /> {copied ? "Ho gaya ✓" : "Copy"}
              </button>
            </>
          )}
        </div>
      </header>

      {open && (
        <div className="border-t border-[var(--line)] px-4 py-3">
          {loading && (
            <div className="space-y-2.5">
              <div className="skeleton h-3.5 w-1/3 rounded" />
              <div className="skeleton h-3 w-full rounded" />
              <div className="skeleton h-3 w-11/12 rounded" />
              <div className="skeleton h-3 w-4/5 rounded" />
              <p className="pt-1.5 text-xs text-[var(--muted)]">
                {unit ? `${unit} padh raha hoon` : "Pura syllabus padh raha hoon"} aur notes likh
                raha hoon — lamba document banega, thoda sabr rakh…
              </p>
            </div>
          )}

          {error && (
            <p
              className="flex items-start gap-1.5 text-xs leading-relaxed"
              style={{ color: "var(--bad)" }}
            >
              <span className="mt-0.5 shrink-0">
                <AlertIcon width={13} height={13} />
              </span>
              {error}
            </p>
          )}

          {markdown && !loading && (
            <article
              /* Reuses the study-plan Markdown styling. The renderer escapes
                 every character before rebuilding tags, so model output cannot
                 inject markup into the page. */
              className="plan-markdown max-h-[65vh] overflow-y-auto pr-2"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
            />
          )}

          {markdown && !loading && (
            <p
              className="mt-2 border-t pt-2 text-[0.68rem] text-[var(--muted)]"
              style={{ borderColor: "var(--line)" }}
              title={
                via === "server"
                  ? "Written by the site's server-side model — the API key never reaches your browser"
                  : source === "ai"
                    ? "Generated by the model running locally in this browser"
                    : "Built deterministically from the syllabus you pasted"
              }
            >
              {via === "server"
                ? "🧠 AI notes — site ke server par likha gaya (key browser me nahi aayi), sirf tumhare syllabus se. Saved copy refresh ke baad bhi wahi milega."
                : source === "ai"
                  ? "🧠 Browser AI model se likha gaya — sirf tumhare syllabus se, is device par."
                  : "📄 Rule engine se bana — tumhare syllabus ke har line se, bina kisi model ke."}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
