import { findCoursePlaylist } from "@/lib/playlists";
import type { PlaylistResponse, Topic } from "@/lib/types";

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    topics?: Array<Partial<Topic>>;
    subject?: unknown;
    language?: unknown;
    syllabus?: unknown;
  } | null;

  const topics = (Array.isArray(body?.topics) ? body.topics : [])
    .map((raw, index): Topic | null => {
      if (!raw || typeof raw.title !== "string" || raw.title.trim().length < 2) return null;
      return {
        id: typeof raw.id === "string" ? raw.id : `t-${index + 1}`,
        title: raw.title.trim().slice(0, 120),
        description: typeof raw.description === "string" ? raw.description.slice(0, 400) : "",
        keywords: Array.isArray(raw.keywords)
          ? raw.keywords
              .filter((k): k is string => typeof k === "string")
              .map((k) => k.trim().slice(0, 60))
              .filter(Boolean)
              .slice(0, 8)
          : [],
        importance: raw.importance ?? "important",
        difficulty: raw.difficulty ?? "intermediate",
        estimatedMinutes: Number(raw.estimatedMinutes) || 20,
        chapter: typeof raw.chapter === "string" ? raw.chapter.slice(0, 60) : undefined,
      };
    })
    .filter((t): t is Topic => t !== null);

  if (topics.length === 0) {
    return Response.json(
      { ok: false, error: "Send a `topics` array extracted from the syllabus." },
      { status: 400 },
    );
  }

  if (!process.env.YOUTUBE_API_KEY?.trim()) {
    return Response.json(
      { ok: false, error: "YouTube API key missing — cannot look for a full-course playlist." },
      { status: 503 },
    );
  }

  const subject = typeof body?.subject === "string" ? body.subject.trim().slice(0, 80) : "";
  const languageCode =
    typeof body?.language === "string" && body.language.trim() ? body.language.trim() : "en";

  try {
    const playlist = await findCoursePlaylist({
      subject,
      topics,
      languageCode,
      syllabus: typeof body?.syllabus === "string" ? body.syllabus : undefined,
    });

    // Not finding one is a normal outcome, not an error — the client just
    // falls back to the per-topic search it already had.
    const response: PlaylistResponse = { ok: true, playlist: playlist ?? null };
    return Response.json(response);
  } catch (error) {
    const response: PlaylistResponse = {
      ok: true,
      playlist: null,
      error: error instanceof Error ? error.message : "Playlist lookup failed.",
    };
    return Response.json(response);
  }
}
