/**
 * Content-addressed cache for /api/extract results (Phase 6).
 *
 * Reading the same file twice — after a refresh, a "Start over", a retry, or
 * when one paper feeds BOTH the syllabus and the PYQ flow — must not run PDF
 * parsing or OCR again. Each file is keyed by the SHA-256 of its original
 * bytes, so the key is stable across sessions (localStorage) and identical no
 * matter which upload flow reads it.
 *
 * Rules the cache keeps honest:
 *   - Only SUCCESSFUL extractions are stored: a retry after a failure always
 *     reaches the server, because a transient error deserves a second chance.
 *   - In-flight requests for the same content are deduplicated, so the same
 *     file added twice at once produces ONE request.
 *   - The store is size-capped (LRU by write time) so a heavy semester of
 *     uploads cannot blow the localStorage quota; a quota/availability error
 *     degrades to in-memory caching instead of throwing.
 *   - Nothing is ever invented: a cache miss falls through to the caller's
 *     real fetch, exactly as before.
 */

const STORAGE_KEY = "es-extract-v1";
const MAX_ENTRIES = 40;
/** Per-entry cap — extraction output is normally a few KB; this is a guard. */
const MAX_TEXT_CHARS = 200_000;

interface CacheEntry {
  /** The exact text the consumer would have stored from the response. */
  t: string;
  /** Write time — used for LRU eviction. */
  at: number;
}

type Store = Record<string, CacheEntry>;

/** Lazy read-through copy of localStorage; survives quota failures. */
let memory: Store | null = null;
/** Hash → in-flight extraction, so one file never reads twice at once. */
const inflight = new Map<string, Promise<string>>();

function loadStore(): Store {
  if (memory) return memory;
  memory = {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return memory;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [hash, entry] of Object.entries(parsed as Store)) {
        if (entry && typeof entry.t === "string") memory[hash] = entry;
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

/** Evict oldest writes until the store fits both entry and size budgets. */
function trim(store: Store): Store {
  const hashes = Object.keys(store);
  if (hashes.length > MAX_ENTRIES) {
    hashes
      .sort((a, b) => store[a].at - store[b].at)
      .slice(0, hashes.length - MAX_ENTRIES)
      .forEach((hash) => delete store[hash]);
  }
  for (const [hash, entry] of Object.entries(store)) {
    if (entry.t.length > MAX_TEXT_CHARS) delete store[hash];
  }
  return store;
}

/**
 * SHA-256 of the file's original bytes. Falls back to a weaker but still
 * stable name/size/mtime key where WebCrypto is unavailable (insecure origin),
 * so caching degrades rather than disappears.
 */
export async function hashFile(file: File): Promise<string> {
  try {
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return `f:${file.name}:${file.size}:${file.lastModified}`;
  }
}

/** The cached text for a content hash, or null on a miss. */
export function readCachedText(hash: string): string | null {
  const entry = loadStore()[hash];
  return entry ? entry.t : null;
}

/** Store a successful extraction under its content hash. */
export function rememberText(hash: string, text: string): void {
  if (!text || text.length > MAX_TEXT_CHARS) return;
  const store = loadStore();
  store[hash] = { t: text, at: Date.now() };
  persist(trim(store));
}

/**
 * Return the cached text for `file`, or run `read` once and remember its
 * result. Concurrent calls for the same content share a single request.
 */
export async function extractText(
  file: File,
  read: () => Promise<string>,
): Promise<string> {
  const hash = await hashFile(file);
  const hit = readCachedText(hash);
  if (hit !== null) return hit;

  const pending = inflight.get(hash);
  if (pending) return pending;

  const task = (async () => {
    const text = await read();
    rememberText(hash, text);
    return text;
  })().finally(() => inflight.delete(hash));

  inflight.set(hash, task);
  return task;
}
