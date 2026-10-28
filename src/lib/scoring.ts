import { isTrustedChannel } from "./channels";
import type { ScoredVideo, Topic, VideoCandidate } from "./types";

/* -------------------------------------------------------------------------- */
/*                                 Text utils                                 */
/* -------------------------------------------------------------------------- */

const STOPWORDS = new Set([
  "the","and","for","with","from","this","that","these","those","your","you","are",
  "was","were","how","what","why","when","where","who","which","into","onto","use",
  "used","using","part","parts","chapter","chapters","lecture","lectures","video",
  "videos","tutorial","tutorials","explained","explanation","lesson","lessons",
  "course","courses","complete","comprehensive","basics","basic","introduction",
  "intro","overview","study","studies","class","classes","unit","units","syllabus",
  "exam","exams","free","online","best","top","tips","trick","tricks","easy","full",
  "hd","new","all","one","two","three","first","second","third","final","revision",
  "review","notes","note","in","on","of","to","at","is","it","be","by","or","an",
  "as","as","per","list","topic","topics","subject","details","detail","deep",
  "level","levels","advanced","beginner","intermediate","step","steps","guide",
]);

export function tokenize(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9+\-#.]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export function normalizeText(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'")
    .replace(/[^a-z0-9+\-#\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* -------------------------------------------------------------------------- */
/*                                 Relevance                                  */
/* -------------------------------------------------------------------------- */

export interface RelevanceBreakdown {
  relevance: number;
  matchedKeywords: string[];
  titleCoverage: number;
  transcriptCoverage: number | null;
}

const FULL_COURSE_PENALTY =
  /\b(full course|complete course|all in one|entire course|bootcamp|full syllabus|everything you need)\b/;

export function computeRelevance(
  topic: Topic,
  video: VideoCandidate,
  transcript?: string | null,
): RelevanceBreakdown {
  const topicTokenSet = new Set(tokenize(`${topic.title} ${topic.keywords.join(" ")}`));
  const titleTokens = new Set(tokenize(video.title));
  const metaTokens = new Set(
    tokenize(`${video.title} ${video.description.slice(0, 900)} ${video.channelTitle}`),
  );

  const videoText = normalizeText(
    `${video.title} ${video.description.slice(0, 900)}`,
  );

  const keywords = topic.keywords.filter((k) => k.trim().length > 1);
  const matchedKeywords = keywords.filter((k) => {
    const phrase = normalizeText(k);
    if (phrase.length < 3) return false;
    if (videoText.includes(phrase)) return true;
    // Fall back to token-level match for multi-word keywords.
    const parts = tokenize(k);
    if (parts.length === 0) return false;
    const meta = new Set(metaTokens);
    return parts.every((p) => meta.has(p));
  });

  const kwRatio = keywords.length ? matchedKeywords.length / keywords.length : 0;

  const topicTokens = [...topicTokenSet];
  const intersectionWith = (set: Set<string>) =>
    topicTokens.filter((t) => set.has(t)).length;

  const titleCoverage = topicTokens.length
    ? intersectionWith(titleTokens) / topicTokens.length
    : 0;
  const metaCoverage = topicTokens.length
    ? intersectionWith(metaTokens) / topicTokens.length
    : 0;

  let transcriptCoverage: number | null = null;
  if (transcript && transcript.length > 80) {
    const transcriptTokens = new Set(tokenize(transcript.slice(0, 4000)));
    transcriptCoverage = topicTokens.length
      ? intersectionWith(transcriptTokens) / topicTokens.length
      : 0;
  }

  // Weights: keywords are the strongest signal, then title, then description,
  // then (when available) the actual spoken transcript.
  let relevance = 0.4 * kwRatio + 0.3 * titleCoverage + 0.15 * metaCoverage;
  if (transcriptCoverage !== null) {
    relevance += 0.15 * Math.min(1, transcriptCoverage * 1.35);
  } else {
    relevance += 0.15 * Math.max(titleCoverage, metaCoverage);
  }

  if (FULL_COURSE_PENALTY.test(videoText)) relevance *= 0.72;

  return {
    relevance: clamp01(relevance),
    matchedKeywords,
    titleCoverage,
    transcriptCoverage,
  };
}

/* -------------------------------------------------------------------------- */
/*                                   Quality                                  */
/* -------------------------------------------------------------------------- */

const CURRENT_YEAR = new Date().getFullYear();

function durationScore(seconds: number): number {
  if (seconds < 60) return 0.15;
  if (seconds < 180) return 0.5;
  if (seconds <= 1800) return 1; // 3-30 min: the sweet spot for one topic
  if (seconds <= 3600) return 0.75;
  if (seconds <= 7200) return 0.5;
  return 0.35;
}

export function computeQuality(video: VideoCandidate): number {
  const views = Math.max(0, video.viewCount);
  const viewsScore = clamp01(Math.log10(views + 1) / 6);

  const likeRatio = views > 50 ? Math.min(video.likeCount, views) / views : 0.02;
  const likeScore = clamp01(likeRatio / 0.045);

  const commentRatio = views > 50 ? video.commentCount / views : 0;
  const commentScore = clamp01(commentRatio / 0.004);

  const published = video.publishedAt ? new Date(video.publishedAt) : null;
  const ageYears = published
    ? Math.max(0, (Date.now() - published.getTime()) / (365.25 * 24 * 3600 * 1000))
    : 3;
  const recencyScore = clampTo(1 - 0.025 * ageYears, 0.55, 1);

  const captionScore = video.hasCaptions ? 1 : 0.35;
  const channelScore = isTrustedChannel(video.channelTitle) ? 1 : 0.55;

  return clamp01(
    0.3 * viewsScore +
      0.22 * likeScore +
      0.08 * commentScore +
      0.18 * durationScore(video.durationSeconds) +
      0.12 * recencyScore +
      0.05 * captionScore +
      0.05 * channelScore,
  );
}

/* -------------------------------------------------------------------------- */
/*                              Assemble a record                             */
/* -------------------------------------------------------------------------- */

export function scoreCandidate(
  topic: Topic,
  video: VideoCandidate,
  transcript?: string | null,
): ScoredVideo {
  const { relevance, matchedKeywords, transcriptCoverage } = computeRelevance(
    topic,
    video,
    transcript,
  );
  const quality = computeQuality(video);
  const heuristicScore = Math.round(100 * (0.58 * relevance + 0.42 * quality));

  return {
    video,
    heuristicScore,
    aiScore: null,
    score: heuristicScore,
    relevance: Math.round(relevance * 100),
    quality: Math.round(quality * 100),
    reasons: buildReasons(topic, video, relevance, quality, matchedKeywords, transcriptCoverage),
    matchType: transcriptCoverage !== null ? "transcript" : "metadata",
    transcriptSnippet: transcript ? transcript.slice(0, 260) : undefined,
    trustedChannel: isTrustedChannel(video.channelTitle),
    rank: 0,
  };
}

function buildReasons(
  topic: Topic,
  video: VideoCandidate,
  relevance: number,
  quality: number,
  matchedKeywords: string[],
  transcriptCoverage: number | null,
): string[] {
  const reasons: string[] = [];
  const totalKeywords = topic.keywords.length;

  if (totalKeywords > 0 && matchedKeywords.length > 0) {
    reasons.push(
      `Covers ${matchedKeywords.length}/${totalKeywords} keywords`,
    );
  }
  if (transcriptCoverage !== null && transcriptCoverage >= 0.4) {
    reasons.push("Transcript confirms the topic");
  }
  if (isTrustedChannel(video.channelTitle)) {
    reasons.push(`Trusted educator: ${video.channelTitle}`);
  }
  if (video.hasCaptions) {
    reasons.push("Captions available");
  }
  if (video.viewCount >= 1_000_000) {
    reasons.push(`${formatCount(video.viewCount)} views`);
  }
  if (video.viewCount > 200 && video.likeCount > 0) {
    const pct = Math.round((Math.min(video.likeCount, video.viewCount) / video.viewCount) * 100);
    if (pct >= 90) reasons.push(`${pct}% like ratio`);
  }

  const minutes = Math.round(video.durationSeconds / 60);
  if (video.durationSeconds >= 240 && video.durationSeconds <= 1800) {
    reasons.push(`${minutes} min — ideal length`);
  } else if (video.durationSeconds > 3600) {
    reasons.push(`${minutes} min deep-dive lecture`);
  }

  if (relevance >= 0.8) reasons.push("Spot-on topic match");
  else if (quality >= 0.8) reasons.push("Highly rated teaching quality");

  return reasons.slice(0, 5);
}

export function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

/* -------------------------------------------------------------------------- */
/*                              Merging AI verdicts                           */
/* -------------------------------------------------------------------------- */

export interface AiVerdict {
  id: string;
  score: number;
  summary?: string;
  reasons?: string[];
}

/**
 * Blends the deterministic score with the AI verdict so the ranking stays
 * explainable but still benefits from reading titles + transcripts.
 */
export function mergeAiVerdicts(
  scored: ScoredVideo[],
  verdicts: AiVerdict[],
): ScoredVideo[] {
  const byId = new Map(verdicts.map((v) => [v.id, v]));

  return scored
    .map((s) => {
      const verdict = byId.get(s.video.id);
      if (!verdict) return s;

      const aiScore = clampTo(verdict.score, 0, 100);
      const aiReasons = (verdict.reasons ?? [])
        .map((r) => r.trim())
        .filter(Boolean)
        .slice(0, 2);

      return {
        ...s,
        aiScore,
        score: Math.round(0.5 * s.heuristicScore + 0.5 * aiScore),
        aiSummary: verdict.summary?.trim() || undefined,
        reasons: [...aiReasons, ...s.reasons].slice(0, 6),
      };
    })
    .sort((a, b) => b.score - a.score)
    .map((s, index) => ({ ...s, rank: index + 1 }));
}

/* -------------------------------------------------------------------------- */

function clamp01(n: number): number {
  return clampTo(n, 0, 1);
}

function clampTo(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export { CURRENT_YEAR };
