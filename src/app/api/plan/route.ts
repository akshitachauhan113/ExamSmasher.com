import { generateJSON, getLlmConfig } from "@/lib/llm";
import { buildPlanPrompt } from "@/lib/prompts";
import type { PlanDay, PlanItem, PlanResponse } from "@/lib/types";

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

interface RawItem {
  title?: unknown;
  minutes?: unknown;
  type?: unknown;
  videoTitle?: unknown;
  videoUrl?: unknown;
}

interface RawDay {
  day?: unknown;
  focus?: unknown;
  items?: RawItem[];
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
        error:
          "Study plans need an AI key. Open the “API Keys” panel in the header and add GEMINI_API_KEY.",
      },
      { status: 503 },
    );
  }

  const subject =
    typeof body.subject === "string" && body.subject.trim()
      ? body.subject.trim().slice(0, 80)
      : "your course";
  const totalDays = Math.min(30, Math.max(1, Math.round(Number(body.totalDays) || 7)));

  const topics = body.topics
    .filter((t) => t && typeof t.title === "string" && t.title.trim())
    .slice(0, 60)
    .map((t) => ({
      title: String(t.title).slice(0, 160),
      minutes: Math.max(5, Math.min(180, Math.round(Number(t.minutes) || 20))),
      importance:
        t.importance === "core" || t.importance === "bonus" ? t.importance : "important",
    }));

  const picks = body.picks
    .filter(
      (p) =>
        p &&
        typeof p.videoUrl === "string" &&
        p.videoUrl.startsWith("http") &&
        typeof p.videoTitle === "string",
    )
    .slice(0, 60)
    .map((p) => ({
      title: String(p.title ?? "").slice(0, 160),
      videoTitle: String(p.videoTitle).slice(0, 160),
      videoUrl: String(p.videoUrl),
      seconds: Math.max(60, Math.round(Number(p.seconds) || 600)),
    }));

  if (topics.length === 0 || picks.length === 0) {
    return Response.json(
      { ok: false, error: "Not enough valid topics/videos to build a plan." },
      { status: 400 },
    );
  }

  const { system, prompt } = buildPlanPrompt({ subject, topics, picks, totalDays });

  try {
    const parsed = await generateJSON<{ days?: RawDay[]; tips?: unknown[] }>(prompt, {
      system,
      temperature: 0.3,
      maxOutputTokens: 12_288,
    });

    const days = normalizeDays(parsed.days, totalDays);
    if (days.length === 0) {
      return Response.json(
        { ok: false, error: "The AI returned an empty plan — try generating again." },
        { status: 502 },
      );
    }

    const tips = (Array.isArray(parsed.tips) ? parsed.tips : [])
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
      .map((t) => t.trim().slice(0, 240))
      .slice(0, 8);

    const json: PlanResponse = {
      ok: true,
      days,
      tips,
      markdown: daysToMarkdown(days, tips, subject, totalDays),
    };
    return Response.json(json);
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Plan generation failed." },
      { status: 502 },
    );
  }
}

/** Keeps only usable days/items, renumbering them 1..N. */
function normalizeDays(raw: RawDay[] | undefined, expectedDays: number): PlanDay[] {
  const days: PlanDay[] = (Array.isArray(raw) ? raw : [])
    .map((day, index) => {
      const items: PlanItem[] = [];
      for (const item of Array.isArray(day.items) ? day.items : []) {
        const title = typeof item.title === "string" ? item.title.trim().slice(0, 200) : "";
        if (!title) continue;
        const minutes = Math.max(5, Math.min(240, Math.round(Number(item.minutes) || 15)));
        const isVideoUrl =
          typeof item.videoUrl === "string" && item.videoUrl.startsWith("http");
        const type: PlanItem["type"] =
          item.type === "video" || item.type === "revision" || item.type === "practice"
            ? item.type
            : isVideoUrl
              ? "video"
              : "practice";
        const videoUrl = type === "video" && isVideoUrl ? (item.videoUrl as string).slice(0, 300) : undefined;
        const videoTitle =
          typeof item.videoTitle === "string" && item.videoTitle.trim()
            ? item.videoTitle.trim().slice(0, 160)
            : undefined;
        items.push({ title, minutes, type, videoUrl, videoTitle });
      }

      return {
        day: index + 1,
        focus: typeof day.focus === "string" ? day.focus.trim().slice(0, 160) : "",
        items,
      };
    })
    .filter((day) => day.items.length > 0)
    .slice(0, expectedDays);

  return days.map((day, index) => ({ ...day, day: index + 1 }));
}

/** Renders the structured plan as Markdown for copy/download/export. */
export function daysToMarkdown(
  days: PlanDay[],
  tips: string[],
  subject: string,
  totalDays: number,
): string {
  const totalMinutes = days.reduce(
    (sum, day) => sum + day.items.reduce((s, item) => s + item.minutes, 0),
    0,
  );
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  const totalLabel = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  const dailyAvg = Math.round(totalMinutes / Math.max(1, days.length));

  const lines: string[] = [
    `# 📅 ${totalDays}-Day Study Plan — ${subject}`,
    "",
    `**Total study time:** ${totalLabel}  |  **Daily load:** ~${dailyAvg} min  |  **Days:** ${days.length}`,
    "",
    "| Day | Focus | Items | Time |",
    "| --- | --- | --- | --- |",
    ...days.map((day) => {
      const time = day.items.reduce((sum, item) => sum + item.minutes, 0);
      return `| ${day.day} | ${day.focus || "Study"} | ${day.items.length} | ${time} min |`;
    }),
    "",
  ];

  for (const day of days) {
    const time = day.items.reduce((sum, item) => sum + item.minutes, 0);
    lines.push(`## Day ${day.day} — ${day.focus || "Study"} (${time} min)`);
    lines.push("");
    for (const item of day.items) {
      const link =
        item.videoUrl && item.videoTitle ? ` — [${item.videoTitle}](${item.videoUrl})` : "";
      lines.push(`- [ ] ${item.title} (${item.minutes} min${item.type ? `, ${item.type}` : ""})${link}`);
    }
    lines.push("");
  }

  if (tips.length > 0) {
    lines.push("## 🎯 Strategy tips", "");
    for (const tip of tips) lines.push(`- ${tip}`);
    lines.push("");
  }

  return lines.join("\n");
}
