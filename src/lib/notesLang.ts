"use client";

import { useSyncExternalStore } from "react";
import type { NotesLang } from "./types";

/**
 * The student's notes language, shared by every notes panel on the page.
 *
 * One toggle in one panel flips them all — the choice lives in localStorage
 * so it survives a reload, and reads as "english" on the server so the first
 * paint matches on both sides (it syncs to the saved value right after
 * hydration, same pattern as ThemeToggle).
 */
const KEY = "es-notes-lang";
const listeners = new Set<() => void>();

/** In-memory copy, so the toggle still flips when storage is blocked. */
let memory: NotesLang | null = null;

function read(): NotesLang {
  if (memory) return memory;
  try {
    return localStorage.getItem(KEY) === "hinglish" ? "hinglish" : "english";
  } catch {
    return "english";
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): NotesLang {
  return read();
}

function getServerSnapshot(): NotesLang {
  return "english";
}

export function setNotesLang(lang: NotesLang): void {
  memory = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* storage blocked — the in-memory copy keeps the choice alive */
  }
  listeners.forEach((listener) => listener());
}

export function useNotesLang(): [NotesLang, (lang: NotesLang) => void] {
  const lang = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return [lang, setNotesLang];
}
