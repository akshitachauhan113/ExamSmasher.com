/**
 * Real-video ranking + syllabus coverage estimate (playlist suggestions).
 *
 * The YouTube Data API does the searching — in the server route, with a key
 * that never reaches the browser. This module holds the two deterministic,
 * honest steps that turn raw search results into "suggested videos":
 *
 *   1. SCORING  — relevance rank + views + duration fit + title overlap +
 *                 syllabus coverage, so the top rows are the lectures most
 *                 likely to be worth the student's time.
 *   2. COVERAGE — how many of the student's OWN syllabus topics a video's
 *                 title + description mention. This is an ESTIMATE: it reads
 *                 text, it does not watch the video, and the UI labels it
 *                 exactly that way.
 *
 * Nothing here invents metadata — every number derives from fields the
 * YouTube API actually returned.
 */

/** ISO-8601 duration ("PT1H23M45S") → seconds; 0 when unparseable. */
export function parseIsoDuration(iso: string): number {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso.trim());
  if (!match) return 0;
  const [, d, h, m, s] = match;
  return Number(d || 0) * 86400 + Number(h || 0) * 3600 + Number(m || 0) * 60 + Number(s || 0);
}

/**
 * Generic English + study words. These are too common to prove that a
 * video covers a topic — "definition" appears in half of YouTube; it must
 * never carry a coverage claim on its own.
 */
const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "these", "those", "from", "into", "than",
  "then", "also", "are", "was", "were", "been", "being", "have", "has", "had", "does",
  "did", "will", "would", "could", "should", "may", "might", "must", "about", "after",
  "before", "between", "under", "over", "without", "within", "across", "among", "each",
  "every", "both", "few", "more", "most", "other", "such", "only", "own", "same", "too",
  "very", "just", "because", "while", "when", "where", "which", "what", "how", "why",
  "who", "whom", "its", "our", "your", "their", "his", "her", "they", "them", "you",
  "we", "not", "but", "all", "any", "can", "one", "two", "per", "via", "using", "used",
  "use", "out", "get", "got", "let", "yet", "ever", "here", "there", "some", "onto",
  // study/syllabus boilerplate — too common to prove a topic match
  "definition", "definitions", "concept", "concepts", "principle", "principles",
  "property", "properties", "example", "examples", "problem", "problems",
  "question", "questions", "technique", "techniques", "method", "methods", "rule",
  "rules", "note", "notes", "basic", "basics", "introduction", "advanced", "beginner",
  "complete", "comprehensive", "detailed", "chapter", "chapters", "lecture", "lectures",
  "tutorial", "tutorials", "video", "videos", "class", "classes", "course", "study",
  "studying", "exam", "exams", "syllabus", "topic", "topics", "unit", "units",
  "review", "summary", "overview", "guide", "tips", "trick", "tricks", "important",
  "part", "series", "level", "levels", "explained", "explanation", "learn", "learning",
  "practice", "paper", "papers", "section", "solve", "solved", "solution", "solutions",
]);

/** Light plural normaliser — only needs to be CONSISTENT on both sides. */
function stem(word: string): string {
  if (word.endsWith("ices") && word.length > 4) return `${word.slice(0, -4)}ix`; // matrices → matrix
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`; // properties → property
  if (/(ses|xes|zes|ches|shes)$/.test(word)) return word.slice(0, -2); // classes → class
  if (word.endsWith("s") && word.length > 3 && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** Significant, stemmed, de-duplicated words of a text (order preserved). */
export function tokens(text: string): string[] {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9+#]+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue;
    out.add(stem(raw));
  }
  return [...out];
}

export interface SyllabusTopicInput {
  title: string;
  keywords: string[];
}

export interface CoverageEstimate {
  /** 0–100, rounded. */
  pct: number;
  /** Titles of the syllabus topics the video text matched (syllabus order). */
  matched: string[];
}

/**
 * How much of the student's syllabus a video's title + description mention.
 *
 * A topic counts as covered when at least 60 % (min 1) of its significant
 * words appear in the video text — strict enough that a stray word in a
 * description cannot claim a topic, loose enough for titles that rephrase.
 * Topics with no searchable word are never claimed.
 *
 * This is an ESTIMATE from text; the UI always labels it as one.
 */
export function coverageEstimate(
  videoText: string,
  topics: SyllabusTopicInput[],
): CoverageEstimate {
  if (topics.length === 0) return { pct: 0, matched: [] };
  const videoTokens = new Set(tokens(videoText));
  const matched: string[] = [];
  for (const topic of topics) {
    const topicTokens = tokens(`${topic.title} ${topic.keywords.join(" ")}`);
    if (topicTokens.length === 0) continue;
    const need = Math.max(1, Math.ceil(topicTokens.length * 0.6));
    let hit = 0;
    for (const token of topicTokens) if (videoTokens.has(token)) hit += 1;
    if (hit >= need) matched.push(topic.title);
  }
  return { pct: Math.round((matched.length / topics.length) * 100), matched };
}

export interface ScoreInput {
  /** 0-based position in YouTube's relevance order. */
  rank: number;
  /** How many candidates the search returned. */
  total: number;
  views: number;
  durationSec: number;
  titleTokens: string[];
  queryTokens: string[];
  coveragePct: number;
}

/**
 * Combined quality score, 0–100: YouTube's own relevance order first, then
 * how many people already found it, a lecture-shaped duration, how much of
 * the search wording sits in the title, and the syllabus coverage estimate.
 */
export function scoreCandidate(input: ScoreInput): number {
  const { rank, total, views, durationSec, titleTokens, queryTokens, coveragePct } = input;
  const rankScore = total > 0 ? (total - rank) / total : 0;
  const viewScore = Math.min(1, Math.log10(views + 1) / 7);
  const durationScore =
    durationSec >= 300 && durationSec <= 7200
      ? 1
      : durationSec >= 120 && durationSec < 300
        ? 0.6
        : durationSec > 7200 && durationSec <= 10800
          ? 0.8
          : durationSec > 10800 && durationSec <= 14400
            ? 0.5
            : 0.3;
  const overlap =
    queryTokens.length > 0
      ? queryTokens.filter((token) => titleTokens.includes(token)).length / queryTokens.length
      : 0;
  const coverage = Math.min(1, Math.max(0, coveragePct / 100));
  const score =
    0.3 * rankScore +
    0.2 * viewScore +
    0.15 * durationScore +
    0.2 * overlap +
    0.15 * coverage;
  return Math.round(score * 100);
}
