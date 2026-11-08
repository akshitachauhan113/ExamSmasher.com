/**
 * Exam-mode state lives on the page (so re-analysing the syllabus never wipes
 * uploaded papers). The shape lives here — a tiny module with no React or
 * component imports — so the page can hold it and type-import it without
 * pulling the whole ExamMode panel (and everything it renders) into the
 * initial bundle.
 */

import type { ExamPlanResponse, PyqPaper, PyqQuestion } from "@/lib/types";

/** One uploaded paper, already read into text, waiting to be parsed. */
export interface PendingPaper {
  id: string;
  year: string;
  label: string;
  fileName: string;
  text: string;
}

/** Everything Exam Mode produces. Owned by the page, edited by the panel. */
export interface ExamState {
  papers: PendingPaper[];
  questions: PyqQuestion[];
  parsedPapers: PyqPaper[];
  plan: ExamPlanResponse | null;
}

export const EMPTY_EXAM_STATE: ExamState = {
  papers: [],
  questions: [],
  parsedPapers: [],
  plan: null,
};
