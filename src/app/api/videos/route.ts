import {
  coverageEstimate,
  parseIsoDuration,
  scoreCandidate,
  tokens,
  type SyllabusTopicInput,
} from "@/lib/videos";
import type {
  VideoMatch,
  VideoSuggestionsRequest,
  VideoSuggestionsResponse,
} from "@/lib/types";

/**
 * POST /api/videos — real YouTube video suggestions for the playlist cards.
 *
 * The YouTube Data API key lives ONLY here (server env); the browser never
 * sees it. Each query costs 100 quota units, so results are cached twice:
 *   - module-level cache keyed by the exact query (6 h), which survives
 *     across requests on a warm instance and makes repeat syllabi free;
 *   - the client keeps its own localStorage copy per plan signature.
 *
 * Failure is always honest: a quota/key/upstream problem returns ok=false
 * with a reason, and the UI falls back to plain YouTube search links —
 * it never invents a title, a view count or a thumbnail.
 */

const MAX_QUERIES = 10;
const MAX_TOPICS = 250;
const TOP_N = 3;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 400;
const THROTTLE_WINDOW_MS = 10 * 60 * 1000;
const THROTTLE_MAX = 60;
const YT_TIMEOUT_MS = 9000;

/** Raw candidate straight from the API — cached before any scoring. */
interface RawVideo {
  id: string;
  title: string;
  channel: string;
  published: string;
  description: string;
  durationSec: number;
  views: number;
  thumb: string;
}

class QuotaError extends Error {
  constructor(readonly reason: "quota" | "no-key") {
    super(reason);
  }
}
class UpstreamError extends Error {}

/** The slice of a search.list item this route reads. */
interface SearchItem {
  id?: { videoId?: string };
}
/** The slice of a videos.list item this route reads. */
interface VideoItem {
  id?: string;
  snippet?: {
    title?: string;
    channelTitle?: string;
    publishedAt?: string;
    description?: string;
    thumbnails?: Record<string, { url?: string }>;
  };
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string };
}

/** query → enriched candidates (search + details already paid for). */
const cache = new Map<string, { at: number; videos: RawVideo[] }>();
/** query → in-flight fetch, so one query never searches twice at once. */
const inflight = new Map<string, Promise<RawVideo[]>>();
/** ip → request timestamps inside the throttle window. */
const hits = new Map<string, number[]>();

function cacheGet(query: string): RawVideo[] | null {
  const entry = cache.get(query);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(query);
    return null;
  }
  return entry.videos;
}

function cacheSet(query: string, videos: RawVideo[]): void {
  cache.set(query, { at: Date.now(), videos });
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function throttled(ip: string): boolean {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < THROTTLE_WINDOW_MS);
  if (list.length >= THROTTLE_MAX) {
    hits.set(ip, list);
    return true;
  }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 500) hits.clear();
  return false;
}

/** One call to the YouTube Data API v3 with timeout + error mapping. */
async function yt(
  path: "search" | "videos",
  params: Record<string, string>,
  key: string,
): Promise<{ items?: unknown[] } | null> {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  url.searchParams.set("key", key);

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(YT_TIMEOUT_MS), cache: "no-store" });
  } catch {
    throw new UpstreamError("timeout");
  }
  const body = (await res.json().catch(() => null)) as {
    error?: { errors?: { reason?: string }[] };
  } | null;
  if (!res.ok) {
    const reason = body?.error?.errors?.[0]?.reason ?? "";
    if (reason === "quotaExceeded" || reason === "rateLimitExceeded") {
      throw new QuotaError("quota");
    }
    if (res.status === 400 || res.status === 403) {
      if (/key/i.test(reason) || res.status === 400) throw new QuotaError("no-key");
    }
    throw new UpstreamError(`http-${res.status}`);
  }
  return body as { items?: unknown[] };
}

/** Search + enrich ONE query (cached, deduplicated in flight). */
function searchVideos(query: string, key: string): Promise<RawVideo[]> {
  const hit = cacheGet(query);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(query);
  if (pending) return pending;

  const task = (async (): Promise<RawVideo[]> => {
    const search = await yt("search", {
      part: "snippet",
      type: "video",
      maxResults: "6",
      q: query,
      safeSearch: "moderate",
      videoEmbeddable: "true",
    }, key);

    const items = Array.isArray(search?.items) ? (search.items as SearchItem[]) : [];
    const ids = items
      .map((item) => item?.id?.videoId as string | undefined)
      .filter((id): id is string => Boolean(id));
    if (ids.length === 0) {
      cacheSet(query, []);
      return [];
    }

    const details = new Map<string, VideoItem>();
    for (let i = 0; i < ids.length; i += 50) {
      const list = await yt("videos", {
        part: "snippet,contentDetails,statistics",
        id: ids.slice(i, i + 50).join(","),
      }, key);
      for (const item of (list?.items as VideoItem[] | undefined) ?? []) {
        if (item?.id) details.set(String(item.id), item);
      }
    }

    const videos: RawVideo[] = [];
    for (const item of items) {
      const id = item?.id?.videoId as string | undefined;
      const full = id ? details.get(id) : undefined;
      if (!id || !full) continue;
      const durationSec = parseIsoDuration(String(full.contentDetails?.duration ?? ""));
      if (durationSec < 60) continue; // shorts / live are not lectures
      const sn = full.snippet ?? {};
      const stats = full.statistics ?? {};
      const thumbs = sn.thumbnails ?? {};
      videos.push({
        id,
        title: String(sn.title ?? ""),
        channel: String(sn.channelTitle ?? ""),
        published: String(sn.publishedAt ?? "").slice(0, 10),
        description: String(sn.description ?? "").slice(0, 4000),
        durationSec,
        views: Number(stats.viewCount ?? 0) || 0,
        thumb: String(thumbs.medium?.url ?? thumbs.default?.url ?? ""),
      });
    }
    cacheSet(query, videos);
    return videos;
  })().finally(() => inflight.delete(query));

  inflight.set(query, task);
  return task;
}

/** Rank one query's candidates and estimate syllabus coverage for each.
 *  The FULL sorted list comes back — de-duplication across cards happens
 *  once every query has landed, in the plan's own order. */
function rank(
  raw: RawVideo[],
  query: string,
  topics: SyllabusTopicInput[],
): VideoMatch[] {
  const queryTokens = tokens(query);
  const total = raw.length;
  return raw
    .map((video, index) => {
      const coverage = coverageEstimate(`${video.title} ${video.description}`, topics);
      return {
        id: video.id,
        title: video.title,
        channel: video.channel,
        durationSec: video.durationSec,
        views: video.views,
        thumb: video.thumb,
        url: `https://www.youtube.com/watch?v=${video.id}`,
        published: video.published,
        score: scoreCandidate({
          rank: index,
          total,
          views: video.views,
          durationSec: video.durationSec,
          titleTokens: tokens(video.title),
          queryTokens,
          coveragePct: coverage.pct,
        }),
        coveragePct: coverage.pct,
        matchedTopics: coverage.matched,
      } satisfies VideoMatch;
    })
    .sort((a, b) => b.score - a.score);
}

function parsePayload(body: unknown): VideoSuggestionsRequest | { error: true } {
  if (!body || typeof body !== "object") return { error: true };
  const { queries, topics } = body as Partial<VideoSuggestionsRequest>;
  if (!Array.isArray(queries) || queries.length === 0 || queries.length > MAX_QUERIES) {
    return { error: true };
  }
  if (!Array.isArray(topics) || topics.length > MAX_TOPICS) return { error: true };

  const cleanQueries: VideoSuggestionsRequest["queries"] = [];
  for (const entry of queries) {
    if (!entry || typeof entry.key !== "string" || typeof entry.query !== "string") {
      return { error: true };
    }
    const key = entry.key.slice(0, 80);
    const query = entry.query.trim().slice(0, 300);
    if (!key || !query) return { error: true };
    cleanQueries.push({ key, query });
  }

  const cleanTopics: VideoSuggestionsRequest["topics"] = [];
  for (const topic of topics) {
    if (!topic || typeof topic.title !== "string") return { error: true };
    cleanTopics.push({
      title: topic.title.slice(0, 200),
      keywords: Array.isArray(topic.keywords)
        ? topic.keywords.filter((k): k is string => typeof k === "string").slice(0, 30).map((k) => k.slice(0, 80))
        : [],
      subtopics: Array.isArray(topic.subtopics)
        ? topic.subtopics
            .filter((s): s is string => typeof s === "string")
            .slice(0, 40)
            .map((s) => s.slice(0, 100))
        : [],
    });
  }
  return { queries: cleanQueries, topics: cleanTopics };
}

export async function POST(request: Request): Promise<Response> {
  const json = (body: VideoSuggestionsResponse, status = 200): Response =>
    Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (throttled(ip)) return json({ ok: false, reason: "throttled" }, 429);

  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (!key) return json({ ok: false, reason: "no-key" }, 503);

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return json({ ok: false, reason: "bad-request" }, 400);
  }
  const payload = parsePayload(rawBody);
  if ("error" in payload) return json({ ok: false, reason: "bad-request" }, 400);

  const { queries, topics } = payload;
  const results: Record<string, VideoMatch[]> = {};
  let quotaReason: "quota" | "no-key" | null = null;

  const queue = [...queries];
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length > 0 && !quotaReason) {
      const entry = queue.shift();
      if (!entry) break;
      try {
        const raw = await searchVideos(entry.query, key);
        results[entry.key] = rank(raw, entry.query, topics);
      } catch (err) {
        if (err instanceof QuotaError) {
          quotaReason = err.reason;
          break;
        }
        // one bad query must not sink the rest — its key stays absent and
        // that card falls back to its search link.
      }
    }
  });
  await Promise.all(workers);

  // Never recommend the SAME video on two cards: walk the cards in PLAN
  // order (syllabus order, or priority order in the smart playlist) and drop
  // a video an earlier card already kept. A later card backfills from its own
  // runner-ups, so it can silently shrink to zero only when everything it
  // found was genuinely already shown above.
  const used = new Set<string>();
  for (const { key } of queries) {
    const list = results[key];
    if (!list) continue;
    const unique = list.filter((video) => !used.has(video.id));
    unique.forEach((video) => used.add(video.id));
    results[key] = unique.slice(0, TOP_N);
  }

  if (quotaReason === "no-key") return json({ ok: false, reason: "no-key" }, 503);
  if (quotaReason === "quota") return json({ ok: false, reason: "quota" }, 429);
  if (Object.keys(results).length === 0) {
    return json({ ok: false, reason: "upstream" }, 502);
  }
  return json({ ok: true, results });
}
