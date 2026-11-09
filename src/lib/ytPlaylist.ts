import { tokens } from "@/lib/videos";
import type {
  CoursePlaylist,
  CoursePlaylistRequest,
  CoursePlaylistTopicMap,
  CoursePlaylistVideo,
} from "@/lib/types";

/**
 * Finds an EXISTING full-course YouTube playlist that really teaches the
 * uploaded syllabus — the old ExamSmasher feature, restored as a pure
 * keyword matcher (no AI key involved, nothing invented).
 *
 * Flow (all server-side, key never reaches the browser):
 *   1. search.list  type=playlist   → candidate course playlists
 *   2. playlists.list               → real title/channel/thumbnail/length
 *   3. playlistItems.list           → the playlist's actual video titles
 *   4. keyword match                → which syllabus topics those titles
 *                                      honestly cover (≥66 % of a topic's
 *                                      words in a video TITLE)
 *
 * Only a playlist covering ≥55 % of the topics is ever returned; below that
 * we return null so the UI simply shows nothing rather than a fake promise.
 * Results are cached (6 h) because one lookup costs ~200 quota units.
 */

const YT_API = "https://www.googleapis.com/youtube/v3";
const TIMEOUT_MS = 9000;
/** Below this many videos it is not a credible "full course". */
const MIN_PLAYLIST_VIDEOS = 6;
/** How many videos we page through per playlist (quota + latency sane). */
const MAX_ITEMS_PER_PLAYLIST = 100;
/** How many candidate playlists we inspect before giving up. */
const PLAYLISTS_TO_INSPECT = 3;
/** Minimum syllabus coverage before a playlist is recommended at all. */
export const MIN_RECOMMEND_COVERAGE = 55;
/** Fraction of a topic's words that must appear in one video's title. */
const MIN_TITLE_MATCH = 0.66;
const SEARCHES_PER_LOOKUP = 2;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 50;

export class PlaylistQuotaError extends Error {
  constructor() {
    super("quota");
    this.name = "PlaylistQuotaError";
  }
}
export class PlaylistUpstreamError extends Error {
  constructor() {
    super("upstream");
    this.name = "PlaylistUpstreamError";
  }
}

interface PlaylistItem {
  id?: string | { playlistId?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
    thumbnails?: Record<string, { url?: string }>;
    position?: number;
  };
  contentDetails?: { itemCount?: number; videoId?: string };
}

/** sig → found playlist (null = "checked, nothing credible exists"). */
const cache = new Map<string, { at: number; value: CoursePlaylist | null }>();
const inflight = new Map<string, Promise<CoursePlaylist | null>>();

function cacheGet(sig: string): CoursePlaylist | null | undefined {
  const entry = cache.get(sig);
  if (!entry) return undefined;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(sig);
    return undefined;
  }
  return entry.value;
}

function cacheSet(sig: string, value: CoursePlaylist | null): void {
  cache.set(sig, { at: Date.now(), value });
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** One YouTube Data API v3 call: timeout + quota mapping. */
async function ytBody(
  path: "search" | "playlists" | "playlistItems",
  params: Record<string, string>,
  key: string,
): Promise<{ items: PlaylistItem[]; nextPageToken?: string }> {
  const url = new URL(`${YT_API}/${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  url.searchParams.set("key", key);

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch {
    throw new PlaylistUpstreamError();
  }
  const body = (await res.json().catch(() => null)) as {
    error?: { errors?: { reason?: string }[] };
    items?: PlaylistItem[];
    nextPageToken?: string;
  } | null;
  if (!res.ok) {
    const reason = body?.error?.errors?.[0]?.reason ?? "";
    if (reason === "quotaExceeded" || reason === "rateLimitExceeded") throw new PlaylistQuotaError();
    throw new PlaylistUpstreamError();
  }
  return {
    items: Array.isArray(body?.items) ? (body?.items as PlaylistItem[]) : [],
    nextPageToken: body?.nextPageToken,
  };
}

/** Same call, dropping the pagination token. */
async function yt(
  path: "search" | "playlists" | "playlistItems",
  params: Record<string, string>,
  key: string,
): Promise<PlaylistItem[]> {
  return (await ytBody(path, params, key)).items;
}

/**
 * Queries worth trying when hunting for a course on this subject. Two per
 * lookup: a search costs 100 quota units whatever its size, and two good
 * queries beat five shallow ones for finding a real "full course" listing.
 */
function buildQueries(subject: string, topics: CoursePlaylistRequest["topics"]): string[] {
  let base = subject.trim().replace(/\s+/g, " ").split(/[:\-–—(]/)[0].trim();
  const generic = /^(your course|course|subject|syllabus|untitled|my course)$/i;
  if (base.length < 4 || generic.test(base)) {
    // No usable course name — the first topic's own wording is the best
    // honest stand-in ("no fake course name" still holds: it IS the syllabus).
    const first = topics.find((t) => t.title.trim().length > 2);
    base = first
      ? tokens(first.title)
          .slice(0, 4)
          .join(" ")
      : "";
  }
  if (tokens(base).length === 0) return [];
  return [`${base} full course`, `${base} complete playlist`].slice(0, SEARCHES_PER_LOOKUP);
}

/** Runs one playlist search and returns playlist ids in relevance order. */
async function searchPlaylists(query: string, key: string): Promise<string[]> {
  const items = await yt("search", {
    part: "id",
    type: "playlist",
    maxResults: "6",
    q: query,
    order: "relevance",
    safeSearch: "moderate",
  }, key);
  return items
    .map((item) => (typeof item.id === "object" ? item.id?.playlistId : undefined))
    .filter((id): id is string => Boolean(id));
}

/** Real metadata (title/channel/thumbnail/length) for up to 50 playlists. */
async function fetchDetails(ids: string[], key: string): Promise<CoursePlaylist[]> {
  if (ids.length === 0) return [];
  const items = await yt("playlists", {
    part: "snippet,contentDetails",
    id: ids.slice(0, 50).join(","),
  }, key);
  return items.map((raw) => {
    const id = String(raw.id ?? "");
    const thumbs = raw.snippet?.thumbnails ?? {};
    return {
      id,
      title: raw.snippet?.title ?? "(untitled playlist)",
      channelTitle: raw.snippet?.channelTitle ?? "Unknown channel",
      thumbnail:
        thumbs.maxres?.url ?? thumbs.standard?.url ?? thumbs.high?.url ??
        thumbs.medium?.url ?? thumbs.default?.url ?? "",
      videoCount: Number(raw.contentDetails?.itemCount) || 0,
      url: `https://www.youtube.com/playlist?list=${id}`,
      videos: [],
      coverage: [],
      coveragePercent: 0,
    } satisfies CoursePlaylist;
  });
}

/** Pages through a playlist and returns its real videos, in order. */
async function fetchItems(playlistId: string, key: string): Promise<CoursePlaylistVideo[]> {
  const videos: CoursePlaylistVideo[] = [];
  let pageToken = "";
  // 4 pages × 50 = 200 items, well past the 100-item cap — a hard page bound
  // so a pathological response can never spin here.
  let pages = 0;
  while (videos.length < MAX_ITEMS_PER_PLAYLIST && pages < 4) {
    pages += 1;
    const params: Record<string, string> = {
      part: "contentDetails,snippet",
      playlistId,
      maxResults: "50",
    };
    if (pageToken) params.pageToken = pageToken;

    const body = await ytBody("playlistItems", params, key);
    if (body.items.length === 0) break;

    for (const item of body.items) {
      const videoId = item.contentDetails?.videoId;
      if (!videoId) continue;
      const title = item.snippet?.title ?? "";
      if (!title || /^(deleted video|private video)$/i.test(title.trim())) continue;
      videos.push({
        videoId,
        title,
        position: Number.isFinite(item.snippet?.position)
          ? Number(item.snippet?.position)
          : videos.length,
      });
      if (videos.length >= MAX_ITEMS_PER_PLAYLIST) break;
    }

    pageToken = body.nextPageToken ?? "";
    if (!pageToken) break;
  }
  return videos;
}

/**
 * The deterministic match: a topic is covered by a playlist video when at
 * least two-thirds of the topic's meaningful words appear in that video's
 * TITLE. Titles are what the playlist really lists, so nothing is claimed
 * that the playlist page does not literally show.
 */
function keywordMatch(
  topics: CoursePlaylistRequest["topics"],
  videos: CoursePlaylistVideo[],
): CoursePlaylistTopicMap[] {
  const coverage: CoursePlaylistTopicMap[] = [];
  for (const topic of topics) {
    const topicTokens = tokens(`${topic.title} ${topic.keywords.join(" ")}`);
    if (topicTokens.length === 0) continue;

    let best: { video: CoursePlaylistVideo; score: number } | null = null;
    for (const video of videos) {
      const titleTokens = new Set(tokens(video.title));
      if (titleTokens.size === 0) continue;
      let shared = 0;
      for (const token of topicTokens) if (titleTokens.has(token)) shared += 1;
      const score = shared / topicTokens.length;
      if (!best || score > best.score) best = { video, score };
    }
    if (best && best.score >= MIN_TITLE_MATCH) {
      coverage.push({
        topicId: topic.id,
        videoId: best.video.videoId,
        videoTitle: best.video.title,
      });
    }
  }
  return coverage;
}

/** The lookup itself — cached per subject+syllabus signature. */
async function findCoursePlaylist(
  input: CoursePlaylistRequest,
  key: string,
): Promise<CoursePlaylist | null> {
  const topics = input.topics.filter((t) => t.title.trim().length > 1);
  if (topics.length === 0) return null;

  const queries = buildQueries(input.subject, topics);
  if (queries.length === 0) return null;

  // 1. Search every query and dedupe the playlist ids.
  let searched = 0;
  let upstreamFailed = 0;
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const query of queries) {
    try {
      const found = await searchPlaylists(query, key);
      searched += 1;
      for (const id of found) if (id && !seen.has(id)) { seen.add(id); ids.push(id); }
    } catch (err) {
      if (err instanceof PlaylistQuotaError) throw err;
      upstreamFailed += 1;
    }
  }
  // Every search died → the API is unusable, say so instead of "no playlist".
  if (searched === 0 && upstreamFailed > 0) throw new PlaylistUpstreamError();
  if (ids.length === 0) return null;

  // 2. Real metadata, then the plausible "full course" ones.
  const details = await fetchDetails(ids, key);
  const plausible = details
    .filter((p) => p.id && p.videoCount >= MIN_PLAYLIST_VIDEOS)
    .sort((a, b) => {
      const sizeGap = (p: CoursePlaylist) =>
        Math.abs(p.videoCount - Math.max(topics.length, MIN_PLAYLIST_VIDEOS));
      return sizeGap(a) - sizeGap(b) || b.videoCount - a.videoCount;
    })
    .slice(0, PLAYLISTS_TO_INSPECT);
  if (plausible.length === 0) return null;

  // 3. Page through each candidate and measure the syllabus it covers.
  const inspected: Array<{ playlist: CoursePlaylist; videos: CoursePlaylistVideo[]; coverage: CoursePlaylistTopicMap[] }> = [];
  for (const playlist of plausible) {
    let videos: CoursePlaylistVideo[] = [];
    try {
      videos = await fetchItems(playlist.id, key);
    } catch (err) {
      if (err instanceof PlaylistQuotaError) throw err;
      continue; // one broken playlist must not sink the others
    }
    if (videos.length === 0) continue;
    const coverage = keywordMatch(topics, videos);
    inspected.push({
      playlist: { ...playlist, videoCount: Math.max(playlist.videoCount, videos.length) },
      videos,
      coverage,
    });
  }
  if (inspected.length === 0) return null;

  // 4. Most topics covered wins; ties go to the denser playlist (less waffle).
  inspected.sort((a, b) => {
    const diff = b.coverage.length - a.coverage.length;
    if (diff !== 0) return diff;
    const ratio = (x: (typeof inspected)[number]) => x.coverage.length / Math.max(1, x.videos.length);
    return ratio(b) - ratio(a);
  });

  const best = inspected[0];
  const percent = Math.round((best.coverage.length / topics.length) * 100);
  if (best.coverage.length === 0 || percent < MIN_RECOMMEND_COVERAGE) return null;

  return { ...best.playlist, videos: best.videos, coverage: best.coverage, coveragePercent: percent };
}

/** The cache key for a lookup: subject + the exact topic ids/titles. */
function playlistSig(input: CoursePlaylistRequest): string {
  return `${input.subject.trim().toLowerCase()}|${input.topics
    .map((t) => `${t.id}:${t.title}`)
    .join(",")}`;
}

/**
 * True when this exact lookup is already cached — serving it costs nothing,
 * so the route lets cached requests past the throttle (a reload-heavy tab
 * must never be locked out by its own repeat visits).
 */
export function isPlaylistCached(input: CoursePlaylistRequest): boolean {
  return cacheGet(playlistSig(input)) !== undefined;
}

/**
 * Public entry: subject + syllabus topics → the one playlist worth
 * recommending, or null when nothing genuinely covers the syllabus.
 * Throws PlaylistQuotaError / PlaylistUpstreamError so the route can map
 * the failure to an honest status code.
 */
export async function findRecommendablePlaylist(
  input: CoursePlaylistRequest,
  key: string,
): Promise<CoursePlaylist | null> {
  const sig = playlistSig(input);
  const cached = cacheGet(sig);
  if (cached !== undefined) return cached;

  const pending = inflight.get(sig);
  if (pending) return pending;

  const task = findCoursePlaylist(input, key)
    .then((value) => {
      cacheSet(sig, value);
      return value;
    })
    .finally(() => inflight.delete(sig));

  inflight.set(sig, task);
  return task;
}
