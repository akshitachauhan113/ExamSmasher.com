import { generateJSON, getLlmConfig } from "./llm";
import { buildPlaylistMapPrompt } from "./prompts";
import { tokenize } from "./scoring";
import type {
  CoursePlaylist,
  PlaylistCandidate,
  PlaylistCoverage,
  PlaylistVideo,
  Topic,
} from "./types";
import { YouTubeError } from "./youtube";

/**
 * Finds an EXISTING complete YouTube course playlist that already teaches the
 * student's syllabus, and maps each syllabus topic onto the playlist video that
 * covers it. This is what lets us promise real syllabus coverage instead of a
 * pile of unrelated single videos.
 */

const YT_API = "https://www.googleapis.com/youtube/v3";

const TIMEOUT_MS = 20_000;

/** Below this, a playlist is not a credible "full course" — skip it. */
const MIN_PLAYLIST_VIDEOS = 6;
/** Cap how many videos we page through per playlist (keeps quota + latency sane). */
const MAX_ITEMS_PER_PLAYLIST = 100;
/** How many candidate playlists we inspect before giving up. */
const PLAYLISTS_TO_INSPECT = 4;
/** Minimum syllabus coverage before we recommend a playlist at all. */
export const MIN_RECOMMEND_COVERAGE = 55;

function apiKey(): string {
  const key = process.env.YOUTUBE_API_KEY?.trim();
  if (!key) {
    throw new YouTubeError(
      "YouTube API key missing. Add YOUTUBE_API_KEY to your .env.local file.",
      401,
    );
  }
  return key;
}

function abortAfter(ms: number): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

async function ytGet(path: string, params: URLSearchParams): Promise<unknown> {
  const key = apiKey();
  const url = `${YT_API}/${path}?${params.toString()}&key=${key}`;
  const { signal, done } = abortAfter(TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  } catch (err) {
    throw new YouTubeError(
      err instanceof Error && err.name === "AbortError"
        ? "YouTube playlist request timed out."
        : "Could not reach YouTube for playlists.",
      504,
    );
  } finally {
    done();
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data as { error?: { message?: string } })?.error?.message;
    throw new YouTubeError(message ?? `YouTube API error (${res.status})`, res.status);
  }
  return data;
}

/* -------------------------------------------------------------------------- */
/*                                raw YouTube calls                            */
/* -------------------------------------------------------------------------- */

/** Runs one playlist search and returns playlist ids in relevance order. */
export async function searchPlaylists(
  query: string,
  languageCode: string,
  maxResults = 10,
): Promise<string[]> {
  const params = new URLSearchParams({
    part: "id",
    type: "playlist",
    maxResults: String(Math.min(50, maxResults)),
    q: query,
    relevanceLanguage: languageCode,
    order: "relevance",
  });

  const data = await ytGet("search", params);
  const items = (data as { items?: Array<{ id?: { playlistId?: string } }> })?.items ?? [];
  return items.map((i) => i.id?.playlistId).filter((id): id is string => Boolean(id));
}

/** Pulls title/channel/thumbnail/length for up to 50 playlists in one call. */
export async function fetchPlaylistDetails(ids: string[]): Promise<PlaylistCandidate[]> {
  if (ids.length === 0) return [];

  const params = new URLSearchParams({
    part: "snippet,contentDetails",
    id: ids.slice(0, 50).join(","),
    maxResults: "50",
  });

  const data = await ytGet("playlists", params);
  const items = (data as { items?: Array<Record<string, unknown>> })?.items ?? [];

  return items.map((raw) => {
    const snippet = (raw.snippet ?? {}) as {
      title?: string;
      channelTitle?: string;
      thumbnails?: Record<string, { url?: string }>;
    };
    const contentDetails = (raw.contentDetails ?? {}) as { itemCount?: number };
    const thumbs = snippet.thumbnails ?? {};
    const id = String(raw.id ?? "");

    return {
      id,
      title: snippet.title ?? "(untitled playlist)",
      channelTitle: snippet.channelTitle ?? "Unknown channel",
      thumbnail:
        thumbs.maxres?.url ??
        thumbs.standard?.url ??
        thumbs.high?.url ??
        thumbs.medium?.url ??
        thumbs.default?.url ??
        "",
      videoCount: Number(contentDetails.itemCount) || 0,
      url: `https://www.youtube.com/playlist?list=${id}`,
    } satisfies PlaylistCandidate;
  });
}

/** Pages through a playlist and returns its videos in order (title + id). */
export async function fetchPlaylistItems(
  playlistId: string,
  maxItems = MAX_ITEMS_PER_PLAYLIST,
): Promise<PlaylistVideo[]> {
  const videos: PlaylistVideo[] = [];
  let pageToken = "";

  while (videos.length < maxItems) {
    const params = new URLSearchParams({
      part: "contentDetails,snippet",
      playlistId,
      maxResults: "50",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const data = await ytGet("playlistItems", params);
    const items = (data as { items?: Array<Record<string, unknown>> })?.items ?? [];

    for (const item of items) {
      const contentDetails = (item.contentDetails ?? {}) as { videoId?: string };
      const snippet = (item.snippet ?? {}) as {
        title?: string;
        position?: number;
      };
      const videoId = contentDetails.videoId;
      if (!videoId) continue;
      videos.push({
        videoId,
        title: snippet.title ?? "(untitled video)",
        position: Number.isFinite(snippet.position) ? Number(snippet.position) : videos.length,
      });
      if (videos.length >= maxItems) break;
    }

    const next = (data as { nextPageToken?: string })?.nextPageToken;
    if (!next || items.length === 0) break;
    pageToken = next;
  }

  // Drop deleted/private placeholders YouTube leaves in the list.
  return videos.filter(
    (v) => v.title && !/^(deleted video|private video)$/i.test(v.title.trim()),
  );
}

/* -------------------------------------------------------------------------- */
/*                          topic <-> playlist matching                        */
/* -------------------------------------------------------------------------- */

/** Deterministic fallback: overlap between topic tokens and the video title. */
function keywordMatch(
  topics: Topic[],
  videos: PlaylistVideo[],
): PlaylistCoverage[] {
  const coverage: PlaylistCoverage[] = [];

  for (const topic of topics) {
    const topicTokens = new Set(tokenize(`${topic.title} ${topic.keywords.join(" ")}`));
    if (topicTokens.size === 0) continue;

    let best: { video: PlaylistVideo; score: number } | null = null;

    for (const video of videos) {
      const titleTokens = new Set(tokenize(video.title));
      if (titleTokens.size === 0) continue;

      let shared = 0;
      for (const token of topicTokens) if (titleTokens.has(token)) shared += 1;

      // Fraction of the topic's meaningful tokens that appear in the title.
      const score = shared / topicTokens.size;
      if (!best || score > best.score) best = { video, score };
    }

    // Two-thirds of the topic must literally appear in the title — anything
    // looser would claim coverage the playlist does not really provide.
    if (best && best.score >= 0.66) {
      coverage.push({
        topicId: topic.id,
        videoId: best.video.videoId,
        videoTitle: best.video.title,
      });
    }
  }

  return coverage;
}

/** AI matching pass — falls back to the keyword matcher on any failure. */
async function matchWithAi(
  topics: Topic[],
  videos: PlaylistVideo[],
): Promise<PlaylistCoverage[] | null> {
  if (!getLlmConfig()) return null;

  try {
    const { system, prompt } = buildPlaylistMapPrompt({
      topics: topics.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        keywords: t.keywords,
      })),
      videos: videos.map((v) => ({ id: v.videoId, title: v.title, position: v.position })),
    });

    const parsed = await generateJSON<{ maps?: Array<{ topicId?: unknown; videoId?: unknown }> }>(
      prompt,
      { system, temperature: 0.1, maxOutputTokens: 3072, timeoutMs: 45_000 },
    );

    const videoIds = new Set(videos.map((v) => v.videoId));
    const topicIds = new Set(topics.map((t) => t.id));
    const byVideoId = new Map(videos.map((v) => [v.videoId, v]));

    const coverage: PlaylistCoverage[] = [];
    const seenTopics = new Set<string>();

    for (const entry of parsed.maps ?? []) {
      const topicId = typeof entry?.topicId === "string" ? entry.topicId : "";
      const videoId = typeof entry?.videoId === "string" ? entry.videoId : "";
      if (!topicId || !videoId) continue;
      // Trust nothing the model invented.
      if (!topicIds.has(topicId) || !videoIds.has(videoId)) continue;
      if (seenTopics.has(topicId)) continue;

      seenTopics.add(topicId);
      coverage.push({
        topicId,
        videoId,
        videoTitle: byVideoId.get(videoId)?.title ?? "",
      });
    }

    return coverage.length > 0 ? coverage : null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*                                 orchestration                               */
/* -------------------------------------------------------------------------- */

/** Queries worth trying when hunting for a full course on this subject. */
function buildPlaylistQueries(subject: string, keywords: string[]): string[] {
  const clean = subject.trim().replace(/\s+/g, " ");
  if (!clean) return [];

  const base = clean.split(/[:\-–—(]/)[0].trim();
  const queries = [
    `${base} full course`,
    `${base} complete playlist`,
  ];

  // A distinctive syllabus keyword often finds the exact course that matters.
  const extra = keywords.find(
    (k) => k.trim().length > 4 && !base.toLowerCase().includes(k.toLowerCase().slice(0, 12)),
  );
  if (extra) queries.push(`${base} ${extra.trim()} full course`);

  return [...new Set(queries)].slice(0, 3);
}

function coveragePercent(covered: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((covered / total) * 100);
}

export interface FindPlaylistInput {
  subject: string;
  topics: Topic[];
  languageCode: string;
  /** Optional syllabus text — only its keywords are used to sharpen queries. */
  syllabus?: string;
}

/**
 * Searches for existing full-course playlists and returns the one that covers
 * the largest share of the student's topics. Returns null when nothing credible
 * exists, so the caller can fall back to per-topic search without lying about
 * coverage.
 */
export async function findCoursePlaylist(
  input: FindPlaylistInput,
): Promise<CoursePlaylist | null> {
  const topics = input.topics.filter((t) => t.title.trim().length > 1);
  if (topics.length === 0) return null;

  const keywords = [
    ...topics.flatMap((t) => t.keywords),
    ...tokenize(input.syllabus ?? "").slice(0, 40),
  ];

  const queries = buildPlaylistQueries(input.subject, keywords);
  if (queries.length === 0) return null;

  // 1. Search every query, in parallel, and dedupe the playlist ids.
  const idLists = await Promise.all(
    queries.map((q) =>
      searchPlaylists(q, input.languageCode, 10).catch(() => [] as string[]),
    ),
  );

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const list of idLists) {
    for (const id of list) {
      if (id && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }
  if (ids.length === 0) return null;

  // 2. Real metadata, then keep the plausible "full course" ones.
  const details = await fetchPlaylistDetails(ids).catch(() => [] as PlaylistCandidate[]);
  const plausible = details
    .filter((p) => p.id && p.videoCount >= MIN_PLAYLIST_VIDEOS)
    .sort((a, b) => {
      // Prefer playlists sized close to the syllabus, then longer ones.
      const sizeGap = (p: PlaylistCandidate) =>
        Math.abs(p.videoCount - Math.max(topics.length, MIN_PLAYLIST_VIDEOS));
      return sizeGap(a) - sizeGap(b) || b.videoCount - a.videoCount;
    })
    .slice(0, PLAYLISTS_TO_INSPECT);

  if (plausible.length === 0) return null;

  // 3. Page through each candidate and measure how much syllabus it covers.
  const inspected: Array<{
    playlist: PlaylistCandidate;
    videos: PlaylistVideo[];
    coverage: PlaylistCoverage[];
  }> = [];

  for (const playlist of plausible) {
    const videos = await fetchPlaylistItems(playlist.id).catch(
      () => [] as PlaylistVideo[],
    );
    if (videos.length === 0) continue;

    const aiCoverage = await matchWithAi(topics, videos);
    const coverage = aiCoverage ?? keywordMatch(topics, videos);

    inspected.push({
      playlist: { ...playlist, videoCount: Math.max(playlist.videoCount, videos.length) },
      videos,
      coverage,
    });
  }

  if (inspected.length === 0) return null;

  // 4. The winner is the playlist covering the most topics; ties go to the
  //    shorter playlist (less waffle between the lectures that matter).
  inspected.sort((a, b) => {
    const diff = b.coverage.length - a.coverage.length;
    if (diff !== 0) return diff;
    const ratio = (x: (typeof inspected)[number]) =>
      x.coverage.length / Math.max(1, x.videos.length);
    return ratio(b) - ratio(a);
  });

  const best = inspected[0];
  if (!best || best.coverage.length === 0) return null;

  const percent = coveragePercent(best.coverage.length, topics.length);
  if (percent < MIN_RECOMMEND_COVERAGE) return null;

  return {
    ...best.playlist,
    videos: best.videos,
    coverage: best.coverage,
    coveragePercent: percent,
    method: getLlmConfig() ? "ai" : "keyword",
    alternatives: inspected.slice(1, 3).map((entry) => entry.playlist),
  };
}

/** Quick lookup helper: topicId -> the playlist video that teaches it. */
export function coverageMap(
  playlist: CoursePlaylist | null | undefined,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const entry of playlist?.coverage ?? []) map[entry.topicId] = entry.videoId;
  return map;
}
