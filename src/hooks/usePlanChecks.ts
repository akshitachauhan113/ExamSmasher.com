"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "es-plan-checks-v1";
const EMPTY: Record<string, boolean> = Object.freeze({});

/**
 * Tracks which planner items the student has ticked off.
 *
 * Keys are `<planId>|<day>|<itemIndex>` so progress survives reloads, while a
 * different plan (different subject/days) naturally gets a fresh key space.
 */
const listeners = new Set<() => void>();
let snapshot: Record<string, boolean> | null = null;

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
    /* storage blocked — checks just won't persist */
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

function getSnapshot(): Record<string, boolean> {
  if (snapshot === null) snapshot = readStore();
  return snapshot;
}

function getServerSnapshot(): Record<string, boolean> {
  return EMPTY;
}

export function planItemId(planId: string, day: number, itemIndex: number): string {
  return `${planId}|${day}|${itemIndex}`;
}

export function usePlanChecks() {
  const checks = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const isChecked = useCallback(
    (planId: string, day: number, itemIndex: number) =>
      Boolean(checks[planItemId(planId, day, itemIndex)]),
    [checks],
  );

  const toggle = useCallback((planId: string, day: number, itemIndex: number) => {
    const key = planItemId(planId, day, itemIndex);
    const current = getSnapshot();
    const next = { ...current };
    if (next[key]) delete next[key];
    else next[key] = true;
    commit(next);
  }, []);

  const clearPlan = useCallback((planId: string) => {
    const next = { ...getSnapshot() };
    for (const key of Object.keys(next)) {
      if (key.startsWith(`${planId}|`)) delete next[key];
    }
    commit(next);
  }, []);

  return { checks, isChecked, toggle, clearPlan };
}
