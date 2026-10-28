"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "es-studied-topics-v1";
const EMPTY: Record<string, boolean> = Object.freeze({});

/**
 * Tracks which syllabus topics the student has already covered.
 *
 * The map lives in a tiny module store and is mirrored into localStorage.
 * useSyncExternalStore keeps React in sync without an effect, and progress
 * therefore survives reloads, re-analysis and even browser restarts.
 */
const listeners = new Set<() => void>();
let snapshot: Record<string, boolean> | null = null;

/** Stable key for a topic so progress survives re-analysis and reloads. */
export function topicKey(title: string): string {
  return (title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function readStore(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value === true) out[key] = true;
    }
    return out;
  } catch {
    return {};
  }
}

function commit(next: Record<string, boolean>): void {
  snapshot = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked — progress just won't persist */
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  // Keep progress in sync if the same syllabus is open in another tab.
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) {
      snapshot = readStore();
      listeners.forEach((l) => l());
    }
  };
  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): Record<string, boolean> {
  if (snapshot === null) snapshot = readStore();
  return snapshot;
}

function getServerSnapshot(): Record<string, boolean> {
  return EMPTY;
}

export function useStudiedTopics() {
  const studied = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const isStudied = useCallback(
    (title: string) => Boolean(studied[topicKey(title)]),
    [studied],
  );

  const toggle = useCallback((title: string) => {
    const key = topicKey(title);
    const current = getSnapshot();
    const next = { ...current };
    if (next[key]) delete next[key];
    else next[key] = true;
    commit(next);
  }, []);

  const markMany = useCallback((titles: string[], value: boolean) => {
    const next = { ...getSnapshot() };
    for (const title of titles) {
      const key = topicKey(title);
      if (value) next[key] = true;
      else delete next[key];
    }
    commit(next);
  }, []);

  const clearAll = useCallback(() => {
    commit({});
  }, []);

  return { studied, isStudied, toggle, markMany, clearAll };
}
