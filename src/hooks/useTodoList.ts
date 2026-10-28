"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "es-todos-v1";
const EMPTY: Todo[] = [];

export interface Todo {
  id: string;
  text: string;
  done: boolean;
}

/**
 * A tiny persistent to-do list.
 *
 * Same module-store + localStorage pattern as useStudiedTopics, so tasks
 * survive reloads and stay in sync across tabs.
 */
const listeners = new Set<() => void>();
let snapshot: Todo[] | null = null;

function readStore(): Todo[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((t): t is Todo => {
        const item = t as Partial<Todo>;
        return typeof item?.id === "string" && typeof item?.text === "string" && item.text.trim().length > 0;
      })
      .slice(0, 200)
      .map((t) => ({ id: t.id, text: t.text.slice(0, 200), done: t.done === true }));
  } catch {
    return [];
  }
}

function commit(next: Todo[]): void {
  snapshot = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked — tasks just won't persist */
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

function getSnapshot(): Todo[] {
  if (snapshot === null) snapshot = readStore();
  return snapshot;
}

function getServerSnapshot(): Todo[] {
  return EMPTY;
}

let idCounter = 0;
function makeId(): string {
  idCounter += 1;
  return `todo-${Date.now().toString(36)}-${idCounter}`;
}

export function useTodoList() {
  const todos = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const add = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    commit([{ id: makeId(), text: trimmed.slice(0, 200), done: false }, ...getSnapshot()]);
  }, []);

  const toggle = useCallback((id: string) => {
    commit(getSnapshot().map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  }, []);

  const remove = useCallback((id: string) => {
    commit(getSnapshot().filter((t) => t.id !== id));
  }, []);

  const clearDone = useCallback(() => {
    commit(getSnapshot().filter((t) => !t.done));
  }, []);

  return { todos, add, toggle, remove, clearDone };
}
