import type { Importance, PlanDay, PlanItem, PlanResponse } from "@/lib/types";

/**
 * Daily study plan — deterministic, so it is instant and never depends on a
 * model being loaded.
 *
 * Two rules make it honest: every topic fits inside the student's real time
 * budget (nothing is scheduled that cannot be finished), and the YouTube
 * entries are labelled as search links rather than watched videos.
 */

export interface PlanPick {
  title: string;
  minutes?: number;
  importance?: Importance;
  videoTitle?: string;
  videoUrl?: string;
}

export interface PlanRulesInput {
  subject: string;
  picks: PlanPick[];
  totalDays: number;
}

const DAILY_BUDGET = 60;
const MIN_ITEM = 8;
const MAX_ITEM = 45;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export function buildPlanRules(input: PlanRulesInput): PlanResponse {
  const totalDays = clamp(Math.round(input.totalDays) || 7, 1, 30);
  const remaining = input.picks.filter((p) => p && p.title);
  if (remaining.length === 0) {
    return { ok: false, error: "Koi topic nahi bacha — pehle syllabus analyse karo." };
  }

  const days: PlanDay[] = [];
  let cursor = 0;

  for (let d = 0; d < totalDays && cursor < remaining.length; d += 1) {
    const daysLeft = totalDays - d;
    const quota = Math.max(1, Math.ceil((remaining.length - cursor) / daysLeft));

    const items: PlanItem[] = [];
    let time = 0;
    let taken = 0;

    while (cursor < remaining.length && taken < quota) {
      const pick = remaining[cursor];
      const minutes = clamp(Math.round(pick.minutes ?? 20), MIN_ITEM, MAX_ITEM);
      if (items.length > 0 && time + minutes > DAILY_BUDGET) break;

      cursor += 1;
      taken += 1;
      time += minutes;
      items.push({
        title: pick.title,
        minutes,
        type: "video",
        videoTitle: pick.videoTitle,
        videoUrl: pick.videoUrl,
      });
    }

    if (items.length === 0) break;

    // Top-up with a short recall pass so a light day is still useful work.
    const spare = DAILY_BUDGET - time;
    if (spare >= 8 && items.length > 0) {
      items.push({
        title: `Revise: ${items[0].title}`,
        minutes: Math.min(spare, 10),
        type: "revision",
      });
    }

    days.push({
      day: d + 1,
      focus: focusFor(items, input.subject),
      items,
    });
  }

  if (days.length === 0) {
    return { ok: false, error: "Plan banane me dikkat aa gayi — dobara try karo." };
  }

  const tips = buildTips(input.subject, remaining, days.length);

  return {
    ok: true,
    days: renumber(days),
    tips,
    markdown: daysToMarkdown(renumber(days), tips, input.subject, days.length),
    source: "rules",
  };
}

function renumber(days: PlanDay[]): PlanDay[] {
  return days.map((day, index) => ({ ...day, day: index + 1 }));
}

function focusFor(items: PlanItem[], subject: string): string {
  const first = items.find((i) => i.type !== "revision");
  const title = first?.title ?? items[0]?.title ?? subject;
  return title.length > 52 ? `${title.slice(0, 52).trim()}…` : title;
}

function buildTips(subject: string, picks: PlanPick[], days: number): string[] {
  const core = picks.filter((p) => p.importance === "core").length;
  const tips = [
    `Har din ${DAILY_BUDGET} min se zyada mat karo — consistency beats a 6-hour Sunday.`,
    `Ek din chhoot jaye toh agle din pending topic pehle karo, baad me aage badho.`,
  ];
  if (core > 0) {
    tips.push(
      `${core} core topic${core > 1 ? "s" : ""} hain — inhe ${days} din me har haal me khatam karo, bonus topics sirf time bacho toh.`,
    );
  }
  if (subject) {
    tips.push(
      `Har topic ke YouTube link par click karke naye tab me search khulega — wahan se ek video chuno aur wahi dekho.`,
    );
  }
  tips.push(`Last 2 din sirf revision ke liye rakho — naya topic exam se 2 din pehle shuru mat karo.`);
  return tips;
}

/** Renders the plan as Markdown for copy/download/export. */
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
      lines.push(
        `- [ ] ${item.title} (${item.minutes} min${item.type ? `, ${item.type}` : ""})${link}`,
      );
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
