import { generateText, getLlmConfig } from "@/lib/llm";
import { buildPlanPrompt } from "@/lib/prompts";

interface PlanTopic {
  title?: unknown;
  minutes?: unknown;
  importance?: unknown;
}

interface PlanPick {
  title?: unknown;
  videoTitle?: unknown;
  videoUrl?: unknown;
  seconds?: unknown;
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    subject?: unknown;
    topics?: PlanTopic[];
    picks?: PlanPick[];
    totalDays?: unknown;
  } | null;

  if (!body || !Array.isArray(body.topics) || !Array.isArray(body.picks)) {
    return Response.json(
      { ok: false, error: "Send `topics` and `picks` arrays." },
      { status: 400 },
    );
  }
  if (body.picks.length === 0) {
    return Response.json(
      { ok: false, error: "Pick at least one video before generating a study plan." },
      { status: 400 },
    );
  }

  const config = getLlmConfig();
  if (!config) {
    return Response.json(
      {
        ok: false,
        error: "Add GEMINI_API_KEY to .env.local to generate study plans.",
      },
      { status: 401 },
    );
  }

  const subject = typeof body.subject === "string" && body.subject.trim() ? body.subject.trim() : "Your course";
  const totalDays = Math.min(60, Math.max(1, Math.round(Number(body.totalDays) || 14)));

  const topics = body.topics.slice(0, 40).map((t) => ({
    title: String(t?.title ?? "").slice(0, 120),
    minutes: Number(t?.minutes) || 20,
    importance: String(t?.importance ?? "important"),
  }));

  const picks = body.picks
    .filter((p) => typeof p?.videoUrl === "string" && p.videoUrl.includes("youtu"))
    .slice(0, 40)
    .map((p) => ({
      title: String(p?.title ?? "").slice(0, 120),
      videoTitle: String(p?.videoTitle ?? "").slice(0, 160),
      videoUrl: String(p?.videoUrl).slice(0, 120),
      seconds: Number(p?.seconds) || 600,
    }));

  if (picks.length === 0) {
    return Response.json(
      { ok: false, error: "No valid video links were provided." },
      { status: 400 },
    );
  }

  const { system, prompt } = buildPlanPrompt({
    subject,
    topics,
    picks,
    totalDays,
  });

  try {
    const markdown = await generateText(prompt, {
      system,
      temperature: 0.4,
      maxOutputTokens: 4096,
    });
    return Response.json({ ok: true, markdown: markdown.trim(), provider: config.provider });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Could not generate a study plan.",
      },
      { status: 502 },
    );
  }
}
