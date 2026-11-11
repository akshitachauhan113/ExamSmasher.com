import { LANGUAGES } from "@/lib/languages";
import type { Topic, TopicResult, VideoSearch } from "@/lib/types";

/**
 * YouTube search LINKS instead of YouTube Data API matches.
 *
 * We never call YouTube, never fetch a title, a view count or a rating, and
 * never invent one either. All we build is a URL to YouTube's own results
 * page for a query derived from the syllabus — what the student sees after
 * clicking is whatever YouTube actually returns, unfiltered.
 */

export function youtubeSearchUrl(query: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query.trim())}`;
}

/** Short language hint appended to a query ("in Hindi", "Hinglish"). */
export function languageHint(code: string): string {
  const lang = LANGUAGES.find((l) => l.code === code);
  if (!lang || lang.code === "en") return "";
  if (lang.code === "hinglish") return "Hinglish";
  if (lang.queryHint) return lang.queryHint;
  return `in ${lang.label}`;
}

export interface SearchLinksInput {
  topic: Topic;
  subject: string;
  /** Language code from the form (en / hi / hinglish / …). */
  language: string;
  /** How many distinct links the student asked for (2-4). */
  limit: number;
  /** Real past questions on this topic — useful wording for a query. */
  examQuestions?: string[];
  /** True when the student already studied this topic. */
  skipped?: boolean;
}

/**
 * The YouTube Data API query used to discover REAL videos for ONE topic
 * (posted to /api/videos, which returns actual metadata — this is a query
 * string, never a link).
 *
 * Built from the topic's own syllabus wording — title, its strongest
 * keywords, the course and a language hint — so the search matches the
 * SYLLABUS TOPIC rather than a broad subject term. "full lecture" prefers
 * the detailed, single-sitting videos the brief asks for.
 */
export function topicVideoQuery(
  topic: Topic,
  subject: string,
  language: string,
): string {
  const hint = languageHint(language);
  const keywords = topic.keywords.slice(0, 2).join(" ");
  const join = (...parts: Array<string | undefined>) =>
    parts.filter((p) => p && p.trim()).map((p) => p!.trim()).join(" ");
  return join(topic.title, keywords, subject, hint, "full lecture")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/** Builds the honest per-topic YouTube search suggestions. */
export function buildSearchLinks(input: SearchLinksInput): TopicResult {
  const { topic, subject, language, limit } = input;
  const hint = languageHint(language);
  const join = (...parts: Array<string | undefined>) =>
    parts.filter((p) => p && p.trim()).map((p) => p!.trim()).join(" ");

  const candidates: Array<{ label: string; query: string }> = [
    { label: "Topic", query: join(topic.title, subject, hint, "tutorial") },
    topic.chapter
      ? { label: "Unit", query: join(topic.chapter, topic.title, hint) }
      : { label: "Topic", query: join(topic.title, hint, "full chapter") },
    topic.keywords.length > 0
      ? { label: "Keywords", query: join(topic.keywords.slice(0, 4).join(" "), hint) }
      : { label: "Topic", query: join(topic.title, hint, "explained") },
  ];

  const firstExam = input.examQuestions?.[0];
  if (firstExam) {
    const words = firstExam.replace(/\s+/g, " ").split(" ").slice(0, 10).join(" ");
    candidates.push({ label: "Past paper", query: join(words, subject, hint) });
  }

  const seen = new Set<string>();
  const searches: VideoSearch[] = [];
  const queries: string[] = [];

  for (const candidate of candidates) {
    if (searches.length >= Math.max(1, Math.min(4, limit))) break;
    const query = candidate.query.replace(/\s+/g, " ").trim();
    if (query.length < 4) continue;
    const key = query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    queries.push(query);
    searches.push({ label: candidate.label, query, url: youtubeSearchUrl(query) });
  }

  return {
    topic,
    searches,
    queries,
    skipped: input.skipped,
  };
}
