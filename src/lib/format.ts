/** Small formatting helpers shared by the server pipeline and the UI. */

export function formatDuration(totalSeconds: number): string {
  if (!totalSeconds || totalSeconds < 0) return "—";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export function formatViews(count: number): string {
  if (count >= 1_000_000_000) return `${(count / 1_000_000_000).toFixed(1)}B`;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count || 0);
}

export function formatMinutes(totalSeconds: number): string {
  const m = Math.round((totalSeconds || 0) / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}

export function videoUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

/** Human (Hinglish) label for why the YouTube API could not answer. */
export function apiReasonLabel(reason?: string): string {
  switch (reason) {
    case "no-key":
      return "key set nahi";
    case "quota":
      return "quota khatam";
    case "bad-request":
      return "request galat";
    case "throttled":
      return "bahut zyada requests";
    case "network":
      return "network issue";
    default:
      return "result nahi mila";
  }
}
