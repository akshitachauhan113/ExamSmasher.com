import type { VideoCandidate } from "./types";

const YT_API = "https://www.googleapis.com/youtube/v3";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export class YouTubeError extends Error {
  status: number;
  /** True when the daily API quota is what stopped us. */
  quota: boolean;
  constructor(message: string, status: number, quota = false) {
    super(message);
    this.status = status;
    this.quota = quota;
    this.name = "YouTubeError";
  }
}

/**
 * YouTube's daily quota resets at midnight Pacific. Remembering that we are
 * out stops us burning a second, third and fourth 400-unit search fan-out on
 * topics that are doomed to fail anyway — and lets the UI say plainly which
 * parts of the syllabus could NOT be covered, instead of showing 27 silent
 * empty panels.
 */
const QUOTA_RESET_MS = 1000 * 60 * 60 * 6; // retry after 6h; resets at PT midnight
let quotaExhaustedUntil = 0;

export function isQuotaExhausted(): boolean {
  return Date.now() < quotaExhaustedUntil;
}

function markQuotaExhausted(): void {
  quotaExhaustedUntil = Date.now() + QUOTA_RESET_MS;
}

export const QUOTA_MESSAGE =
  "YouTube ka daily API quota khatam ho gaya — videos aaj aur nahi milenge (reset: PT midnight). " +
  "Neeche dekh kaunse topics reh gaye, unhe notes se khud padh lo.";

/** Call before every search fan-out so we fail fast instead of failing loudly. */
export function assertQuotaAvailable(): void {
  if (isQuotaExhausted()) throw new YouTubeError(QUOTA_MESSAGE, 403, true);
}

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

export function abortAfter(ms: number): {
  signal: AbortSignal;
  done: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

export interface SearchOptions {
  query: string;
  languageCode: string;
  maxResults?: number;
  duration?: "any" | "medium" | "long";
}

/** Runs one YouTube search and returns candidate video IDs in relevance order. */
export async function searchYouTube(options: SearchOptions): Promise<string[]> {
  const { query, languageCode, maxResults = 25, duration = "any" } = options;

  const params = new URLSearchParams({
    part: "id",
    type: "video",
    maxResults: String(Math.min(50, maxResults)),
    q: query,
    relevanceLanguage: languageCode,
    videoEmbeddable: "true",
    videoCaption: "any",
    videoSyndicated: "true",
    order: "relevance",
  });
  if (duration !== "any") params.set("videoDuration", duration);

  const key = apiKey(); // throws a clear "key missing" error before any network call

  const { signal, done } = abortAfter(20_000);
  let res: Response;
  try {
    res = await fetch(`${YT_API}/search?${params.toString()}&key=${key}`, {
      signal,
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    if (err instanceof YouTubeError) throw err;
    throw new YouTubeError(
      err instanceof Error && err.name === "AbortError"
        ? "YouTube search timed out."
        : "Could not reach YouTube. Check your internet connection.",
      504,
    );
  } finally {
    done();
  }

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const reason = (
      data as { error?: { message?: string; errors?: Array<{ reason?: string }> } }
    )?.error;
    const quota = isQuotaError(res.status, reason);
    if (quota) markQuotaExhausted();
    throw new YouTubeError(
      quota
        ? QUOTA_MESSAGE
        : (reason?.message ?? `YouTube API error (${res.status})`),
      res.status,
      quota,
    );
  }

  const items = (data as { items?: Array<{ id?: { videoId?: string } }> })?.items ?? [];
  return items
    .map((i) => i.id?.videoId)
    .filter((id): id is string => Boolean(id));
}

/** quotaExceeded / dailyLimitExceeded both mean: stop spending, report honestly. */
function isQuotaError(
  status: number,
  reason: { message?: string; errors?: Array<{ reason?: string }> } | undefined,
): boolean {
  if (status === 403) {
    const code = reason?.errors?.[0]?.reason ?? "";
    if (/quota/i.test(code) || /quota/i.test(reason?.message ?? "")) return true;
    // A 403 with no discernible reason is almost always the daily quota.
    if (!code) return true;
  }
  return /quota|daily limit/i.test(reason?.message ?? "");
}

/** Fetches rich metadata (stats, duration, captions flag) for up to 50 videos. */
export async function fetchVideoDetails(ids: string[]): Promise<VideoCandidate[]> {
  if (ids.length === 0) return [];

  const params = new URLSearchParams({
    part: "snippet,statistics,contentDetails,status",
    id: ids.slice(0, 50).join(","),
    maxResults: "50",
  });

  const key = apiKey();

  const { signal, done } = abortAfter(20_000);
  let res: Response;
  try {
    res = await fetch(`${YT_API}/videos?${params.toString()}&key=${key}`, {
      signal,
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    if (err instanceof YouTubeError) throw err;
    throw new YouTubeError(
      err instanceof Error && err.name === "AbortError"
        ? "YouTube details request timed out."
        : "Could not reach YouTube for video details.",
      504,
    );
  } finally {
    done();
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (data as { error?: { message?: string; errors?: Array<{ reason?: string }> } })
      .error;
    const quota = isQuotaError(res.status, err);
    if (quota) markQuotaExhausted();
    throw new YouTubeError(
      quota ? QUOTA_MESSAGE : (err?.message ?? `YouTube API error (${res.status})`),
      res.status,
      quota,
    );
  }

  const items =
    (data as {
      items?: Array<Record<string, unknown>>;
    })?.items ?? [];

  return items.map((raw) => {
    const snippet = (raw.snippet ?? {}) as {
      title?: string;
      description?: string;
      channelTitle?: string;
      channelId?: string;
      publishedAt?: string;
      thumbnails?: Record<string, { url?: string }>;
    };
    const statistics = (raw.statistics ?? {}) as {
      viewCount?: string;
      likeCount?: string;
      commentCount?: string;
    };
    const contentDetails = (raw.contentDetails ?? {}) as { duration?: string };
    const status = (raw.status ?? {}) as { caption?: string; embeddable?: boolean };

    const thumbs = snippet.thumbnails ?? {};
    const thumbnail =
      thumbs.maxres?.url ??
      thumbs.standard?.url ??
      thumbs.high?.url ??
      thumbs.medium?.url ??
      thumbs.default?.url ??
      "";

    return {
      id: String(raw.id ?? ""),
      title: snippet.title ?? "(untitled video)",
      description: snippet.description ?? "",
      channelTitle: snippet.channelTitle ?? "Unknown channel",
      channelId: snippet.channelId ?? "",
      publishedAt: snippet.publishedAt ?? "",
      thumbnail,
      durationSeconds: parseISODuration(contentDetails.duration ?? ""),
      viewCount: toNumber(statistics.viewCount),
      likeCount: toNumber(statistics.likeCount),
      commentCount: toNumber(statistics.commentCount),
      hasCaptions: status.caption === "true",
      embeddable: status.embeddable !== false,
    } satisfies VideoCandidate;
  });
}

function toNumber(value?: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Converts ISO-8601 durations like PT1H2M3S into seconds. */
export function parseISODuration(iso: string): number {
  const match = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || "");
  if (!match) return 0;
  const [, d, h, m, s] = match;
  return (
    Number(d ?? 0) * 86400 +
    Number(h ?? 0) * 3600 +
    Number(m ?? 0) * 60 +
    Number(s ?? 0)
  );
}

/* -------------------------------------------------------------------------- */
/*                            Transcript fetching                             */
/* -------------------------------------------------------------------------- */

export interface TranscriptResult {
  text: string;
  language: string;
}

const transcriptCache = new Map<string, TranscriptResult | null>();
const MAX_CACHE = 300;

function rememberTranscript(videoId: string, value: TranscriptResult | null) {
  if (transcriptCache.size >= MAX_CACHE) {
    const oldest = transcriptCache.keys().next().value;
    if (oldest) transcriptCache.delete(oldest);
  }
  transcriptCache.set(videoId, value);
}

/**
 * Best-effort caption download used to verify that a video really teaches the topic.
 *
 * YouTube has no official transcript API and now signs caption URLs with a
 * proof-of-origin token, so the direct route below only works on some networks.
 * We therefore fall back to public caption proxies (Piped / Invidious), and if
 * every source fails we return null so the caller can use metadata matching.
 */
export async function fetchTranscript(
  videoId: string,
  languageCode = "en",
  timeoutMs = 8000,
): Promise<TranscriptResult | null> {
  const cached = transcriptCache.get(videoId);
  if (cached !== undefined) return cached;

  let result: TranscriptResult | null = null;

  // 1. Direct from the YouTube watch page (fast path, no third party).
  result = await fromYouTubePage(videoId, languageCode, timeoutMs);

  // 2. Public caption proxies, in order, skipping instances in cooldown.
  if (!result) result = await fromPiped(videoId, languageCode, timeoutMs);
  if (!result) result = await fromInvidious(videoId, languageCode, timeoutMs);

  rememberTranscript(videoId, result);
  return result;
}

/* --------------------------- source 1: YouTube --------------------------- */

async function fromYouTubePage(
  videoId: string,
  languageCode: string,
  timeoutMs: number,
): Promise<TranscriptResult | null> {
  try {
    const { signal, done } = abortAfter(timeoutMs);
    let html: string;
    try {
      const res = await fetch(`https://www.youtube.com/watch?v=${videoId}&hl=en`, {
        signal,
        headers: {
          "User-Agent": UA,
          "Accept-Language": "en-US,en;q=0.9",
          Cookie: "CONSENT=YES+1",
        },
      });
      html = await res.text();
    } finally {
      done();
    }

    const player = extractJsonObject(html, "var ytInitialPlayerResponse = ");
    const tracks =
      (player as
        | {
            captions?: {
              playerCaptionsTracklistRenderer?: {
                captionTracks?: Array<{
                  baseUrl?: string;
                  languageCode?: string;
                }>;
              };
            };
          }
        | undefined)?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];

    if (tracks.length === 0) return null;

    const wanted = languageCode.split("-")[0].toLowerCase();
    const track =
      tracks.find((t) => (t.languageCode ?? "").toLowerCase().startsWith(wanted)) ??
      tracks.find((t) => (t.languageCode ?? "").toLowerCase().startsWith("en")) ??
      tracks[0];

    if (!track?.baseUrl) return null;

    const { signal: s2, done: d2 } = abortAfter(timeoutMs);
    let body: string;
    try {
      const res = await fetch(`${track.baseUrl}&fmt=json3`, {
        signal: s2,
        headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
      });
      body = await res.text();
    } finally {
      d2();
    }

    const text = parseCaptionBody(body);
    return text.trim().length > 40
      ? { text: text.trim().slice(0, 6000), language: track.languageCode ?? languageCode }
      : null;
  } catch {
    return null;
  }
}

/* ---------------------------- source 2: Piped ---------------------------- */

const PIPED_INSTANCES = [
  "https://api.piped.private.coffee",
  "https://pipedapi.moomoo.me",
  "https://pipedapi.adminforge.de",
];

/** Proxies are third-party and often rate-limited, so they get a short leash. */
const PROXY_TIMEOUT_MS = 5000;

async function fromPiped(
  videoId: string,
  languageCode: string,
  timeoutMs: number,
): Promise<TranscriptResult | null> {
  const wanted = languageCode.split("-")[0].toLowerCase();
  const budget = Math.min(timeoutMs, PROXY_TIMEOUT_MS);

  for (const instance of usableInstances(PIPED_INSTANCES)) {
    try {
      const { signal, done } = abortAfter(budget);
      let payload: {
        subtitles?: Array<{ code?: string; url?: string; autoGenerated?: boolean }>;
      };
      try {
        const res = await fetch(`${instance}/streams/${videoId}`, {
          signal,
          headers: { "User-Agent": UA, Accept: "application/json" },
        });
        if (!res.ok) {
          markInstanceFailed(instance);
          continue;
        }
        payload = await res.json();
      } finally {
        done();
      }

      const subtitles = payload.subtitles ?? [];
      if (subtitles.length === 0) {
        markInstanceFailed(instance);
        continue;
      }

      const preferred =
        subtitles.find((s) => (s.code ?? "").toLowerCase().startsWith(wanted) && !s.autoGenerated) ??
        subtitles.find((s) => (s.code ?? "").toLowerCase().startsWith(wanted)) ??
        subtitles.find((s) => !s.autoGenerated) ??
        subtitles[0];

      if (!preferred?.url) continue;

      const s2 = abortAfter(budget);
      let body: string;
      try {
        const res = await fetch(preferred.url, { signal: s2.signal, headers: { "User-Agent": UA } });
        if (!res.ok) continue;
        body = await res.text();
      } finally {
        s2.done();
      }

      const text = parseCaptionBody(body);
      if (text.trim().length > 40) {
        markInstanceWorked(instance);
        return { text: text.trim().slice(0, 6000), language: preferred.code ?? languageCode };
      }
    } catch {
      markInstanceFailed(instance);
    }
  }
  return null;
}

/* -------------------------- source 3: Invidious -------------------------- */

const INVIDIOUS_INSTANCES = [
  "https://inv.nadeko.net",
  "https://invidious.nerdvpn.de",
];

async function fromInvidious(
  videoId: string,
  languageCode: string,
  timeoutMs: number,
): Promise<TranscriptResult | null> {
  const wanted = languageCode.split("-")[0].toLowerCase();
  const budget = Math.min(timeoutMs, PROXY_TIMEOUT_MS);

  for (const instance of usableInstances(INVIDIOUS_INSTANCES)) {
    try {
      const { signal, done } = abortAfter(budget);
      let list: { captions?: Array<{ label?: string; languageCode?: string; url?: string }> };
      try {
        const res = await fetch(`${instance}/api/v1/captions/${videoId}`, {
          signal,
          headers: { "User-Agent": UA, Accept: "application/json" },
        });
        if (!res.ok) {
          markInstanceFailed(instance);
          continue;
        }
        const raw = await res.text();
        list = JSON.parse(raw);
      } finally {
        done();
      }

      const captions = list.captions ?? [];
      const preferred =
        captions.find((c) => (c.languageCode ?? "").toLowerCase().startsWith(wanted)) ??
        captions.find((c) => (c.languageCode ?? "").toLowerCase().startsWith("en")) ??
        captions[0];

      if (!preferred?.url) continue;

      const s2 = abortAfter(budget);
      let body: string;
      try {
        const res = await fetch(`${instance}${preferred.url}`, {
          signal: s2.signal,
          headers: { "User-Agent": UA },
        });
        if (!res.ok) continue;
        body = await res.text();
      } finally {
        s2.done();
      }

      const text = parseCaptionBody(body);
      if (text.trim().length > 40) {
        markInstanceWorked(instance);
        return { text: text.trim().slice(0, 6000), language: preferred.languageCode ?? languageCode };
      }
    } catch {
      markInstanceFailed(instance);
    }
  }
  return null;
}

/* ------------------------- proxy health tracking ------------------------- */

const instanceCooldown = new Map<string, number>();
const COOLDOWN_MS = 3 * 60 * 1000;

function usableInstances(instances: string[]): string[] {
  const now = Date.now();
  const healthy = instances.filter((i) => (instanceCooldown.get(i) ?? 0) < now);
  return healthy.length > 0 ? healthy : instances; // if all are cooling down, try anyway
}

function markInstanceFailed(instance: string): void {
  instanceCooldown.set(instance, Date.now() + COOLDOWN_MS);
}

function markInstanceWorked(instance: string): void {
  instanceCooldown.delete(instance);
}

/** Extracts a balanced JSON object that follows the given marker in a page. */
function extractJsonObject(source: string, marker: string): unknown | null {
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) return null;
  const start = source.indexOf("{", markerIndex);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Handles json3, TTML (Piped), legacy XML and plain VTT caption bodies. */
function parseCaptionBody(body: string): string {
  if (!body || !body.trim()) return "";

  // 1. json3 (YouTube's own timedtext format)
  try {
    const data = JSON.parse(body) as {
      events?: Array<{ segs?: Array<{ utf8?: string }> }>;
    };
    const joined = (data.events ?? [])
      .flatMap((e) => e.segs ?? [])
      .map((s) => s.utf8 ?? "")
      .join("");
    if (joined.trim()) return decodeEntities(joined).replace(/\s+/g, " ").trim();
  } catch {
    /* not json3 */
  }

  // 2. TTML / XML with <p> (TTML) or <text> (legacy YouTube) cue elements
  if (body.includes("<")) {
    const cues =
      body.match(/<(?:[\w-]+:)?(?:p|text)[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?(?:p|text)>/g) ?? [];
    if (cues.length > 0) {
      const decoded = cues
        .map((cue) => cue.replace(/<[^>]+>/g, ""))
        .join(" ");
      const cleaned = decodeEntities(decoded).replace(/\s+/g, " ").trim();
      if (cleaned) return cleaned;
    }
  }

  // 3. Plain WebVTT: drop header, cue numbers, timestamps and styling tags
  if (/^\s*WEBVTT/.test(body)) {
    const vtt = body
      .replace(/^\s*WEBVTT.*$/m, "")
      .replace(/^\d+\s*$/gm, "")
      .replace(/^\d{2}:\d{2}(?::\d{2})?[\.,]\d{3}\s*-->\s*.*$/gm, "")
      .replace(/<[^>]+>/g, "");
    const cleaned = decodeEntities(vtt).replace(/\s+/g, " ").trim();
    if (cleaned) return cleaned;
  }

  return "";
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, " ");
}

/* -------------------------------------------------------------------------- */
/*                                  Helpers                                   */
/* -------------------------------------------------------------------------- */

export { formatDuration, formatViews, videoUrl } from "./format";
