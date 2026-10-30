import { findLanguage, type LanguageOption } from "./languages";
import { generateJSON, getLlmConfig } from "./llm";
import { buildRankPrompt } from "./prompts";
import { mergeAiVerdicts, scoreCandidate, type AiVerdict } from "./scoring";
import type { ScoredVideo, Topic, TopicResult, VideoCandidate } from "./types";
import { fetchTranscript, fetchVideoDetails, searchYouTube } from "./youtube";

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

export function buildQueries(topic: Topic, subject: string, language: LanguageOption): string[] {
  const core = [topic.title, ...topic.keywords.slice(0, 3)].filter(Boolean).join(" ").trim();
  const subjectSuffix = subject ? ` ${subject}` : "";

  const queries: string[] = [];
  const primary = `${core}${subjectSuffix}${language.queryHint ? ` ${language.queryHint}` : ""}`.trim();
  queries.push(primary);

  // A second, differently shaped query buys recall: shorter title + "tutorial".
  const shortTitle = topic.title.split(/[:\-–—(]/)[0].trim();
  const secondary = `${shortTitle} tutorial explained${subjectSuffix}`.trim();
  if (secondary.toLowerCase() !== primary.toLowerCase()) queries.push(secondary);

  return queries.slice(0, 2);
}

/** Runs the full pipeline for ONE topic: search -> details -> transcript -> AI rank. */
export async function analyzeTopic(
  topic: Topic,
  options: AnalyzeTopicOptions,
): Promise<TopicResult> {
  const language = findLanguage(options.languageCode);
  const limit = Math.min(10, Math.max(1, options.limit));
  const cacheKey = [
    topic.title,
    options.languageCode,
    limit,
    options.useAi ? "ai" : "noai",
    options.courseVideoId ?? "-",
  ].join("|");

  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < CACHE_TTL) {
    cache.delete(cacheKey);
    cache.set(cacheKey, hit); // LRU-ish refresh
    return hit.value;
  }

  const queries = buildQueries(topic, options.subject, language);

  try {
    const result = await runPipeline(topic, options, language, queries, limit);
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
): Promise<TopicResult> {
  // 1. Search with every query variation (parallel, small fan-out).
  const allQueries = [...queries];
  const ids = await searchIds(queries, language);

  // 1b. Thin results? Broaden once with plain title queries — a topic panel
  //     with zero videos is the worst outcome for the student.
  if (ids.length < limit * 3) {
    const shortTitle = topic.title.split(/[:\-–—(]/)[0].trim();
    const broad = [topic.title, `${shortTitle} explained`, `${shortTitle} full tutorial`]
      .map((q) => q.trim())
      .filter(
        (q) =>
          q.length > 3 &&
          !allQueries.some((existing) => existing.toLowerCase() === q.toLowerCase()),
      )
      .slice(0, 2);

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
  //    a verified syllabus match beats an empty panel.
  const detailIds = options.courseVideoId
    ? [...new Set([options.courseVideoId, ...ids])].slice(0, 40)
    : ids.slice(0, 40);

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

  const shortlist = prelim.slice(0, 12);
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
  const withCaptions = entries.filter((e) => e.video.hasCaptions).slice(0, 6);

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
    maxOutputTokens: 2048,
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
