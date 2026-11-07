import type {
  ExamPlanResponse,
  PyqEvidence,
  PyqPaper,
  PyqQuestion,
  SyllabusAnalysis,
  Topic,
} from "@/lib/types";
import type { ExamState } from "@/components/ExamMode";

/**
 * Persists one analysed syllabus (and its PYQ state) so a refresh never
 * throws the student back to an empty form — and so the SAME syllabus text
 * is never analysed twice. Progress ticks live in `useStudiedTopics`
 * (their own key) and are unaffected by this cache.
 *
 * Everything stored here is derived data: it can always be rebuilt from the
 * original files, and `clearAnalysis` wipes it on "Start over".
 */

const KEY = "es-analysis-v1";

export interface PersistedAnalysis {
  v: 1;
  syllabus: string;
  subject: string;
  subjectName: string;
  topics: Topic[];
  analysis: SyllabusAnalysis;
  pyqSkipped: boolean;
  exam: {
    papers: ExamState["papers"];
    questions: PyqQuestion[];
    parsedPapers: PyqPaper[];
    plan: ExamPlanResponse | null;
  };
  evidence: PyqEvidence | null;
}

export function saveAnalysis(state: PersistedAnalysis): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Quota hit (huge OCR texts) — retry without the raw paper text. The
    // plan and questions survive; only re-parsing those papers would need a
    // re-upload.
    try {
      const lighter: PersistedAnalysis = {
        ...state,
        exam: { ...state.exam, papers: [] },
      };
      localStorage.setItem(KEY, JSON.stringify(lighter));
    } catch {
      /* storage blocked — refresh just won't restore */
    }
  }
}

export function loadAnalysis(): PersistedAnalysis | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedAnalysis;
    if (parsed?.v !== 1) return null;
    if (!parsed.analysis?.ok || !Array.isArray(parsed.topics) || parsed.topics.length === 0) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearAnalysis(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
