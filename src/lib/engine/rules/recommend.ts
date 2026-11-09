import { languageHint, youtubeSearchUrl } from "./search";
import type {
  RecommendationKind,
  RecommendationMode,
  RecommendationPlan,
  SmartPriority,
  SmartPriorityResult,
  Topic,
  VideoRecommendation,
} from "@/lib/types";

/**
 * Video recommendations = the QUERIES behind each playlist card, optimised
 * for minimum lectures covering maximum syllabus.
 *
 * What this module does NOT do: call YouTube, fetch video metadata, or
 * invent a title/channel/thumbnail/duration/views/URL of any real video.
 * It builds a search query from the student's own syllabus wording and
 * states which topics that search is intended to cover. The server route
 * (/api/videos) resolves that query into REAL YouTube videos and estimates
 * syllabus coverage from their title + description — an estimate the UI
 * labels as one. When the API cannot answer, the card falls back to this
 * module's honest search link.
 *
 * The optimisation is deterministic and greedy:
 *   - topics inside ONE unit are grouped so a single comprehensive lecture
 *     search covers all of them (instead of one search per topic);
 *   - smart mode groups by (priority class × unit), so one lecture search
 *     serves several same-priority topics of the same unit;
 *   - identical queries are merged — the same suggestion is never repeated;
 *   - studied topics and topics with no searchable words are excluded and
 *     reported, so nothing is silently dropped and nothing is faked.
 */

export interface BuildRecommendationsInput {
  mode: RecommendationMode;
  /** Every syllabus topic, in syllabus order. */
  topics: Topic[];
  /** Phase 4 priority — the smart mode's source of truth. */
  priority: SmartPriorityResult;
  /** Course/subject name from the syllabus analysis. */
  subject: string;
  /** Video-search language code from Settings (en / hi / hinglish / …). */
  language: string;
  /** Study-progress ticks — studied topics need no lecture. */
  isStudied?: (title: string) => boolean;
}

/** Priority class → display order in the smart playlist. */
const PRIORITY_ORDER: SmartPriority[] = ["high", "medium", "low", "unobserved"];

/** Search words that steer toward ONE comprehensive lecture, not clips. */
const FOCUS: Record<SmartPriority, string> = {
  high: "most repeated exam topics full lecture",
  medium: "important exam topics full lecture",
  low: "quick revision full lecture",
  unobserved: "complete syllabus full lecture",
};

/** A topic title must contain a real word before any search can be built. */
function hasLetters(text: string): boolean {
  return /\p{L}/u.test(text);
}

function join(...parts: Array<string | undefined>): string {
  return parts
    .filter((part): part is string => Boolean(part && part.trim()))
    .map((part) => part.trim())
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** URL-safe, stable fragment for ids ("Unit-III: Calculus" → "unit-iii-calculus"). */
function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "general"
  );
}

interface Group {
  unit: string;
  topics: Topic[];
  priority?: SmartPriority;
}

/**
 * Fingerprint of every input the plan is derived from. Two plans with the
 * same signature are byte-identical, so a cached plan can be reused safely.
 */
export function recommendationSignature(input: BuildRecommendationsInput): string {
  const priorityPart = input.priority.hasPapers
    ? input.priority.topics.map((row) => `${row.topicId}:${row.priority}`).join(",")
    : "none";
  const studiedPart = input.topics
    .filter((topic) => input.isStudied?.(topic.title))
    .map((topic) => topic.id)
    .join(",");
  return [
    input.mode,
    input.subject,
    input.language,
    priorityPart,
    studiedPart,
    input.topics.map((topic) => `${topic.id}:${topic.title}:${topic.chapter ?? ""}`).join("|"),
  ].join("###");
}

/** Contiguous groups in syllabus order — one group = one lecture search. */
function groupByUnit(topics: Topic[]): Group[] {
  const groups: Group[] = [];
  for (const topic of topics) {
    const unit = topic.chapter?.trim() || "General";
    const current = groups[groups.length - 1];
    if (current && current.unit === unit) current.topics.push(topic);
    else groups.push({ unit, topics: [topic] });
  }
  return groups;
}

/** Smart order: High → Medium → Low → not-observed, syllabus order inside. */
function groupByPriorityThenUnit(topics: Topic[], priority: SmartPriorityResult): Group[] {
  const classOf = new Map<string, SmartPriority>();
  for (const row of priority.topics) classOf.set(row.topicId, row.priority);

  const order = new Map<string, number>();
  PRIORITY_ORDER.forEach((label, index) => order.set(label, index));

  const sorted = topics
    .map((topic, index) => ({
      topic,
      index,
      // A topic the plan never labelled is honestly treated as unobserved.
      cls: classOf.get(topic.id) ?? ("unobserved" as SmartPriority),
    }))
    .sort((a, b) => {
      const byClass = (order.get(a.cls) ?? 99) - (order.get(b.cls) ?? 99);
      return byClass !== 0 ? byClass : a.index - b.index;
    });

  const groups: Group[] = [];
  for (const item of sorted) {
    const unit = item.topic.chapter?.trim() || "General";
    const current = groups[groups.length - 1];
    if (current && current.unit === unit && current.priority === item.cls) {
      current.topics.push(item.topic);
    } else {
      groups.push({ unit, topics: [item.topic], priority: item.cls });
    }
  }
  return groups;
}

function queryFor(
  mode: RecommendationMode,
  group: Group,
  subject: string,
  hint: string,
): string {
  const single = group.topics.length === 1;
  const base = single ? group.topics[0].title : group.unit;

  if (mode === "smart" && group.priority) {
    // Single topic → its own words; several → the unit they share.
    return join(base, subject, hint, FOCUS[group.priority]);
  }
  return single
    ? join(base, subject, hint, "full lecture")
    : join(base, subject, hint, "full chapter lecture");
}

function kindFor(group: Group): RecommendationKind {
  return group.topics.length >= 2 ? "unit" : "topic";
}

export function buildRecommendations(input: BuildRecommendationsInput): RecommendationPlan {
  const { topics, priority, subject, language, mode } = input;
  const hint = languageHint(language);

  const notes: string[] = [
    "Har card ki search se YouTube API ke asli results aate hain — ranking relevance + views + duration + syllabus match se banti hai, aur coverage % title + description matching ka estimate hai. API available na ho toh wahi search suggestion fallback.",
  ];

  /* ---- bucket every topic honestly: studied / unsearchable / recommendable ---- */
  const studiedTopicIds: string[] = [];
  const noRec: RecommendationPlan["noRec"] = [];
  const recommendable: Topic[] = [];

  for (const topic of topics) {
    if (input.isStudied?.(topic.title)) {
      studiedTopicIds.push(topic.id);
      continue;
    }
    if (!hasLetters(topic.title)) {
      noRec.push({
        topicId: topic.id,
        reason:
          "Topic title me koi searchable word nahi hai — bina words ke honest search suggestion nahi banaya ja sakta.",
      });
      continue;
    }
    recommendable.push(topic);
  }

  /* ---- grouping: one comprehensive search per group ---- */
  const usePriority = mode === "smart" && priority.hasPapers;
  const groups = usePriority
    ? groupByPriorityThenUnit(recommendable, priority)
    : groupByUnit(recommendable);

  if (mode === "smart" && !priority.hasPapers) {
    notes.push(
      "Priority labels bina PYQ papers ke available nahi hain — ye list syllabus order me hai, koi High/Low label invent nahi kiya gaya.",
    );
  }
  if (mode === "smart" && priority.hasPapers) {
    notes.push(
      "High priority ke topics pehle, phir Medium, phir Low/not-observed — sab ek hi lecture search me group jab ek unit ke ho.",
    );
  }
  if (studiedTopicIds.length > 0) {
    notes.push(
      `${studiedTopicIds.length} topic already marked studied — unke liye lecture suggest nahi kiya gaya (study progress alag hai).`,
    );
  }
  /* ---- build, then merge duplicate queries (never repeat a suggestion) ---- */
  const recommendations: VideoRecommendation[] = [];
  const byQuery = new Map<string, VideoRecommendation>();
  const usedIds = new Set<string>();
  let merged = 0;

  for (const group of groups) {
    if (group.topics.length === 0) continue;
    const query = queryFor(mode, group, subject, hint);
    if (query.length < 4) {
      // Never drop a topic silently — say why no suggestion exists.
      for (const topic of group.topics) {
        noRec.push({
          topicId: topic.id,
          reason: "Search query banane ke liye wording bahut chhoti mili — koi suggestion nahi banaya gaya.",
        });
      }
      continue;
    }

    const key = query.toLowerCase();
    const existing = byQuery.get(key);
    if (existing) {
      // Same search twice = wasted video. Merge the coverage instead.
      for (const topic of group.topics) {
        if (!existing.topicIds.includes(topic.id)) existing.topicIds.push(topic.id);
      }
      merged += 1;
      continue;
    }

    const kind = kindFor(group);
    const baseId =
      mode === "smart" && group.priority
        ? `s-${group.priority}-${kind === "unit" ? `u-${slug(group.unit)}` : `t-${slug(group.topics[0].title)}`}`
        : kind === "unit"
          ? `c-u-${slug(group.unit)}`
          : `c-t-${slug(group.topics[0].title)}`;
    // Titles can collide after slugging — keep watched-keys unique anyway.
    let id = baseId;
    for (let n = 2; usedIds.has(id); n += 1) id = `${baseId}-${n}`;
    usedIds.add(id);

    const rec: VideoRecommendation = {
      id,
      kind,
      title:
        kind === "unit"
          ? `${mode === "smart" && group.priority ? "Priority" : "Unit"} lecture search — ${group.unit}`
          : `Lecture search — ${group.topics[0].title}`,
      label:
        kind === "unit"
          ? mode === "smart"
            ? "Priority lecture"
            : "Full unit lecture"
          : "Full lecture",
      query,
      url: youtubeSearchUrl(query),
      unit: group.unit,
      topicIds: group.topics.map((topic) => topic.id),
      priority: group.priority,
    };
    byQuery.set(key, rec);
    recommendations.push(rec);
  }

  if (merged > 0) {
    notes.push(
      `${merged} duplicate search suggestion merge ki gayi — ek hi query dobara recommend nahi ki gayi.`,
    );
  }
  if (noRec.length > 0) {
    notes.push(
      `${noRec.length} topic ke liye koi search suggestion nahi bana — unhe "No suitable recommendation" me alag se dikhaya gaya hai.`,
    );
  }
  if (recommendations.length > 0) {
    notes.push(
      `Minimum lectures goal: ${recommendations.length} search suggestion(s) me ${recommendations.reduce((sum, rec) => sum + rec.topicIds.length, 0)} topic cover — ek topic ke liye alag-alag video ki jagah unit-level comprehensive lectures prefer kiye gaye hain.`,
    );
  }

  return {
    ok: true,
    mode,
    recommendations,
    noRec,
    studiedTopicIds,
    notes,
    signature: recommendationSignature(input),
  };
}
