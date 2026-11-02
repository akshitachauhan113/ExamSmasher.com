import type { NotesLang, Topic, VideoCandidate } from "./types";

/**
 * Shared rule for everything the AI writes that a student will READ: every
 * equation goes in LaTeX so the UI can typeset it notebook-style with KaTeX
 * instead of leaking raw `\frac{a}{b}` code into the page.
 */
const MATH_RULE = `EQUATIONS: write every formula, equation and expression in LaTeX — $...$ inside a line, $$...$$ on its own line for long derivations. Use real commands: \\frac{a}{b}, x^2, \\sqrt{x}, \\int_0^1 f(x)\\,dx, \\sum, \\theta. Never write bare pseudo-maths like a/b or (a^2+b^2) without the $ signs — the page typesets LaTeX.`;

/**
 * Study material comes in two flavours — the student picks before generating.
 * Hinglish means the *explanations* go Desi; the syllabus terms stay put.
 */
const LANGUAGE_RULE = (language?: NotesLang): string =>
  language === "hinglish"
    ? `LANGUAGE: easy HINGLISH — write explanations, headings, bullets and answers the way a friend would explain ("is concept me do parts hote hain, pehla wala..."). Keep every technical term, definition, law name and formula in standard English exactly as the syllabus uses them — only the sentence around it is Hinglish.`
    : `LANGUAGE: simple, clear English for everything — explanations, headings, bullets and answers. Technical terms stay exactly as the syllabus writes them.`;

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

/* ------------------------------ topic notes ------------------------------ */

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
  /** English or Hinglish — whatever the student picked on the notes panel. */
  language?: NotesLang;
}

/**
 * THREE levels of notes per topic — concept clarity, fast revision and active
 * recall — generated in one call so the student never waits three times.
 */
export function buildNotesPrompt(input: NotesInput): { system: string; prompt: string } {
  const system = `You are a senior teacher writing exam-ready study material in three levels of depth.
You ALWAYS reply with one valid JSON object and nothing else - no markdown, no commentary.`;

  const prompt = `Write THREE levels of study material for ONE topic from a student's syllabus.

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

${LANGUAGE_RULE(input.language)}

THE THREE LEVELS:
1. "detailed" = 3 to 5 sections. Each has a short "heading" and 2 to 3 "paragraphs".
   Paragraphs are 45-80 words of real teaching: what the idea means, why it matters, how it
   works step by step, with formulas / examples / exceptions worked in. This is what a student
   reads when they know NOTHING yet. Plain language, no filler, no "in this section we will".
2. "notes" = the same sections, but each bullet must be ONE SHORT LINE (max ~18 words),
   information-dense: definitions, formulas, key steps, dates, exceptions, exam tips.
   This is the 10-minute revision version. Do not just split the paragraphs mechanically —
   pick the highest-value facts.
3. "cards" = 8 to 14 flashcards. "q" is a crisp question (definition, formula recall,
   difference-between, "why"), "a" is the answer in max 25 words.

Keep technical terms and formulas exactly as the syllabus uses them.
${MATH_RULE}

Return EXACTLY this JSON shape:
{
  "detailed": [
    { "heading": "Section heading", "paragraphs": ["First explaining paragraph.", "Second paragraph."] }
  ],
  "notes": [
    { "heading": "Section heading", "bullets": ["short dense point", "another point"] }
  ],
  "cards": [
    { "q": "Question?", "a": "Short answer" }
  ]
}`;

  return { system, prompt };
}

/* --------------------------- whole-syllabus notes --------------------------- */

export interface FullNotesInput {
  subject: string;
  /** The slice of syllabus this call should cover. */
  section: string;
  /** 1-based, so a multi-section document reads as one continuous book. */
  sectionIndex: number;
  totalSections: number;
  /** Unit/chapter label if we could detect one for this slice. */
  sectionLabel?: string;
  /** English or Hinglish — same choice as the per-topic notes. */
  language?: NotesLang;
}

/**
 * One chapter-worth of long-form notes.
 *
 * Whole syllabi do not fit in one model response, so the route splits the
 * syllabus into slices and calls this per slice. Each slice is told its index
 * so headings continue rather than every section claiming to be "#1".
 * Output is Markdown, not JSON — this is a document to read, not data.
 */
export function buildFullNotesPrompt(input: FullNotesInput): {
  system: string;
  prompt: string;
} {
  const system = `You are a university professor writing complete, exam-ready course notes.
You teach properly: define, explain, work through, then say what the exam asks.
Reply in clean Markdown ONLY. No preamble, no "here are your notes", no code fences around the whole answer.`;

  const prompt = `Write detailed study notes for the section below of "${input.subject}".

${
  input.totalSections > 1
    ? `This is part ${input.sectionIndex} of ${input.totalSections}${
        input.sectionLabel ? ` — "${input.sectionLabel}"` : ""
      }. Start with a level-2 heading for this part only. Do not reference other parts.`
    : `Cover everything given.`
}

SYLLABUS FOR THIS SECTION:
"""
${input.section.slice(0, 11000)}
"""

WHAT TO PRODUCE:
- A level-2 heading, then every syllabus point taught in depth.
${LANGUAGE_RULE(input.language)}
- For each concept: what it means, WHY it exists, how it works step by step,
  then the formula/algorithm/procedure worked through concretely.
- ${MATH_RULE}
- Use level-3 headings to split concepts. Bullets for anything list-shaped
  (steps, types, comparisons, properties).
- Include a short worked example wherever a calculation or derivation is involved.
- Keep it inside the syllabus: do not add topics that are not asked for.
- Plain, direct teaching language. No "in this chapter we shall explore".
- If the syllabus mentions marks or weightage, say at the end which parts are
  most likely to be asked and why.

END EACH SECTION WITH:
### Exam corner
- 3 to 5 bullets: what is usually asked, common traps, what to memorise.`;

  return { system, prompt };
}

/* ------------------------------- exam mode -------------------------------- */

export interface ParsePapersInput {
  subject: string;
  papers: Array<{ id: string; year: string; label: string; text: string }>;
}

/**
 * Turns raw previous-year paper text into clean, structured questions.
 * The year/label is attached here so every question can be traced back to the
 * paper it really came from — nothing gets invented.
 */
export function buildParsePapersPrompt(
  input: ParsePapersInput,
): { system: string; prompt: string } {
  const blocks = input.papers
    .map(
      (p) =>
        `===== PAPER id=${p.id} · ${p.label} ${p.year} =====\n${p.text.slice(0, 9000)}`,
    )
    .join("\n\n");

  const system = `You are an exam paper reader. You extract questions from previous-year university
question papers EXACTLY as they are printed. You never invent, reword into a different question,
merge, or split questions. You ALWAYS reply with one valid JSON object and nothing else.`;

  const prompt = `Extract every question from the previous-year paper(s) below for the subject
"${input.subject || "Unknown subject"}".

${blocks}

RULES:
1. Copy each question's TEXT faithfully. Keep numbers, formulas, units, roman numerals and
   option letters. Fix only obvious OCR garbling (e.g. "lhe" -> "the"); never change meaning.
2. "number" = the printed question number, e.g. "Q4", "3(b)", "Q7 (a)".
3. "marks" = printed marks if present, otherwise null. Do NOT guess marks.
4. "section" = the printed section/unit grouping if the paper has one, else omit it.
5. "type": objective | short | long | numerical | proof | other. A 1-mark true/false or MCQ is
   objective. A 2-6 line explanation is short. A full essay/derivation is long. A calculation is
   numerical. A mathematical proof is proof.
6. Carry the paper's own id/label/year onto every question from that paper.
7. Skip administrative text: instructions, "Roll No.", "Time allowed", page headers/footers,
   "Attempt any five" style directions.
8. If a paper is unreadable or contains no questions, return an empty list for it — never guess.

Return EXACTLY this JSON shape:
{
  "questions": [
    {
      "paperId": "PAPER_ID",
      "number": "Q4",
      "section": "Section B",
      "marks": 6,
      "type": "long",
      "text": "Explain the working of ... with a neat diagram."
    }
  ]
}`;

  return { system, prompt };
}

export interface MapQuestionsInput {
  topics: Array<{ id: string; title: string; description?: string; keywords?: string[] }>;
  questions: Array<{ id: string; paperYear: string; text: string }>;
}

/**
 * Asks the model which syllabus topic each real past question belongs to.
 * Frequency is computed deterministically afterwards from these mappings, so
 * the "repeating" claim is always backed by an actual paper.
 */
export function buildMapQuestionsPrompt(
  input: MapQuestionsInput,
): { system: string; prompt: string } {
  const topicLines = input.topics
    .map(
      (t, i) =>
        `${i + 1}. id=${t.id} | ${t.title}${t.description ? ` — ${t.description}` : ""}`,
    )
    .join("\n");

  const questionLines = input.questions
    .map((q) => `id=${q.id} (${q.paperYear}) | ${q.text.slice(0, 300)}`)
    .join("\n");

  const system = `You are a university examiner who knows exactly which syllabus topic each past
question belongs to. You ALWAYS reply with one valid JSON object and nothing else.`;

  const prompt = `Map every past question below onto ONE syllabus topic.

SYLLABUS TOPICS:
${topicLines}

PAST QUESTIONS:
${questionLines}

RULES:
1. Each question maps to exactly ONE topic — the main one it tests.
2. Only use topic ids that appear above. Never invent an id.
3. If a question genuinely does not belong to any listed topic (it is out of syllabus), leave it
   out of your answer rather than forcing a bad fit.
4. Do not merge or reword questions.

Return EXACTLY this JSON shape:
{
  "maps": [ { "questionId": "Q_ID", "topicId": "TOPIC_ID" } ]
}`;

  return { system, prompt };
}

export interface ExpectedInput {
  subject: string;
  /** Real questions, grouped by how often that pattern showed up. */
  groups: Array<{
    topicTitle: string;
    trend: string;
    questions: Array<{ text: string; paperYear: string; marks?: number }>;
  }>;
}

/**
 * Builds "most expected this year" from REAL recurring patterns. It is framed
 * as a prediction extrapolated from actual papers, never as a leaked paper.
 */
export function buildExpectedPrompt(input: ExpectedInput): { system: string; prompt: string } {
  const groupLines = input.groups
    .map(
      (g, i) =>
        `${i + 1}. TOPIC: ${g.topicTitle} (trend: ${g.trend})\n` +
        g.questions
          .map((q) => `   - [${q.paperYear}${q.marks ? `, ${q.marks} marks` : ""}] ${q.text.slice(0, 260)}`)
          .join("\n"),
    )
    .join("\n");

  const system = `You are a university exam predictor. You build "most expected questions" by
extrapolating from a student's REAL previous-year papers — you never present anything as a leaked
or official paper. You ALWAYS reply with one valid JSON object and nothing else.`;

  const prompt = `A student has past papers for "${input.subject}". Below are the real questions
grouped by topic, with how reliable that topic's trend is. Write the questions most likely to
appear in the NEXT exam.

REAL PAST QUESTIONS BY TOPIC:
${groupLines}

RULES:
1. Every prediction must be grounded in a real pattern above. If a topic's questions repeat almost
   verbatim, predict that question as-is — do not invent a new angle.
2. Where a topic repeats with small variations, write ONE variant that follows the observed pattern.
3. Prioritise: repeating topics first, then important, then occasional. Do not include rare topics.
4. "basis" must name the real evidence, e.g. "asked in 2022, 2023 & 2024 — same wording".
5. Never claim certainty. These are predictions, not a leaked paper.
6. Keep "text" close to the original wording so revision transfers directly.

Return EXACTLY this JSON shape:
{
  "expected": [
    {
      "text": "Question text",
      "topicTitle": "Topic it belongs to",
      "marks": 6,
      "confidence": "high",
      "basis": "Evidence from the real papers"
    }
  ]
}`;

  return { system, prompt };
}

export interface QuizInput {
  subject: string;
  /** Topics to test, with their real past questions as the source of truth. */
  topics: Array<{
    id: string;
    title: string;
    pastQuestions: string[];
  }>;
  count: number;
}

/** Builds a quiz from real past questions so practice matches the actual exam. */
export function buildQuizPrompt(input: QuizInput): { system: string; prompt: string } {
  const topicLines = input.topics
    .map(
      (t) =>
        `### id=${t.id} | ${t.title}\n` +
        (t.pastQuestions.length
          ? t.pastQuestions.map((q) => `- ${q.slice(0, 240)}`).join("\n")
          : "- (no past questions on record)"),
    )
    .join("\n\n");

  const system = `You are a university examiner writing a short practice quiz. You test what the
REAL past papers actually asked. You ALWAYS reply with one valid JSON object and nothing else.`;

  const prompt = `Write ${input.count} MCQs for "${input.subject}".

TOPICS AND THEIR REAL PAST QUESTIONS:
${topicLines}

RULES:
1. Base every question on a real past question above wherever possible — same concept, possibly a
   fresh number or context. Only fall back to the topic itself when there is no past question.
2. Four options: "options" has exactly 4 strings, exactly one correct.
3. "answer" is the 0-based INDEX of the correct option. Double-check it is right.
4. "explanation" = one or two lines saying WHY the right answer is right, ideally referencing the
   concept. Useful for revision.
5. Make wrong options plausible near-misses (common confusion), not jokes.
6. Cover ${input.count} DIFFERENT topics where possible; do not ask two questions on one topic.

Return EXACTLY this JSON shape:
{
  "questions": [
    {
      "id": "q1",
      "question": "Question text?",
      "options": ["A", "B", "C", "D"],
      "answer": 2,
      "explanation": "Why C is correct.",
      "topicId": "TOPIC_ID"
    }
  ]
}`;

  return { system, prompt };
}

export interface AnswerInput {
  question: string;
  subject: string;
  topicTitle?: string;
  marks?: number;
  year?: string;
}

/** Writes a model answer for one real past question — how to actually score. */
export function buildAnswerPrompt(input: AnswerInput): { system: string; prompt: string } {
  const system = `You are a university examiner who sets and marks this subject. You write model
answers that earn full marks, and you are honest about what earns partial marks.
Reply in plain text with light markdown. No preamble.`;

  const prompt = `Write a model answer for this real past question from ${input.year || "a past paper"}.

SUBJECT: ${input.subject}
${input.topicTitle ? `TOPIC: ${input.topicTitle}` : ""}
${input.marks ? `MARKS: ${input.marks} — scale the depth to the marks.` : ""}

QUESTION:
"""
${input.question}
"""

FORMAT:
**Answer** — the answer itself, structured the way an examiner wants to see it (steps, points,
diagram descriptions, formulae). For numericals, show the working.
**Key points** — bullet list of what earns marks.
**Common mistake** — one line on how students usually lose marks here.
**How to revise this** — one line pointing at what to memorise.
${MATH_RULE}`;

  return { system, prompt };
}

/* ------------------------- solutions & mock paper ------------------------- */

export interface SolutionsInput {
  subject: string;
  /** One paper's questions, in the order they were printed. */
  paper: { label: string; year: string; questions: Array<{ text: string; marks?: number; number?: string }> };
}

/**
 * Writes worked solutions for a batch of ONE paper's questions — as STRUCTURED
 * data rather than one long blob, so the page can put each answer directly
 * under its own question (a solved paper, not a separate answer key) and tag
 * every question easy/medium/hard + important.
 *
 * Deliberately NOT JSON: answers are full of LaTeX backslashes ($\mathcal{O}$,
 * \frac) and Gemini's JSON mode mangles those escapes, silently producing
 * invalid JSON. A plain-text block format passes LaTeX through untouched and
 * cannot fail to parse.
 *
 * Batched rather than one-at-a-time so a 25-question paper is not 25 round
 * trips — but still per paper, so the answer key stays in the order the student
 * actually sat down with.
 */
export function buildSolutionsPrompt(input: SolutionsInput): {
  system: string;
  prompt: string;
} {
  const lines = input.paper.questions
    .map((q, i) => `${i + 1}. ${q.number ? `[${q.number}] ` : ""}${q.marks ? `(${q.marks} marks) ` : ""}${q.text}`)
    .join("\n");

  const system = `You are the examiner who set this paper and now write the official answer key.
You show working, not just results, and you are honest about where marks are actually awarded.
Reply as plain text in the exact block format requested — no code fences, no JSON, no preamble.`;

  const prompt = `Solve every question of this paper and tag how hard and how important it is.

SUBJECT: ${input.subject}
PAPER: ${input.paper.label} ${input.paper.year}

QUESTIONS:
${lines}

OUTPUT FORMAT — one block per question, in this EXACT shape, blocks back to back:

###ANSWER 1 | difficulty=easy | important=yes
The answer here. It may span many lines and use LaTeX like $x^2$ or $$\\frac{a}{b}$$. It ends where the next ###ANSWER line begins.

###ANSWER 2 | difficulty=hard | important=no
The answer here...

RULES:
1. Emit exactly one block per question above, numbered to match (###ANSWER 1, ###ANSWER 2, ...).
2. In the header line, difficulty is one of easy|medium|hard and important is yes|no.
3. Structure each answer the way an examiner expects: labelled points/steps, formulae
   substituted with values, diagram descriptions where asked. For numericals and
   derivations SHOW the working — a student must be able to copy the method.
4. End each answer with a line starting "**Marks**" — where the marks go (e.g. "**Marks** —
   setup 2 · working 3 · result 1"). Only when the question carried marks.
5. "difficulty": easy = direct recall / 1-2 mark objective; medium = 2-6 mark explanation or
   calculation; hard = long derivation, proof or a tricky numerical.
6. "important": yes when this question's topic or pattern keeps showing up in this subject's
   university exams — the kind of question a student must not skip.
7. For objective/short questions be brief — do not pad a 1-mark answer.
8. Keep answers technically correct for a university level. If a question is genuinely
   ambiguous, say so in one line rather than inventing certainty.
9. ${MATH_RULE}

Start your reply with the very first "###ANSWER 1" line — nothing before it.`;

  return { system, prompt };
}

export interface MockTestInput {
  subject: string;
  /** Structural fingerprint lifted from the real papers. */
  structure: {
    /** e.g. ["Section A (10 × 2 marks)", "Section B (4 × 6 marks)"] */
    sections: Array<{ name: string; count: number; marksEach: number; type: string }>;
    totalMarks: number;
    years: string;
  };
  /** High-yield topics the real papers keep returning to. */
  topics: Array<{ title: string; trend: string; pastQuestions: string[] }>;
}

/**
 * Builds a mock paper that mirrors the student's REAL papers — same sections,
 * same question counts, same marks-per-question, same question mix — but with
 * fresh questions on the topics their papers actually repeat.
 *
 * This is explicitly a practice paper built from a pattern, never a leak, and
 * it always ships with its own solutions.
 */
export function buildMockTestPrompt(input: MockTestInput): {
  system: string;
  prompt: string;
} {
  const structureLines = input.structure.sections
    .map((s) => `- ${s.name}: ${s.count} question(s), ${s.marksEach} marks each — ${s.type}`)
    .join("\n");

  const topicLines = input.topics
    .map(
      (t, i) =>
        `${i + 1}. ${t.title} [${t.trend}]\n` +
        (t.pastQuestions.length
          ? t.pastQuestions.map((q) => `   asked before: ${q.slice(0, 220)}`).join("\n")
          : "   (no past question on record)"),
    )
    .join("\n");

  const system = `You are a university examiner setting a practice paper that must feel identical in
structure to the student's own past papers. You never present it as anything but practice.
Reply in clean Markdown ONLY — no preamble, no code fences around the whole answer.`;

  const prompt = `Set ONE practice paper for "${input.subject}" plus its full solutions.

SOURCE PAPERS: ${input.structure.years}
TOTAL MARKS TO MATCH: ${input.structure.totalMarks}

STRUCTURE TO COPY EXACTLY:
${structureLines}

TOPICS THE REAL PAPERS KEEP RETURNING TO:
${topicLines}

HOW TO BUILD IT:
1. Match the structure exactly: same section names, same number of questions per
   section, same marks per question, same total marks. The student should not be
   able to tell the pattern apart from their real exam.
2. Aim the questions at the repeating/important topics above. Weight them roughly
   as those topics are actually weighted in the past papers.
3. Vary the question style within each section (defination, explanation,
   application, numerical/derivation) as the past papers do.
4. Every question must be answerable from the syllabus given below — no invented
   out-of-scope content.
5. NEW wording — do not copy any past question verbatim. Same concepts, fresh phrasing.
6. ${MATH_RULE}

OUTER SYLLABUS (do not go outside this):
"""
${(input.topics.map((t) => t.title).join(" · ")).slice(0, 1500)}
"""

OUTPUT FORMAT (Markdown):
## 📝 Mock test — structure same as your papers
Then each section as a level-3 heading (Section A, Section B, ... as the source
papers call them), with numbered questions and "[N marks]" after each.

Then:
## ✅ Solutions
Numbered to match, each answer showing the method. For numericals show the working.
End with:
### What to focus on before the real exam
- 4 to 6 bullets naming the highest-yield parts of THIS paper.`;

  return { system, prompt };
}

/* --------------------------- playlist ↔ syllabus map --------------------------- */
export interface PlaylistMapInput {
  topics: Array<{ id: string; title: string; description?: string; keywords?: string[] }>;
  /** Playlist video titles in playlist order, prefixed with their position. */
  videos: Array<{ id: string; title: string; position: number }>;
}

/**
 * Asks the model which playlist video teaches each syllabus topic.
 * This is what turns a random YouTube playlist into a verified syllabus match.
 */
export function buildPlaylistMapPrompt(
  input: PlaylistMapInput,
): { system: string; prompt: string } {
  const topicLines = input.topics
    .map(
      (t, i) =>
        `${i + 1}. id=${t.id} | ${t.title}${t.description ? ` — ${t.description}` : ""}${
          t.keywords?.length ? ` | keywords: ${t.keywords.slice(0, 5).join(", ")}` : ""
        }`,
    )
    .join("\n");

  const videoLines = input.videos
    .map((v) => `#${v.position + 1} id=${v.id} | ${v.title}`)
    .join("\n");

  const system = `You are a curriculum analyst who checks whether an existing YouTube course
playlist actually teaches a student's syllabus. You map syllabus topics onto playlist videos.
You ALWAYS reply with one valid JSON object and nothing else.`;

  const prompt = `Below is a student's syllabus broken into topics, and the video titles of an
existing YouTube playlist. Decide which playlist video teaches each topic.

SYLLABUS TOPICS:
${topicLines}

PLAYLIST VIDEOS (in order):
${videoLines}

RULES:
1. Map a topic ONLY when the playlist video genuinely teaches it. Partial or adjacent coverage
   does NOT count — "Intro to Recursion" does not cover "Recursion: base cases & stack traces".
2. One video may cover several topics; one topic maps to at most ONE video (the best one).
3. Order matters: pick the video that covers the topic most completely, not the first mention.
4. A topic with no real match is simply left out of your answer — do NOT invent ids.
5. Only use ids that literally appear above. Never invent a video id.

Return EXACTLY this JSON shape:
{
  "maps": [
    { "topicId": "TOPIC_ID", "videoId": "VIDEO_ID" }
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
