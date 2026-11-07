"use client";

import { useCallback, useSyncExternalStore } from "react";
import { topicKey } from "@/hooks/useStudiedTopics";

/**
 * Phase 5 · topic-coverage tracker.
 *
 * Two independent marks, both student-made — neither is inferred from a
 * generated search link:
 *   - covered: the student says a syllabus TOPIC is done;
 *   - watched: the student says a recommended SEARCH was watched usefully.
 *
 * Same module-store + localStorage pattern as useStudiedTopics, so both
 * survive reloads and stay in sync across tabs.
 */

const STORAGE_KEY = "es-playlist-progress-v1";

export interface PlaylistProgress {
  covered: Record<string, boolean>;
  watched: Record<string, boolean>;
}

const EMPTY: PlaylistProgress = Object.freeze({ covered: {}, watched: {} });

const listeners = new Set<() => void>();
let snapshot: PlaylistProgress | null = null;

function readStore(): PlaylistProgress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { covered: {}, watched: {} };
    const parsed = JSON.parse(raw) as Partial<PlaylistProgress>;
    const clean = (map: unknown): Record<string, boolean> => {
      const out: Record<string, boolean> = {};
      if (map && typeof map === "object") {
        for (const [key, value] of Object.entries(map as Record<string, unknown>)) {
          if (value === true) out[key] = true;
        }
      }
      return out;
    };
    return { covered: clean(parsed.covered), watched: clean(parsed.watched) };
  } catch {
    return { covered: {}, watched: {} };
  }
}

function commit(next: PlaylistProgress): void {
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

function getSnapshot(): PlaylistProgress {
  if (snapshot === null) snapshot = readStore();
  return snapshot;
}

function getServerSnapshot(): PlaylistProgress {
  return EMPTY;
}

export function usePlaylistProgress() {
  const progress = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const isCovered = useCallback(
    (title: string) => Boolean(progress.covered[topicKey(title)]),
    [progress],
  );

  const toggleCovered = useCallback((title: string) => {
    const key = topicKey(title);
    const current = getSnapshot();
    const next: PlaylistProgress = { covered: { ...current.covered }, watched: { ...current.watched } };
    if (next.covered[key]) delete next.covered[key];
    else next.covered[key] = true;
    commit(next);
  }, []);

  const isWatched = useCallback(
    (recId: string) => Boolean(progress.watched[recId]),
    [progress],
  );

  const toggleWatched = useCallback((recId: string) => {
    const current = getSnapshot();
    const next: PlaylistProgress = { covered: { ...current.covered }, watched: { ...current.watched } };
    if (next.watched[recId]) delete next.watched[recId];
    else next.watched[recId] = true;
    commit(next);
  }, []);

  const clearAll = useCallback(() => {
    commit({ covered: {}, watched: {} });
  }, []);

  return { isCovered, toggleCovered, isWatched, toggleWatched, clearAll };
}
