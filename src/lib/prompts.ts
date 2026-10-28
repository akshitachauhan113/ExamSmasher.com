import type { Topic, VideoCandidate } from "./types";

export interface AnalyzeInput {
  syllabus: string;
  subject?: string;
  languageLabel: string;
  maxTopics: number;
  /** Lower bound for the topic count (defaults to ~70% of maxTopics). */
  minTopics?: number;
}

export function buildAnalyzePrompt(input: AnalyzeInput): {
  system: string;
  prompt: string;
} {
  const system = `You are an expert curriculum analyst and study coach who has taught for 20+ years.
You break syllabi into crisp, individually searchable study topics.
You ALWAYS reply with one valid JSON object and nothing else - no markdown, no commentary.`;

  const minTopics = Math.max(3, Math.round(input.minTopics ?? input.maxTopics * 0.7));

  const prompt = `A student submitted the syllabus below. Break it into distinct study topics that can each be matched to ONE great explainer video.

SYLLABUS:
"""
${input.syllabus}
"""
${input.subject ? `\nDeclared subject/course: ${input.subject}` : ""}

RULES:
1. Produce between ${minTopics} and ${input.maxTopics} topics — aim for the upper end whenever the syllabus has many units. EVERY unit/chapter/module in the syllabus must map to at least one topic: a large syllabus produces many topics, never a handful of giant catch-all ones. Only merge genuinely tiny sub-points (two one-liners that belong together); never merge whole units.
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
You ALWAYS reply with one valid JSON object and nothing else - no markdown fences, no commentary.`;

  const prompt = `Create a ${input.totalDays}-day study plan for the course "${input.subject}".

TOPICS IN STUDY ORDER:
${topicLines}

SHORTLISTED VIDEOS (one best video per topic):
${pickLines}

RULES:
1. Distribute the videos across exactly ${input.totalDays} days, foundations first.
2. Never schedule more than 60 minutes of video per day; add a short "pause and practise" note where useful.
3. Put a revision / practice-only day near the end.
4. "videoUrl" must be copied EXACTLY from the shortlist above. Only include videoUrl/videoTitle for items that are videos.
5. "minutes" = realistic minutes for that one item (rounded to 5).
6. "focus" = max 12 words for the day's headline.
7. Final day and the day before it should focus on revision and past-paper practice.

Return EXACTLY this JSON shape:
{
  "days": [
    {
      "day": 1,
      "focus": "One-line headline for the day",
      "items": [
        { "title": "What the student does", "minutes": 15, "type": "video", "videoTitle": "Video title", "videoUrl": "https://www.youtube.com/watch?v=..." },
        { "title": "Pause and practise: solve 5 problems", "minutes": 20, "type": "practice" }
      ]
    }
  ],
  "tips": ["short exam-focused tip", "another tip"]
}`;

  return { system, prompt };
}

/* ------------------------------ notes + cards ------------------------------ */

export interface NotesInput {
  topic: {
    title: string;
    description?: string;
    chapter?: string;
    importance?: string;
    difficulty?: string;
    keywords?: string[];
  };
  subject?: string;
  /** Optional syllabus excerpt so the notes stay inside the course scope. */
  syllabus?: string;
}

export function buildNotesPrompt(input: NotesInput): { system: string; prompt: string } {
  const system = `You are a senior teacher writing concise, exam-ready study material.
You ALWAYS reply with one valid JSON object and nothing else - no markdown, no commentary.`;

  const prompt = `Write study notes + flashcards for ONE topic from a student's syllabus.

SUBJECT: ${input.subject || "Not specified"}
TOPIC: ${input.topic.title}
${input.topic.description ? `WHAT THE SYLLABUS ASKS: ${input.topic.description}` : ""}
${input.topic.chapter ? `CHAPTER/UNIT: ${input.topic.chapter}` : ""}
IMPORTANCE: ${input.topic.importance || "important"} · EXPECTED LEVEL: ${input.topic.difficulty || "intermediate"}
${input.topic.keywords?.length ? `KEY TERMS: ${input.topic.keywords.join(", ")}` : ""}
${
  input.syllabus
    ? `\nSYLLABUS EXCERPT (keep notes inside this scope):\n"""\n${input.syllabus.slice(0, 2500)}\n"""`
    : ""
}

RULES:
1. "notes" = 2 to 4 sections. Each has a short "heading" and 4-7 "bullets".
2. Bullets must be SHORT (max ~18 words) but information-dense: definitions, formulas, key steps, dates, exceptions, common mistakes, exam tips.
3. Write for a student who is revising: plain language, no filler, no "in this section we will...".
4. "cards" = 6 to 10 flashcards. "q" is a crisp question (definition, formula recall, difference-between, "why"), "a" is the answer in max 25 words.
5. Use the student's language only for your own wording style; keep technical terms and formulas exactly as the syllabus uses them.

Return EXACTLY this JSON shape:
{
  "notes": [
    { "heading": "Section heading", "bullets": ["short dense point", "another point"] }
  ],
  "cards": [
    { "q": "Question?", "a": "Short answer" }
  ]
}`;

  return { system, prompt };
}

/* ------------------------------ video summary ------------------------------ */

export interface SummaryInput {
  topicTitle: string;
  videoTitle: string;
  videoDescription?: string;
  /** Transcript excerpt when captions could be downloaded (best case). */
  transcript?: string;
}

export function buildSummaryPrompt(input: SummaryInput): { system: string; prompt: string } {
  const system = `You summarise YouTube explainer videos for students who have not watched them yet.
You ALWAYS reply with one valid JSON object and nothing else - no markdown, no commentary.`;

  const prompt = `Summarise this video for a student studying: "${input.topicTitle}".

VIDEO TITLE: ${input.videoTitle}
${input.videoDescription ? `VIDEO DESCRIPTION: ${input.videoDescription.slice(0, 600)}` : ""}
${
  input.transcript
    ? `TRANSCRIPT EXCERPT (authoritative - base the summary on this):\n"""\n${input.transcript.slice(0, 7000)}\n"""`
    : `No transcript is available. Infer coverage from the title/description only and keep claims safe and general.`
}

RULES:
1. "bullets" = 5 to 8 points, in the order the video teaches them, each max ~20 words.
2. Say what is actually taught: definitions, formulas, worked examples, exam tips.
3. "fit" = one short line: is this video a good match for the topic and who it suits (beginner / exam revision / advanced).
4. "level": "beginner" | "intermediate" | "advanced".
5. No invented timestamps, no view counts, no channel praise.

Return EXACTLY this JSON shape:
{
  "bullets": ["point one", "point two"],
  "fit": "Good match for first-time learners - covers X and Y with examples.",
  "level": "intermediate"
}`;

  return { system, prompt };
}

/* --------------------------------- chat ---------------------------------- */

export interface ChatInput {
  message: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  subject?: string;
  topics?: Array<{ title: string; description?: string }>;
  syllabus?: string;
}

export function buildChatPrompt(input: ChatInput): { system: string; prompt: string } {
  const system = `You are ExamSmasher's study coach - a friendly, sharp exam mentor.

Rules:
- Mirror the student's language: if they write Hinglish, answer in Hinglish; if English, English; if Hindi, Hindi.
- Be short and practical. Use bullets or numbered steps when they help. No essays.
- Ground answers in their syllabus/topics below when the question is about them.
- Never invent YouTube links, dates, marks or syllabus content you were not given. If you do not know, say so plainly.
- For study strategy questions, give a concrete next action they can do in the next 30 minutes.`;

  const historyLines = input.history
    .slice(-10)
    .map((m) => `${m.role === "user" ? "STUDENT" : "COACH"}: ${m.content.slice(0, 600)}`)
    .join("\n");

  const prompt = `COURSE: ${input.subject || "Not specified"}
${input.topics?.length ? `TOPICS EXTRACTED FROM THEIR SYLLABUS:\n${input.topics.map((t, i) => `${i + 1}. ${t.title}${t.description ? ` - ${t.description}` : ""}`).join("\n")}` : ""}
${
  input.syllabus
    ? `\nSYLLABUS EXCERPT:\n"""\n${input.syllabus.slice(0, 3000)}\n"""`
    : ""
}
${historyLines ? `\nRECENT CONVERSATION:\n${historyLines}` : ""}

STUDENT'S LATEST MESSAGE:
"""
${input.message}
"""

Reply to the student now (not JSON, just your answer):`;

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
