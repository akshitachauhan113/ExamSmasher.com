import { fingerprint } from "@/lib/exam";
import type {
  EvidenceOccurrence,
  ExamPlanResponse,
  PyqEvidence,
  PyqQuestion,
  RepeatedQuestionGroup,
  Topic,
  TopicFrequency,
  UnitDistribution,
  YearRow,
} from "@/lib/types";
import { tokenize } from "./text";

/**
 * PYQ evidence — everything counted straight from the uploaded papers.
 *
 * Two sources feed it:
 *   - the RAW parsed questions (every real occurrence, for repeats/marks/
 *     years), and
 *   - the plan's signals (the same mapping the Smart priority view uses),
 *     so frequency numbers can never disagree between the two tabs.
 *
 * Nothing here estimates or invents: a number that is not in the papers is
 * not shown, and what could not be read is reported as a note instead.
 */

export interface PyqEvidenceInput {
  topics: Topic[];
  /** Raw parsed questions from every uploaded paper. */
  questions: PyqQuestion[];
  /** The built exam plan — carries the topic mapping and per-paper counts. */
  plan: ExamPlanResponse | null;
}

/** Word-overlap floor for "same concept, different wording". */
const SIMILAR_THRESHOLD = 0.6;
/** Yield to the UI after this many pairwise comparisons. */
const TICK_EVERY = 30;
/** Keep the repeat lists readable — the counts above them stay complete. */
const MAX_EXACT_GROUPS = 40;
const MAX_SIMILAR_GROUPS = 30;

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function occurrenceOf(question: PyqQuestion): EvidenceOccurrence {
  return {
    questionId: question.id,
    paperLabel: question.paperLabel,
    paperYear: question.paperYear,
    number: question.number,
    text: question.text,
    marks: question.marks,
  };
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const term of a) if (b.has(term)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function intersection(a: Set<string>, b: Set<string>): string[] {
  const out: string[] = [];
  for (const term of a) if (b.has(term)) out.push(term);
  return out;
}

export async function buildPyqEvidence(
  input: PyqEvidenceInput,
  onProgress?: (done: number, total: number) => void,
): Promise<PyqEvidence> {
  const questions = input.questions.filter(
    (q) => Boolean(q) && typeof q.text === "string" && q.text.trim().length > 5,
  );
  const plan = input.plan;
  const papers = plan?.papers ?? [];

  const base = {
    papersAnalyzed: papers.length,
    questionsAnalyzed: questions.length,
    singlePaper: papers.length === 1,
    yearsIdentifiable: false,
    papersWithoutYear: 0,
    repeats: [] as RepeatedQuestionGroup[],
    exactCount: 0,
    similarCount: 0,
    topicFrequency: [] as TopicFrequency[],
    unitDistribution: [] as UnitDistribution[],
    years: [] as YearRow[],
    marks: null as PyqEvidence["marks"],
    crossPaperTopics: [] as TopicFrequency[],
    unmappedQuestions: 0,
    notes: [] as string[],
  };

  if (questions.length === 0) {
    return { ok: false, ...base, error: "No questions could be read from the papers yet." };
  }

  const notes: string[] = [];

  /* ------------------------------ repeats ------------------------------ */

  // Exact: identical wording after normalisation (numbers/punctuation and
  // filler words removed) — a genuine re-ask of the same question.
  const byFingerprint = new Map<string, PyqQuestion[]>();
  for (const question of questions) {
    const key = fingerprint(question.text);
    const list = byFingerprint.get(key);
    if (list) list.push(question);
    else byFingerprint.set(key, [question]);
  }

  const exactGroups: RepeatedQuestionGroup[] = [];
  for (const list of byFingerprint.values()) {
    if (list.length < 2) continue;
    exactGroups.push({
      kind: "exact",
      occurrences: list.map(occurrenceOf),
    });
  }
  // Cross-paper repeats first — they are the ones that mean a pattern.
  exactGroups.sort((a, b) => {
    const papersA = new Set(a.occurrences.map((o) => `${o.paperLabel}|${o.paperYear}`)).size;
    const papersB = new Set(b.occurrences.map((o) => `${o.paperLabel}|${o.paperYear}`)).size;
    if (papersA !== papersB) return papersB - papersA;
    return b.occurrences.length - a.occurrences.length;
  });

  // Similar: one representative per distinct wording, clustered by shared
  // concept words. Exact duplicates are excluded by construction (they are
  // the same fingerprint), so the two lists never overlap.
  const representatives: PyqQuestion[] = [];
  for (const list of byFingerprint.values()) representatives.push(list[0]);

  const tokenSets = representatives.map((question) => new Set(tokenize(question.text)));
  const clusters: Array<{ rep: PyqQuestion; members: number[] }> = [];
  const clusterTokens: Set<string>[] = [];
  let comparisons = 0;

  for (let i = 0; i < representatives.length; i += 1) {
    let matched = -1;
    for (let c = 0; c < clusterTokens.length; c += 1) {
      comparisons += 1;
      if (jaccard(tokenSets[i], clusterTokens[c]) >= SIMILAR_THRESHOLD) {
        matched = c;
        break;
      }
      if (comparisons % TICK_EVERY === 0) {
        onProgress?.(i, representatives.length);
        await tick();
      }
    }
    if (matched >= 0) {
      clusters[matched].members.push(i);
      // Widen the cluster's token set so chains keep matching.
      for (const term of tokenSets[i]) clusterTokens[matched].add(term);
    } else {
      clusters.push({ rep: representatives[i], members: [i] });
      clusterTokens.push(new Set(tokenSets[i]));
    }
    if (i % TICK_EVERY === 0) {
      onProgress?.(i, representatives.length);
      await tick();
    }
  }
  onProgress?.(representatives.length, representatives.length);

  const similarGroups: RepeatedQuestionGroup[] = clusters
    .filter((cluster) => cluster.members.length >= 2)
    .map((cluster) => {
      let shared = new Set(tokenSets[cluster.members[0]]);
      for (const member of cluster.members.slice(1)) {
        shared = new Set(intersection(shared, tokenSets[member]));
      }
      return {
        kind: "similar" as const,
        occurrences: cluster.members.map((index) => occurrenceOf(representatives[index])),
        sharedTerms: [...shared].slice(0, 8),
      };
    })
    .sort((a, b) => b.occurrences.length - a.occurrences.length);

  const exactShown = exactGroups.slice(0, MAX_EXACT_GROUPS);
  const similarShown = similarGroups.slice(0, MAX_SIMILAR_GROUPS);
  if (exactGroups.length > exactShown.length || similarGroups.length > similarShown.length) {
    notes.push(
      `Showing the ${exactShown.length} strongest exact and ${similarShown.length} strongest similar repeats — the totals above count every repeat found.`,
    );
  }

  /* -------------------- topic / unit / year frequency -------------------- */

  const topicFrequency: TopicFrequency[] = [];
  let mappedTotal = 0;

  for (const entry of plan?.topics ?? []) {
    const signal = entry.signal;
    const questionCount = signal.questions.reduce((sum, q) => sum + (q.repeatCount ?? 1), 0);
    mappedTotal += questionCount;
    if (questionCount === 0) continue;
    topicFrequency.push({
      topicId: entry.topic.id,
      questionCount,
      papersAppeared: signal.appearances,
      totalMarks: signal.totalMarks,
      years: [...new Set(signal.questions.map((q) => q.paperYear).filter((y) => /\d{4}/.test(y)))],
    });
  }
  topicFrequency.sort(
    (a, b) => b.papersAppeared - a.papersAppeared || b.questionCount - a.questionCount,
  );

  const unmapped = Math.max(0, questions.length - mappedTotal);
  if (plan && unmapped > 0) {
    notes.push(
      `${unmapped} of ${questions.length} questions did not match any syllabus topic — they are counted here but not attributed.`,
    );
  }

  // Unit-wise distribution: aggregate the SAME topic numbers (no second
  // counting pass that could drift).
  const unitMap = new Map<string, UnitDistribution>();
  for (const unit of input.topics.length > 0 ? input.topics : []) {
    const label = (unit.chapter ?? "General").slice(0, 60);
    if (!unitMap.has(label)) unitMap.set(label, { unit: label, questionCount: 0, papersAppeared: 0, totalMarks: 0 });
  }
  const unitPapers = new Map<string, Set<string>>();
  const topicById = new Map(input.topics.map((t) => [t.id, t]));
  for (const freq of topicFrequency) {
    const topic = topicById.get(freq.topicId);
    const label = (topic?.chapter ?? "General").slice(0, 60);
    const row = unitMap.get(label) ?? { unit: label, questionCount: 0, papersAppeared: 0, totalMarks: 0 };
    unitMap.set(label, row);
    row.questionCount += freq.questionCount;
    row.totalMarks += freq.totalMarks;
    const set = unitPapers.get(label) ?? new Set<string>();
    const signal = plan?.topics?.find((e) => e.topic.id === freq.topicId)?.signal;
    for (const q of signal?.questions ?? []) set.add(`${q.paperLabel}|${q.paperYear}`);
    unitPapers.set(label, set);
  }
  for (const [label, set] of unitPapers) {
    const row = unitMap.get(label);
    if (row) row.papersAppeared = set.size;
  }
  const unitDistribution = [...unitMap.values()].sort(
    (a, b) => b.questionCount - a.questionCount || a.unit.localeCompare(b.unit),
  );

  /* -------------------------------- years -------------------------------- */

  const identifiablePapers = papers.filter((p) => /\d{4}/.test(p.year));
  const papersWithoutYear = papers.length - identifiablePapers.length;
  const yearsIdentifiable = identifiablePapers.length >= 2;

  const yearMap = new Map<string, { count: number; topics: Set<string> }>();
  for (const question of questions) {
    if (!/\d{4}/.test(question.paperYear)) continue;
    const row = yearMap.get(question.paperYear) ?? { count: 0, topics: new Set<string>() };
    row.count += 1;
    if (question.topicId) row.topics.add(question.topicId);
    yearMap.set(question.paperYear, row);
  }
  const years: YearRow[] = [...yearMap.entries()]
    .map(([year, row]) => ({ year, questionCount: row.count, topicsTouched: row.topics.size }))
    .sort((a, b) => a.year.localeCompare(b.year));

  if (papersWithoutYear > 0) {
    notes.push(
      `${papersWithoutYear} of ${papers.length} papers had no identifiable year — year-wise rows cover only the dated papers.`,
    );
  }
  if (papers.length === 1) {
    notes.push(
      "Only one paper was analysed — every number below comes from that paper alone. No multi-year trend is claimed.",
    );
  } else if (identifiablePapers.length === 1) {
    notes.push(
      "Only one paper carried a recognizable year — year-wise patterns need at least two dated papers.",
    );
  }

  /* -------------------------------- marks -------------------------------- */

  const withMarks = questions.filter((q) => typeof q.marks === "number" && q.marks > 0);
  const marks: PyqEvidence["marks"] =
    withMarks.length > 0
      ? {
          withMarks: withMarks.length,
          total: withMarks.reduce((sum, q) => sum + (q.marks ?? 0), 0),
          distribution: [...withMarks.reduce((map, q) => {
            const value = q.marks ?? 0;
            map.set(value, (map.get(value) ?? 0) + 1);
            return map;
          }, new Map<number, number>()).entries()]
            .map(([marksValue, count]) => ({ marks: marksValue, count }))
            .sort((a, b) => a.marks - b.marks),
        }
      : null;
  if (!marks) {
    notes.push("No marks were printed on the parsed questions — marks distribution is unavailable.");
  }

  const crossPaperTopics = topicFrequency.filter((f) => f.papersAppeared >= 2);

  return {
    ok: true,
    ...base,
    papersAnalyzed: papers.length,
    questionsAnalyzed: questions.length,
    singlePaper: papers.length === 1,
    yearsIdentifiable,
    papersWithoutYear,
    repeats: [...exactShown, ...similarShown],
    exactCount: exactGroups.length,
    similarCount: similarGroups.length,
    topicFrequency,
    unitDistribution,
    years,
    marks,
    crossPaperTopics,
    unmappedQuestions: unmapped,
    notes,
  };
}
