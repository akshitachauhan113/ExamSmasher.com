/**
 * localStorage cache for /api/videos results (playlist suggestions).
 *
 * One YouTube search costs 100 quota units, so the SAME syllabus must not
 * re-search on every reload, tab switch or revisit. Entries are keyed by a
 * signature that covers the queries AND the syllabus topics (coverage % is
 * measured against those topics), so a changed syllabus re-fetches.
 *
 * Only successful responses are stored — a failure falls through to a fresh
 * request, exactly like a cache miss, so a transient error gets a retry.
 * The store is LRU-capped so a heavy semester cannot blow the quota.
 */

import type { VideoMatch } from "@/lib/types";

const STORAGE_KEY = "es-videos-v1";
const MAX_ENTRIES = 12;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface Entry {
  at: number;
  results: Record<string, VideoMatch[]>;
}
type Store = Record<string, Entry>;

/** Lazy read-through copy of localStorage; survives quota failures. */
let memory: Store | null = null;

function loadStore(): Store {
  if (memory) return memory;
  memory = {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return memory;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [sig, entry] of Object.entries(parsed as Store)) {
        if (entry && typeof entry.at === "number" && entry.results && typeof entry.results === "object") {
          memory[sig] = entry;
        }
      }
    }
  } catch {
    // Corrupted or unavailable storage — start from an empty in-memory store.
  }
  return memory;
}

function persist(store: Store): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Quota or private mode: the in-memory copy still serves this session.
  }
}

/** Evict stale + oldest writes until the store fits the entry budget. */
function trim(store: Store): Store {
  const now = Date.now();
  for (const [sig, entry] of Object.entries(store)) {
    if (now - entry.at > TTL_MS) delete store[sig];
  }
  const sigs = Object.keys(store);
  if (sigs.length > MAX_ENTRIES) {
    sigs
      .sort((a, b) => store[a].at - store[b].at)
      .slice(0, sigs.length - MAX_ENTRIES)
      .forEach((sig) => delete store[sig]);
  }
  return store;
}

/** The cached results for a plan signature, or null on a miss/stale entry. */
export function readVideoCache(sig: string): Record<string, VideoMatch[]> | null {
  const entry = loadStore()[sig];
  if (!entry || Date.now() - entry.at > TTL_MS) return null;
  return entry.results;
}

/** Store a successful /api/videos response under its plan signature. */
export function writeVideoCache(sig: string, results: Record<string, VideoMatch[]>): void {
  if (!results || Object.keys(results).length === 0) return;
  const store = loadStore();
  store[sig] = { at: Date.now(), results };
  persist(trim(store));
}
