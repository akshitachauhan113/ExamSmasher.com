import type { VideoMatch, VideoSuggestionsResponse } from "@/lib/types";

/**
 * Lazy, batched real-video discovery for the PER-TOPIC panels.
 *
 * Every expanded syllabus unit mounts several TopicPanels at once — firing
 * one YouTube search per panel would waste HTTP round trips and make the
 * same popular lecture show up on neighbouring topics. This module collects
 * the pending per-topic queries for ~300 ms and sends them to /api/videos in
 * batches of 10 (the route's cap), passing the video ids ALREADY shown to
 * other topics as `exclude` so the server can drop duplicates across
 * requests (it cannot see them otherwise) and backfill from its own ranked
 * runner-ups.
 *
 * Costs are controlled the same way the playlist board does it:
 *   - one YouTube search per topic (100 quota units) and nothing more;
 *   - a 7-day localStorage copy per analysis signature — expanding a unit
 *     twice, switching tabs or reloading never searches again;
 *   - failures are NEVER cached, so a transient error gets a fresh retry.
 *
 * Every field rendered from the result (title / channel / duration / views /
 * thumbnail / url) comes straight from the YouTube Data API — nothing here
 * invents metadata, and an empty answer honestly means "no video found".
 */

/** Route cap per request; matching MAX_QUERIES in /api/videos. */
const BATCH = 10;
/** 1 recommended video + 3 alternatives per topic. */
const LIMIT = 4;
const FLUSH_DELAY_MS = 300;

const STORAGE_KEY = "es-topic-videos-v1";
const MAX_ENTRIES = 8;
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

/* ------------------------------- localStorage ------------------------------- */

interface Entry {
  at: number;
  byTopic: Record<string, VideoMatch[]>;
}
type Store = Record<string, Entry>;

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
        if (entry && typeof entry.at === "number" && entry.byTopic && typeof entry.byTopic === "object") {
          memory[sig] = entry;
        }
      }
    }
  } catch {
    // Corrupted or unavailable storage — start empty; this session still works.
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

function trim(store: Store): void {
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
}

/** Signature of the analysis a per-topic video entry belongs to. */
export function topicVideosSignature(
  subject: string,
  language: string,
  topics: { id: string; title: string }[],
): string {
  return [
    subject,
    language,
    topics.map((topic) => `${topic.id}:${topic.title}`).join("|"),
  ].join("###");
}

/** The cached videos for one topic, or null on a miss / stale entry. */
export function readTopicVideos(sig: string, topicId: string): VideoMatch[] | null {
  const entry = loadStore()[sig];
  if (!entry || Date.now() - entry.at > TTL_MS) return null;
  const videos = entry.byTopic[topicId];
  return Array.isArray(videos) && videos.length > 0 ? videos : null;
}

/** Merge one topic's freshly discovered videos into its analysis entry. */
function writeTopicVideos(sig: string, topicId: string, videos: VideoMatch[]): void {
  if (videos.length === 0) return;
  const store = loadStore();
  const entry = store[sig] ?? { at: Date.now(), byTopic: {} };
  entry.at = Date.now();
  entry.byTopic[topicId] = videos;
  store[sig] = entry;
  trim(store);
  persist(store);
}

/* --------------------------- cross-topic registry --------------------------- */

/**
 * videoId → the topic id that already shows it.
 *
 * The server de-duplicates INSIDE one request; this module-level registry
 * covers batches that land in different requests (a unit expanded later), so
 * the same lecture never appears on two topic cards. Ids a cache hit just
 * restored are registered too — they are already on screen somewhere.
 */
const usedIds = new Map<string, string>();

/** Register videos a topic is showing (idempotent). */
export function claimTopicVideos(topicId: string, videos: VideoMatch[]): void {
  for (const video of videos) usedIds.set(video.id, topicId);
}

/** Drop the registry when a NEW analysis replaces the old one. */
function maybeResetRegistry(sig: string): void {
  if (activeSig === sig) return;
  activeSig = sig;
  usedIds.clear();
}

let activeSig: string | null = null;

/* --------------------------------- queueing --------------------------------- */

interface Queued {
  sig: string;
  key: string;
  query: string;
  /** Full syllabus cards — coverage % is measured against these. */
  topics: { title: string; keywords: string[]; subtopics?: string[] }[];
  resolve: (result: { videos?: VideoMatch[]; reason?: string }) => void;
}

const pending: Queued[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

/**
 * Ask for ONE topic's real videos. Resolves with the ranked list (first
 * entry = the recommended video) or an honest failure reason — never with
 * invented data. Safe to call from every mounted topic panel: answers are
 * batched, cached and de-duplicated across cards.
 */
export function enqueueTopicVideos(item: Queued): void {
  maybeResetRegistry(item.sig);
  pending.push(item);
  if (timer === null && !flushing) {
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, FLUSH_DELAY_MS);
  }
}

async function flush(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    // Loop so queries queued WHILE a batch is in flight still get sent.
    while (pending.length > 0) {
      const chunk = pending.splice(0, BATCH);
      await sendChunk(chunk);
    }
  } finally {
    flushing = false;
  }
}

async function sendChunk(chunk: Queued[]): Promise<void> {
  if (chunk.length === 0) return;
  const { sig, topics } = chunk[0];

  // Ids already shown by topics NOT in this chunk — the server filters them
  // out before ranking and backfills from its runner-ups.
  const inChunk = new Set(chunk.map((entry) => entry.key));
  const exclude = [...usedIds.entries()]
    .filter(([, owner]) => !inChunk.has(owner))
    .map(([id]) => id);

  const body = JSON.stringify({
    queries: chunk.map((entry) => ({ key: entry.key, query: entry.query })),
    topics,
    limit: LIMIT,
    exclude,
  });

  let data: VideoSuggestionsResponse | null = null;
  try {
    const res = await fetch("/api/videos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
    });
    data = (await res.json()) as VideoSuggestionsResponse;
  } catch {
    data = null;
  }

  if (data?.ok && data.results) {
    const results = data.results;
    for (const entry of chunk) {
      const videos = results[entry.key] ?? [];
      claimTopicVideos(entry.key, videos);
      writeTopicVideos(sig, entry.key, videos);
      entry.resolve({ videos });
    }
    return;
  }

  const reason = data?.reason ?? "network";
  for (const entry of chunk) entry.resolve({ reason });
}
