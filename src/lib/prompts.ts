import type { Topic, VideoCandidate } from "./types";

export interface AnalyzeInput {
  syllabus: string;
  subject?: string;
  languageLabel: string;
  maxTopics: number;
}

export function buildAnalyzePrompt(input: AnalyzeInput): {
  system: string;
  prompt: string;
} {
  const system = `You are an expert curriculum analyst and study coach who has taught for 20+ years.
You break syllabi into crisp, individually searchable study topics.
You ALWAYS reply with one valid JSON object and nothing else - no markdown, no commentary.`;

  const prompt = `A student submitted the syllabus below. Break it into distinct study topics that can each be matched to ONE great explainer video.

SYLLABUS:
"""
${input.syllabus}
"""
${input.subject ? `\nDeclared subject/course: ${input.subject}` : ""}

RULES:
1. Produce at most ${input.maxTopics} topics. If the syllabus is huge, merge tiny sub-points into sensible bigger topics instead of listing hundreds of fragments.
2. Order them the way a student should study them (foundations first).
3. Each topic must be self-contained and specific - avoid vague titles like "Chapter 2".
4. "keywords" are the exact words a student would type into YouTube to learn this topic (4-8 keywords). Include technical terms, formulas, theorem names, and common abbreviations.
5. importance: "core" = will definitely be examined, "important" = frequently asked, "bonus" = extra edge.
6. difficulty: beginner | intermediate | advanced.
7. estimatedMinutes: realistic minutes to watch a good video on this topic.
8. chapter: group label if the syllabus has chapters/units, otherwise a short unit name you invent.

Return EXACTLY this JSON shape:
{
  "subject": "short name of the course/subject",
  "topics": [
    {
      "title": "Topic title",
      "description": "1-2 sentence description of what a student must learn here",
      "keywords": ["keyword one", "keyword two"],
      "importance": "core",
      "difficulty": "intermediate",
      "estimatedMinutes": 25,
      "chapter": "Unit 1"
    }
  ]
}`;

  return { system, prompt };
}

export interface RankInput {
  topic: Topic;
  subject: string;
  languageLabel: string;
  languageHint: string;
  candidates: Array<
    VideoCandidate & { heuristicScore: number; transcript?: string | null }
  >;
}

export function buildRankPrompt(input: RankInput): { system: string; prompt: string } {
  const rows = input.candidates
    .map((c, i) => {
      const transcript = c.transcript
        ? `\n      transcript_excerpt: ${JSON.stringify(c.transcript.slice(0, 900))}`
        : "";
      return `${i + 1}. id=${c.id}
      title: ${JSON.stringify(c.title)}
      channel: ${JSON.stringify(c.channelTitle)}
      duration_sec: ${c.durationSeconds}
      views: ${c.viewCount}
      likes: ${c.likeCount}
      has_captions: ${c.hasCaptions}
      description_excerpt: ${JSON.stringify((c.description || "").slice(0, 320))}${transcript}`;
    })
    .join("\n");

  const system = `You are a ruthless study coach who curates the single best YouTube explainer for each syllabus topic.
You judge ONLY from the metadata and transcript excerpts given - never invent videos.
You ALWAYS reply with one valid JSON object and nothing else.`;

  const prompt = `COURSE: ${input.subject}
TARGET TOPIC: "${input.topic.title}"
WHAT THE STUDENT MUST LEARN: ${input.topic.description}
SEARCH KEYWORDS: ${input.topic.keywords.join(", ")}
VIDEO LANGUAGE REQUIRED: ${input.languageLabel}. ${input.languageHint}

CANDIDATE VIDEOS:
${rows}

SCORE EACH CANDIDATE FROM 0-100 for this exact topic:
- 90-100: the video is squarely about this topic, taught clearly, right depth.
- 70-89: covers the topic well, minor extras or slight depth mismatch.
- 40-69: only partially covers the topic, or is a broad lecture where this is one small part.
- 0-39: wrong topic, clickbait, a full-course dump, reaction/short-form filler, or wrong language.

PENALISE: videos whose title/description show they are a full course rather than this topic, clickbait ("OMG", "only 1% can solve"), low-effort shorts, live streams, and videos NOT in the required language.
REWARD: precise topic coverage, clear structured teaching, and captions/transcript that literally mention the topic's keywords.

Return EXACTLY this JSON shape, including EVERY candidate id exactly once:
{
  "videos": [
    { "id": "VIDEO_ID", "score": 92, "summary": "One sentence: what this video actually teaches about this topic.", "reasons": ["short reason 1", "short reason 2"] }
  ]
}`;

  return { system, prompt };
}

export interface PlanInput {
  subject: string;
  topics: Array<{ title: string; minutes: number; importance: string }>;
  picks: Array<{ title: string; videoTitle: string; videoUrl: string; seconds: number }>;
  totalDays: number;
}

export function buildPlanPrompt(input: PlanInput): { system: string; prompt: string } {
  const topicLines = input.topics
    .map((t, i) => `${i + 1}. ${t.title} (~${t.minutes} min, ${t.importance})`)
    .join("\n");
  const pickLines = input.picks
    .map(
      (p, i) =>
        `${i + 1}. ${p.title} -> "${p.videoTitle}" (${Math.round(p.seconds / 60)} min) ${p.videoUrl}`,
    )
    .join("\n");

  const system = `You are an experienced exam mentor who builds realistic, motivating study plans.
You reply in clean GitHub-flavoured Markdown only - no preamble, no JSON.`;

  const prompt = `Create a ${input.totalDays}-day study plan for the course "${input.subject}".

TOPICS IN STUDY ORDER:
${topicLines}

SHORTLISTED VIDEOS (one best video per topic):
${pickLines}

FORMAT (Markdown):
# 📅 ${input.totalDays}-Day Study Plan — ${input.subject}
**Total video time:** Xh Ym  |  **Daily load:** ~Z min

Then a day-by-day table with columns: Day | Topics | Videos (link each title with its URL using [title](url)) | Est. time | Checklist.
End with a short "Strategy tips" section (5 bullets, exam-focused).
Keep it practical - never schedule more than 60 minutes of video per day; tell the student to pause and practise.`;

  return { system, prompt };
}

/** Small helper the API uses when the AI is unavailable but we still need a subject name. */
export function guessSubject(syllabus: string): string {
  const firstLine =
    syllabus
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.length > 2) ?? "Your syllabus";
  return firstLine.replace(/[:\-–—]+$/, "").slice(0, 60) || "Your syllabus";
}
