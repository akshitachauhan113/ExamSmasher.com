import {
  findRecommendablePlaylist,
  isPlaylistCached,
  PlaylistQuotaError,
  PlaylistUpstreamError,
} from "@/lib/ytPlaylist";
import type { CoursePlaylistRequest, CoursePlaylistResponse } from "@/lib/types";

/**
 * POST /api/playlists — does an EXISTING full-course YouTube playlist
 * genuinely cover this syllabus? (The restored ExamSmasher course-playlist
 * feature.)
 *
 * The YouTube Data API key lives ONLY here (server env). One lookup costs
 * ~200 quota units, so answers are cached in @/lib/ytPlaylist for 6 h and
 * the route throttles repeat callers. Failures are always honest:
 *   ok=false + reason ("no-key" / "quota" / "upstream" / …) → the UI simply
 *   shows no playlist banner, and ok=true + playlist=null means "checked,
 *   nothing credible exists". Nothing is ever invented.
 */

const MAX_TOPICS = 250;
const THROTTLE_WINDOW_MS = 10 * 60 * 1000;
const THROTTLE_MAX = 15;

/** ip → request timestamps inside the throttle window. */
const hits = new Map<string, number[]>();

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

function parsePayload(body: unknown): CoursePlaylistRequest | { error: true } {
  if (!body || typeof body !== "object") return { error: true };
  const { subject, topics, syllabus } = body as Partial<CoursePlaylistRequest>;
  if (!Array.isArray(topics) || topics.length === 0 || topics.length > MAX_TOPICS) {
    return { error: true };
  }

  const cleanTopics: CoursePlaylistRequest["topics"] = [];
  for (const topic of topics) {
    if (!topic || typeof topic.id !== "string" || typeof topic.title !== "string") {
      return { error: true };
    }
    const title = topic.title.slice(0, 200).trim();
    if (!title) return { error: true };
    cleanTopics.push({
      id: topic.id.slice(0, 60),
      title,
      keywords: Array.isArray(topic.keywords)
        ? topic.keywords
            .filter((k): k is string => typeof k === "string")
            .slice(0, 30)
            .map((k) => k.slice(0, 80))
        : [],
    });
  }

  return {
    subject: typeof subject === "string" ? subject.slice(0, 120) : "",
    topics: cleanTopics,
    syllabus: typeof syllabus === "string" ? syllabus.slice(0, 4000) : undefined,
  };
}

export async function POST(request: Request): Promise<Response> {
  const json = (body: CoursePlaylistResponse, status = 200): Response =>
    Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

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

  // Throttle only LOOKUPS that would actually hit YouTube: a cached answer is
  // free to serve, so a student revisiting the tab is never rate-limited.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!isPlaylistCached(payload) && throttled(ip)) {
    return json({ ok: false, reason: "throttled" }, 429);
  }

  try {
    const playlist = await findRecommendablePlaylist(payload, key);
    // playlist=null is a SUCCESS: we looked, and nothing genuinely covers
    // this syllabus — the UI then shows no banner instead of a fake one.
    return json({ ok: true, playlist });
  } catch (err) {
    if (err instanceof PlaylistQuotaError) return json({ ok: false, reason: "quota" }, 429);
    if (err instanceof PlaylistUpstreamError) return json({ ok: false, reason: "upstream" }, 502);
    return json({ ok: false, reason: "upstream" }, 502);
  }
}
