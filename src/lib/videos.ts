import { findLanguage, type LanguageOption } from "./languages";
import { generateJSON, getLlmConfig } from "./llm";
import { buildRankPrompt } from "./prompts";
import { mergeAiVerdicts, scoreCandidate, type AiVerdict } from "./scoring";
import type { ScoredVideo, Topic, TopicResult, VideoCandidate } from "./types";
import {
  assertQuotaAvailable,
  fetchTranscript,
  fetchVideoDetails,
  searchYouTube,
} from "./youtube";

export interface AnalyzeTopicOptions {
  /** Language code from the UI ("en", "hinglish", "hi", ...). */
  languageCode: string;
  subject: string;
  /** How many finished videos to return (1-10). */
  limit: number;
  /** Whether to run the AI ranking pass (needs an AI key). */
  useAi: boolean;
  /**
   * The video inside the recommended full-course playlist that teaches this
   * topic. When set, it is pulled into the candidate pool if missing and gets
   * a large boost, so following one consistent playlist stays possible.
   */
  courseVideoId?: string;
  /**
   * Real past questions that fall on this topic. They are woven into the
   * search queries so YouTube is asked the way the exam actually words things
   * ("derive Dijkstra's algorithm 8 marks"), not just the syllabus heading —
   * exam-worded videos teach the thing the student will be marked on.
   */
  examQuestions?: string[];
  /**
   * Total topics in this run. Query spend is split across them so a
   * 40-topic syllabus gives every topic one search instead of the first
   * 20 getting four each and the rest never being asked at all.
   */
  topicCount?: number;
}

/**
 * YouTube's daily quota is 10,000 units; one search costs 100. That is
 * ~70 searches a day (playlist lookup eats ~4 of them). Anything past that
 * is quota the student does not have, so spend it on breadth — cover every
 * topic once — before depth on any one topic.
 */
const TOTAL_SEARCH_BUDGET = 70;

function queryBudgetFor(topicCount: number): number {
  const share = Math.floor(TOTAL_SEARCH_BUDGET / Math.max(1, topicCount));
  return Math.max(1, Math.min(4, share));
}

const CACHE_TTL = 20 * 60 * 1000;
const MAX_CACHE_ENTRIES = 400;
const cache = new Map<string, { ts: number; value: TopicResult }>();

/**
 * Being part of a verified syllabus-covering playlist is strong evidence: the
 * same educator, in order, with the surrounding topics already taught. This
 * bonus is big enough to beat a slightly-better standalone video on merit,
 * because syllabus continuity is what the student actually asked for.
 */
const PLAYLIST_BONUS = 30;

/**
 * Builds the YouTube search queries for a topic.
 *
 * `examQuestions` (real past questions on this topic) get their own query in
 * the student's own exam wording. That matters: "Unit 3 — Graphs" and
 * "explain Kruskal's algorithm with 6 marks example" are the same topic but
 * surface different, exam-shaped videos.
 *
 * `budget` caps the fan-out. Each query is 100 quota units, so on a large
 * syllabus a 2-query-per-topic fan-out dies before the last topics are
 * searched at all — a single strong query beats four that never run.
 */
export function buildQueries(
  topic: Topic,
  subject: string,
  language: LanguageOption,
  examQuestions: string[] = [],
  budget: number = 4,
): string[] {
  const core = [topic.title, ...topic.keywords.slice(0, 3)].filter(Boolean).join(" ").trim();
  const subjectSuffix = subject ? ` ${subject}` : "";

  const queries: string[] = [];
  const push = (q: string) => {
    const clean = q.trim().replace(/\s+/g, " ");
    if (clean.length < 4 || queries.length >= budget) return;
    if (queries.some((existing) => existing.toLowerCase() === clean.toLowerCase())) return;
    queries.push(clean);
  };

  push(
    `${core}${subjectSuffix}${language.queryHint ? ` ${language.queryHint}` : ""}`.trim(),
  );

  // Exam wording first among the extras — it is the most specific signal.
  const examQuery = examQuestions[0]?.slice(0, 110);
  if (examQuery) push(`${examQuery}${subjectSuffix}`);

  // A differently shaped query buys recall: shorter title + "tutorial".
  const shortTitle = topic.title.split(/[:\-–—(]/)[0].trim();
  push(`${shortTitle} tutorial explained${subjectSuffix}`.trim());
  push(`${shortTitle} explained${subjectSuffix}`.trim());

  return queries;
}

/** Runs the full pipeline for ONE topic: search -> details -> transcript -> AI rank. */
export async function analyzeTopic(
  topic: Topic,
  options: AnalyzeTopicOptions,
): Promise<TopicResult> {
  const language = findLanguage(options.languageCode);
  const limit = Math.min(10, Math.max(1, options.limit));
  const examFingerprint = (options.examQuestions?.[0] ?? "").slice(0, 60).toLowerCase();
  const cacheKey = [
    topic.title,
    options.languageCode,
    limit,
    options.useAi ? "ai" : "noai",
    options.courseVideoId ?? "-",
    examFingerprint,
  ].join("|");

  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < CACHE_TTL) {
    cache.delete(cacheKey);
    cache.set(cacheKey, hit); // LRU-ish refresh
    return hit.value;
  }

  const budget = queryBudgetFor(options.topicCount ?? 1);
  const queries = buildQueries(topic, options.subject, language, options.examQuestions, budget);

  try {
    const result = await runPipeline(topic, options, language, queries, limit, budget);
    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
    cache.set(cacheKey, { ts: Date.now(), value: result });
    return result;
  } catch (err) {
    return {
      topic,
      videos: [],
      candidatesConsidered: 0,
      queries,
      error:
        err instanceof Error
          ? err.message
          : "Something went wrong while searching videos.",
    };
  }
}

async function runPipeline(
  topic: Topic,
  options: AnalyzeTopicOptions,
  language: LanguageOption,
  queries: string[],
  limit: number,
  budget: number,
): Promise<TopicResult> {
  // Fail fast when the daily quota is already gone. Every remaining topic
  // then returns the same clear message instead of burning a 100-unit search
  // to discover what we already know — and the UI can name what was missed.
  assertQuotaAvailable();

  // 1. Search with every query variation (parallel, small fan-out).
  const allQueries = [...queries];
  const ids = await searchIds(queries, language);

  // 1b. Thin results? Broaden with plain title queries — but only inside the
  //     budget, so the LAST topics still get their one guaranteed search.
  if (ids.length < limit * 3 && allQueries.length < budget) {
    const shortTitle = topic.title.split(/[:\-–—(]/)[0].trim();
    const room = budget - allQueries.length;
    const broad = [topic.title, `${shortTitle} explained`, `${shortTitle} full tutorial`]
      .map((q) => q.trim())
      .filter(
        (q) =>
          q.length > 3 &&
          !allQueries.some((existing) => existing.toLowerCase() === q.toLowerCase()),
      )
      .slice(0, room);

    if (broad.length > 0) {
      const extra = await searchIds(broad, language);
      const before = new Set(ids);
      for (const id of extra) if (!before.has(id)) ids.push(id);
      allQueries.push(...broad);
    }
  }

  if (ids.length === 0 && !options.courseVideoId) {
    return { topic, videos: [], candidatesConsidered: 0, queries: allQueries };
  }

  // 2. Pull real statistics + duration + captions flag.
  //    The playlist pick is always fetched too, even when search found nothing —
  //    a verified syllabus match beats an empty panel. videos.list takes up to
  //    50 ids and costs 1 unit, so asking for the full set is nearly free and
  //    is what makes a high "videos per topic" selection actually satisfiable.
  const detailIds = options.courseVideoId
    ? [...new Set([options.courseVideoId, ...ids])].slice(0, 50)
    : ids.slice(0, 50);

  const details = await fetchVideoDetails(detailIds);
  const usable = details
    .filter((v) => v.id && v.durationSeconds >= 60 && v.title !== "(untitled video)")
    .filter((v) => !/\b(shorts?|yt:shorts)\b/i.test(v.title));

  if (usable.length === 0) {
    return { topic, videos: [], candidatesConsidered: 0, queries: allQueries };
  }

  // 3. Cheap metadata pass, so we only download transcripts for the plausible winners.
  //    The playlist video always survives the cut.
  const prelim = usable
    .map((v) => scoreCandidate(topic, v, null))
    .sort((a, b) => b.heuristicScore - a.heuristicScore);

  // With up to 10 videos requested, a 12-deep shortlist meant the top 10 were
  // almost no contest — raising it to 20 gives the ranking pass real
  // competition, which is where the extra videos per topic come from.
  const shortlist = prelim.slice(0, 20);
  if (options.courseVideoId && !shortlist.some((e) => e.video.id === options.courseVideoId)) {
    const fromPlaylist = prelim.find((e) => e.video.id === options.courseVideoId);
    if (fromPlaylist) shortlist.push(fromPlaylist);
  }
  const transcripts = await fetchTranscriptsFor(shortlist, language.yt);

  // 4. Re-score with transcript evidence where we managed to download captions.
  const rescored = shortlist.map((entry) => {
    const transcript = transcripts.get(entry.video.id);
    return scoreCandidate(topic, entry.video, transcript ?? null);
  });

  // 5. AI reading pass: the model ranks the shortlist using titles + transcripts.
  let finalList: ScoredVideo[] = rescored.sort(
    (a, b) => b.heuristicScore - a.heuristicScore,
  );
  let aiUsed = false;

  if (options.useAi && getLlmConfig()) {
    try {
      const verdicts = await rankWithAi(topic, options.subject, language, rescored, transcripts);
      finalList = mergeAiVerdicts(finalList, verdicts);
      aiUsed = true;
    } catch {
      // Non-fatal: deterministic ranking already produced a usable list.
      finalList = finalList
        .sort((a, b) => b.score - a.score)
        .map((s, i) => ({ ...s, rank: i + 1 }));
    }
  } else {
    finalList = finalList.map((s, i) => ({ ...s, rank: i + 1 }));
  }

  // 6. Course-playlist boost — applied AFTER AI ranking so it can override a
  //    marginally higher-scoring stray video with the syllabus-continuity pick.
  if (options.courseVideoId) {
    finalList = applyPlaylistBoost(finalList, options.courseVideoId);
  }

  return {
    topic,
    videos: finalList.slice(0, limit),
    candidatesConsidered: usable.length,
    queries: allQueries,
    aiUsed,
  };
}

/**
 * Flags the playlist video and lifts its score so it leads the panel.
 * The floor matters: a playlist pick sitting at #1 with a score of 40 would
 * look broken, so it is raised to a level that justifies the position. The cap
 * keeps an obviously poor video from claiming a perfect score.
 */
function applyPlaylistBoost(list: ScoredVideo[], courseVideoId: string): ScoredVideo[] {
  return list
    .map((entry) => {
      if (entry.video.id !== courseVideoId) return entry;

      return {
        ...entry,
        inCoursePlaylist: true,
        score: Math.min(100, Math.max(entry.score + PLAYLIST_BONUS, 76)),
        reasons: ["📘 Complete-course playlist · same educator, in order", ...entry.reasons].slice(
          0,
          6,
        ),
      };
    })
    .sort((a, b) => {
      // Playlist picks lead; inside each group the normal score decides.
      if (a.inCoursePlaylist !== b.inCoursePlaylist) return a.inCoursePlaylist ? -1 : 1;
      return b.score - a.score;
    })
    .map((s, index) => ({ ...s, rank: index + 1 }));
}

/** Runs the search fan-out and flattens the results into unique video ids. */
async function searchIds(queries: string[], language: LanguageOption): Promise<string[]> {
  const idLists = await mapWithConcurrency(queries, 2, (query) =>
    searchYouTube({
      query,
      languageCode: language.yt,
      maxResults: 25,
      duration: "any",
    }),
  );

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const list of idLists) {
    for (const id of list) {
      if (id && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }
  return ids;
}

async function fetchTranscriptsFor(
  entries: ScoredVideo[],
  languageCode: string,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  // Only the most promising candidates are worth a caption download.
  const withCaptions = entries.filter((e) => e.video.hasCaptions).slice(0, 8);

  await mapWithConcurrency(withCaptions, 3, async (entry) => {
    const result = await fetchTranscript(entry.video.id, languageCode, 7000);
    if (result?.text) out.set(entry.video.id, result.text);
  });

  return out;
}

async function rankWithAi(
  topic: Topic,
  subject: string,
  language: LanguageOption,
  candidates: ScoredVideo[],
  transcripts: Map<string, string>,
): Promise<AiVerdict[]> {
  const payload: Array<
    VideoCandidate & { heuristicScore: number; transcript?: string | null }
  > = candidates.map((entry) => ({
    ...entry.video,
    description: entry.video.description.slice(0, 600),
    heuristicScore: entry.heuristicScore,
    transcript: transcripts.get(entry.video.id) ?? null,
  }));

  const { system, prompt } = buildRankPrompt({
    topic,
    subject,
    languageLabel: language.label,
    languageHint: language.rankingHint ?? "",
    candidates: payload,
  });

  const parsed = await generateJSON<{ videos?: AiVerdict[] }>(prompt, {
    system,
    temperature: 0.1,
    // 20 candidates with a "why" line each needs more room than the old
    // 12-deep shortlist did — otherwise the verdict list gets cut off mid-rank.
    maxOutputTokens: 4096,
  });

  return (parsed.videos ?? []).filter((v) => typeof v?.id === "string");
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        const item = items[index] as T;
        results[index] = await fn(item, index);
      }
    },
  );

  await Promise.all(workers);
  return results;
}
