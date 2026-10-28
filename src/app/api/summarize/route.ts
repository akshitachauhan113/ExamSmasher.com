import { generateJSON, getLlmConfig } from "@/lib/llm";
import { buildSummaryPrompt } from "@/lib/prompts";
import type { SummaryResponse, VideoSummary } from "@/lib/types";
import { fetchTranscript, fetchVideoDetails } from "@/lib/youtube";

const CACHE_TTL = 60 * 60 * 1000;
const MAX_CACHE = 300;
const cache = new Map<string, { ts: number; value: SummaryResponse }>();

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    videoId?: unknown;
    videoTitle?: unknown;
    topicTitle?: unknown;
    languageCode?: unknown;
  } | null;

  const videoId = typeof body?.videoId === "string" ? body.videoId.trim() : "";
  const topicTitle =
    typeof body?.topicTitle === "string" ? body.topicTitle.trim().slice(0, 160) : "";

  if (!videoId || !topicTitle) {
    return Response.json(
      { ok: false, error: "Send `videoId` and `topicTitle`." },
      { status: 400 },
    );
  }

  const languageCode =
    typeof body?.languageCode === "string" && body.languageCode.trim()
      ? body.languageCode.trim()
      : "en";

  const cacheKey = `${videoId}|${languageCode}|${topicTitle}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return Response.json(hit.value);

  const config = getLlmConfig();
  if (!config) {
    return Response.json(
      {
        ok: false,
        error: "Summaries need an AI key. Open “API Keys” in the header and add GEMINI_API_KEY.",
      },
      { status: 503 },
    );
  }

  // Transcript first (best source), fall back to title + description.
  const [transcript, details] = await Promise.all([
    fetchTranscript(videoId, languageCode, 9000).catch(() => null),
    fetchVideoDetails([videoId]).catch(() => []),
  ]);
  const meta = details[0];

  const videoTitle =
    typeof body?.videoTitle === "string" && body.videoTitle.trim()
      ? body.videoTitle.trim()
      : meta?.title || "this video";

  const transcriptText = transcript?.text ?? "";

  const { system, prompt } = buildSummaryPrompt({
    topicTitle,
    videoTitle,
    videoDescription: meta?.description || undefined,
    transcript: transcriptText || undefined,
  });

  try {
    const parsed = await generateJSON<{ bullets?: unknown; fit?: unknown; level?: unknown }>(
      prompt,
      { system, temperature: 0.2, maxOutputTokens: 2048 },
    );

    const bullets = (Array.isArray(parsed.bullets) ? parsed.bullets : [])
      .filter((b): b is string => typeof b === "string" && b.trim().length > 0)
      .map((b) => b.trim().slice(0, 220))
      .slice(0, 8);

    if (bullets.length === 0) {
      return Response.json(
        { ok: false, error: "The AI returned an empty summary — try again." },
        { status: 502 },
      );
    }

    const level =
      parsed.level === "beginner" || parsed.level === "advanced" || parsed.level === "intermediate"
        ? parsed.level
        : undefined;

    const summary: VideoSummary = {
      bullets,
      fit: typeof parsed.fit === "string" ? parsed.fit.trim().slice(0, 240) : undefined,
      level,
    };

    const json: SummaryResponse = { ok: true, summary, transcriptAvailable: Boolean(transcriptText) };
    if (cache.size >= MAX_CACHE) cache.clear();
    cache.set(cacheKey, { ts: Date.now(), value: json });
    return Response.json(json);
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Summary failed." },
      { status: 502 },
    );
  }
}
