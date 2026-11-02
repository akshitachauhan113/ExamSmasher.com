"use client";

import { useNotesLang } from "@/lib/notesLang";

/**
 * "English | Hinglish" switch for generated study material.
 *
 * Sits in the header of every notes panel like a tool option in an editor —
 * you can see the setting before you press Generate, and flipping it here
 * flips it in the other notes panels too.
 */
export function NotesLangToggle() {
  const [lang, setLang] = useNotesLang();

  const base =
    "px-2.5 py-1 text-[0.7rem] font-bold transition-colors rounded-md";

  return (
    <div
      className="flex items-center gap-1 rounded-lg border px-1 py-0.5"
      style={{ borderColor: "var(--line)", background: "var(--surface)" }}
      role="group"
      aria-label="Notes language"
    >
      <span className="px-1.5 text-[0.65rem] font-semibold uppercase tracking-wide text-[var(--muted)]">
        Notes
      </span>
      <button
        type="button"
        onClick={() => setLang("english")}
        className={base}
        style={{
          background: lang === "english" ? "var(--brand)" : "transparent",
          color: lang === "english" ? "#fff" : "var(--muted)",
        }}
        aria-pressed={lang === "english"}
      >
        English
      </button>
      <button
        type="button"
        onClick={() => setLang("hinglish")}
        className={base}
        style={{
          background: lang === "hinglish" ? "var(--brand)" : "transparent",
          color: lang === "hinglish" ? "#fff" : "var(--muted)",
        }}
        aria-pressed={lang === "hinglish"}
      >
        Hinglish
      </button>
    </div>
  );
}
