import { generateJSON, getLlmConfig } from "@/lib/llm";
import { buildExamTopics, computeSignals, rankExpected } from "@/lib/exam";
import { buildExpectedPrompt, buildMapQuestionsPrompt } from "@/lib/prompts";
import type { ExamPlanResponse, PyqPaper, PyqQuestion, Topic } from "@/lib/types";

/**
 * Builds the exam plan from a student's REAL past papers.
 *
 * The AI only does the two things it is good at: mapping a question onto a
 * syllabus topic, and extrapolating wording for "most expected". Every number
 * the student sees — how often a topic repeats, its marks, its priority — is
 * computed from the real questions, never invented.
 */
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    subject?: unknown;
    topics?: Array<Partial<Topic>>;
    questions?: PyqQuestion[];
    totalMinutes?: unknown;
  } | null;

  const config = getLlmConfig();
  if (!config) {
    return Response.json(
      {
        ok: false,
        error: "The exam plan needs an AI key. Open “API Keys” and add GEMINI_API_KEY.",
      },
      { status: 503 },
    );
  }

  const subject = typeof body?.subject === "string" ? body.subject.trim().slice(0, 80) : "";
  const topics = normalizeTopics(body?.topics);
  const questions = (Array.isArray(body?.questions) ? body.questions : []).filter(
    (q): q is PyqQuestion =>
      Boolean(q) && typeof q.text === "string" && q.text.trim().length > 5,
  );

  if (topics.length === 0) {
    return Response.json(
      { ok: false, error: "Extract topics from your syllabus first." },
      { status: 400 },
    );
  }
  if (questions.length === 0) {
    return Response.json(
      { ok: false, error: "Upload at least one previous-year paper first." },
      { status: 400 },
    );
  }

  const totalMinutes =
    Number.isFinite(Number(body?.totalMinutes)) && Number(body?.totalMinutes) > 0
      ? Math.min(60 * 24 * 30, Math.round(Number(body?.totalMinutes)))
      : undefined;

  const notes: string[] = [];
  const papers = distinctPapers(questions);

  if (papers.length < 2) {
    notes.push(
      "Only one paper was readable — trends are weak with a single year. Add 2-3 more papers for a reliable repeat pattern.",
    );
  }
  if (questions.length < 10) {
    notes.push(
      `Only ${questions.length} questions could be read, so priority is based on thin evidence.`,
    );
  }

  // 1. AI maps each real question onto a syllabus topic.
  let mapped = questions;
  try {
    mapped = await mapQuestions(topics, questions);
  } catch {
    notes.push(
      "Question-to-topic matching failed, so priority fell back to the syllabus order instead of the paper trend.",
    );
  }

  // 2. Deterministic trend + ROI ordering.
  const signals = computeSignals(topics, mapped, papers.length);
  const examTopics = buildExamTopics(topics, signals, totalMinutes);

  const covered = examTopics.filter((t) => t.signal.appearances > 0).length;
  if (covered === 0) {
    notes.push(
      "None of the extracted questions matched your syllabus topics — check that the syllabus and the papers are for the same subject.",
    );
  } else if (covered < topics.length * 0.5) {
    notes.push(
      `Only ${covered}/${topics.length} syllabus topics appear in these papers. The rest are marked rare — that is real evidence they are low-yield, but confirm the papers cover the full syllabus.`,
    );
  }

  // 3. "Most expected", extrapolated from the real repeating patterns.
  let expected = rankExpected(mapped);
  try {
    const generated = await buildExpected(subject, examTopics);
    if (generated.length > 0) {
      expected = generated;
      notes.push(
        "Expected questions below are predictions extrapolated from your real papers — not a leaked paper.",
      );
    }
  } catch {
    notes.push(
      "Could not write predicted questions, so the list below shows your highest-frequency REAL past questions instead.",
    );
  }

  const response: ExamPlanResponse = {
    ok: true,
    subject,
    papers,
    topics: examTopics,
    expected,
    notes,
    totalMarks: mapped.reduce((sum, q) => sum + (q.marks ?? 0), 0),
  };
  return Response.json(response);
}

/* -------------------------------------------------------------------------- */

async function mapQuestions(
  topics: Topic[],
  questions: PyqQuestion[],
): Promise<PyqQuestion[]> {
  const { system, prompt } = buildMapQuestionsPrompt({
    topics: topics.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      keywords: t.keywords,
    })),
    questions: questions.map((q) => ({ id: q.id, paperYear: q.paperYear, text: q.text })),
  });

  const parsed = await generateJSON<{ maps?: Array<{ questionId?: unknown; topicId?: unknown }> }>(
    prompt,
    { system, temperature: 0, maxOutputTokens: 4096, timeoutMs: 60_000 },
  );

  const topicIds = new Set(topics.map((t) => t.id));
  const lookup = new Map<string, string>();

  for (const entry of parsed.maps ?? []) {
    const questionId = typeof entry?.questionId === "string" ? entry.questionId : "";
    const topicId = typeof entry?.topicId === "string" ? entry.topicId : "";
    // Trust nothing the model invented — both sides must be real ids.
    if (!questionId || !topicId || !topicIds.has(topicId)) continue;
    if (lookup.has(questionId)) continue;
    lookup.set(questionId, topicId);
  }

  return questions.map((q) => ({ ...q, topicId: lookup.get(q.id) ?? q.topicId }));
}

interface ExpectedQuestion {
  text: string;
  topicTitle: string;
  marks?: number;
  confidence?: string;
  basis?: string;
}

async function buildExpected(
  subject: string,
  examTopics: Awaited<ReturnType<typeof buildExamTopics>>,
): Promise<PyqQuestion[]> {
  // Only topics with a real trend are worth predicting from.
  const groups = examTopics
    .filter((entry) => entry.signal.questions.length > 0 && entry.signal.trend !== "rare")
    .sort((a, b) => b.signal.examScore - a.signal.examScore)
    .slice(0, 8)
    .map((entry) => ({
      topicTitle: entry.topic.title,
      trend: entry.signal.trend,
      questions: entry.signal.questions.slice(0, 5).map((q) => ({
        text: q.text,
        paperYear: q.paperYear,
        marks: q.marks,
      })),
    }));

  if (groups.length === 0) return [];

  const { system, prompt } = buildExpectedPrompt({ subject, groups });
  const parsed = await generateJSON<{ expected?: ExpectedQuestion[] }>(prompt, {
    system,
    temperature: 0.4,
    maxOutputTokens: 6144,
    timeoutMs: 90_000,
  });

  const topicByTitle = new Map(
    examTopics.map((entry) => [entry.topic.title.toLowerCase(), entry.topic.id]),
  );

  return (parsed.expected ?? [])
    .map((item, index): PyqQuestion | null => {
      const text = typeof item?.text === "string" ? item.text.trim().replace(/\s+/g, " ") : "";
      if (text.length < 10) return null;

      const title = typeof item.topicTitle === "string" ? item.topicTitle.toLowerCase() : "";
      const topicId =
        topicByTitle.get(title) ??
        [...topicByTitle.entries()].find(([key]) => key.includes(title.slice(0, 20)) || title.includes(key.slice(0, 20)))?.[1];

      const marks =
        Number.isFinite(Number(item.marks)) && Number(item.marks) > 0
          ? Math.round(Number(item.marks))
          : undefined;

      return {
        id: `exp-${index + 1}`,
        paperYear: "Expected",
        paperLabel: item.confidence === "high" ? "High confidence" : "Likely",
        text: text.slice(0, 700),
        marks,
        type: "other",
        topicId,
        isVariant: true,
      };
    })
    .filter((q): q is PyqQuestion => q !== null)
    .slice(0, 12);
}

function distinctPapers(questions: PyqQuestion[]): PyqPaper[] {
  const map = new Map<string, { id: string; year: string; label: string; questionCount: number }>();
  for (const q of questions) {
    const key = `${q.paperLabel}|${q.paperYear}`;
    const entry = map.get(key) ?? {
      id: key,
      year: q.paperYear,
      label: q.paperLabel,
      questionCount: 0,
    };
    entry.questionCount += 1;
    map.set(key, entry);
  }
  return [...map.values()];
}

function normalizeTopics(raw: Array<Partial<Topic>> | undefined): Topic[] {
  return (Array.isArray(raw) ? raw : [])
    .filter((t): t is Partial<Topic> & { title: string } =>
      Boolean(t) && typeof t.title === "string" && t.title.trim().length > 1,
    )
    .map((t, index) => ({
      id: typeof t.id === "string" && t.id ? t.id : `t${index + 1}`,
      title: t.title.trim().slice(0, 120),
      description: typeof t.description === "string" ? t.description.slice(0, 400) : "",
      keywords: Array.isArray(t.keywords)
        ? t.keywords.filter((k): k is string => typeof k === "string").slice(0, 8)
        : [],
      importance: t.importance ?? "important",
      difficulty: t.difficulty ?? "intermediate",
      estimatedMinutes: Number(t.estimatedMinutes) || 20,
      chapter: typeof t.chapter === "string" ? t.chapter.slice(0, 60) : undefined,
    }));
}
