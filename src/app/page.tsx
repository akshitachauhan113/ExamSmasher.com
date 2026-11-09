"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";

import { CheckIcon, GraduationIcon } from "@/components/Icons";
import { AiStatusChip } from "@/components/AiStatusChip";
import { ChatWidget } from "@/components/ChatWidget";
import { CompleteSyllabusPanel } from "@/components/CompleteSyllabusPanel";
import { SmartExamPanel } from "@/components/SmartExamPanel";
import { PyqEvidencePanel } from "@/components/PyqEvidencePanel";
import { SyllabusForm } from "@/components/SyllabusForm";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TopicPanel } from "@/components/TopicPanel";
import { TopicSidebar } from "@/components/TopicSidebar";
import { BottomNav, SiteNav, type AppView } from "@/components/SiteNav";
import {
  HeroDashboard,
  type DashboardAction,
  type SpaceAnchor,
} from "@/components/HeroDashboard";
import { TabBar } from "@/components/TabBar";
import { OverviewPanel } from "@/components/OverviewPanel";
import { TopicAccordion, unitKeyOf } from "@/components/TopicAccordion";
import { PlaylistBoard, type PlaylistTab } from "@/components/PlaylistBoard";
import { SettingsPanel } from "@/components/SettingsPanel";
import { usePlaylistProgress } from "@/hooks/usePlaylistProgress";
import { useStudiedTopics } from "@/hooks/useStudiedTopics";
import { primeBrowserAi } from "@/lib/ai/run";
import {
  analyzeFullSyllabus,
  buildPlan,
  buildPyqEvidence,
  buildSmartPriority,
  syllabusToTopics,
  topicSearches,
} from "@/lib/engine";
import { clearAnalysis, loadAnalysis, saveAnalysis } from "@/lib/analysisCache";
import { EMPTY_EXAM_STATE, type ExamState } from "@/lib/examState";
import { planForRecommendations, clearCachedRecommendations } from "@/lib/recommendCache";
import { buildCsv, buildMarkdown, copyText, downloadFile } from "@/lib/exporters";
import { SAMPLE_SUBJECT, SAMPLE_SYLLABUS } from "@/lib/sample";
import type {
  ExamPlanResponse,
  ExamTopic,
  PlanResponse,
  PyqEvidence,
  PyqQuestion,
  SmartPriorityResult,
  SyllabusAnalysis,
  Topic,
  TopicResult,
} from "@/lib/types";

/**
 * Heavy, interaction-only views: each loads as its own chunk the first time
 * the student opens it (PYQ tab, My Study Space, the plan modal, the to-do
 * panel), so the first paint never downloads the whole app. `loading` keeps
 * the boundary silent — every open completes in a few milliseconds.
 */
const ExamMode = dynamic(
  () => import("@/components/ExamMode").then((mod) => mod.ExamMode),
  { loading: () => null },
);
const StudySpacePanel = dynamic(
  () => import("@/components/StudySpacePanel").then((mod) => mod.StudySpacePanel),
  { loading: () => null },
);
const StudyPlanModal = dynamic(
  () => import("@/components/StudyPlanModal").then((mod) => mod.StudyPlanModal),
  { loading: () => null },
);
const TodoPanel = dynamic(
  () => import("@/components/TodoPanel").then((mod) => mod.TodoPanel),
  { loading: () => null },
);

type Phase = "idle" | "analyzing" | "papers" | "matching" | "done";
/** Which analysis tab the student is reading. */
type AnalysisTab = "overview" | "complete" | "smart" | "pyq" | "playlists";

interface PlanState {
  open: boolean;
  loading: boolean;
  plan: PlanResponse | null;
  error: string | null;
}

export default function Home() {
  /* ------------------------------- setup ------------------------------- */
  /**
   * Start the optional browser model downloading as soon as the page opens.
   * Nothing is required of it: the rule-based engine answers immediately
   * either way, and the header chip reports whatever is actually happening.
   */
  useEffect(() => {
    primeBrowserAi();
  }, []);

  /* -------------------------------- form -------------------------------- */
  const [syllabus, setSyllabus] = useState("");
  const [subject, setSubject] = useState("");
  const [language, setLanguage] = useState("hinglish");
  // 2-4 search links per topic is plenty — the real job is covering the WHOLE
  // syllabus, so quota goes to breadth (every topic) not depth (many links
  // on the same topic).
  const [perTopic, setPerTopic] = useState(3);

  /* ------------------------------- results ------------------------------ */
  const [phase, setPhase] = useState<Phase>("idle");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [subjectName, setSubjectName] = useState("");
  const [results, setResults] = useState<Record<string, TopicResult>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /** Exam Mode output — priority plan built from the student's real papers.
   *  Held in the page so a re-analysis does not wipe uploaded papers. */
  const [exam, setExamState] = useState<ExamState>(EMPTY_EXAM_STATE);
  /** True when the student deliberately skipped the PYQ step for now. */
  const [pyqSkipped, setPyqSkipped] = useState(false);

  /* -------------------- Phase 4 · analysis surfaces -------------------- */
  /** Full uncapped syllabus structure — units, topics, subtopics, unclear lines. */
  const [syllabusAnalysis, setSyllabusAnalysis] = useState<SyllabusAnalysis | null>(null);
  /** PYQ evidence counted from the uploaded papers (chunked, non-blocking). */
  const [evidence, setEvidence] = useState<PyqEvidence | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [evidenceProgress, setEvidenceProgress] = useState(0);
  /** Bumped to re-run a failed evidence count. */
  const [evidenceNonce, setEvidenceNonce] = useState(0);
  /** Short stage label shown on the Analyse button while it works. */
  const [stage, setStage] = useState<string | null>(null);

  /* --------------------------- navigation views ------------------------- */
  const [view, setView] = useState<AppView>("home");
  const [analysisTab, setAnalysisTab] = useState<AnalysisTab>("overview");
  const [playlistTab, setPlaylistTab] = useState<PlaylistTab>("complete");
  /** Unit (chapter) sections the student has opened in the topic accordion. */
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(new Set());

  /** Partial-update helper so ExamMode can patch one field without the rest. */
  const setExam = useCallback((patch: Partial<ExamState>) => {
    setExamState((prev) => ({ ...prev, ...patch }));
  }, []);
  const [plan, setPlan] = useState<PlanState>({
    open: false,
    loading: false,
    plan: null,
    error: null,
  });
  const [todoOpen, setTodoOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Search links are built exactly once per analysis — after the PYQ step or
   *  when it is skipped. A slider-driven plan rebuild must not rebuild them. */
  const searchStartedRef = useRef(false);
  /** Topic-order signature of the last plan the links were built against. */
  const matchedPlanRef = useRef("");
  /** Questions+topics signature the evidence was last counted for. */
  const evidenceSigRef = useRef("");
  /** Set after a cached analysis is restored — its links rebuild exactly once. */
  const restoreLinksRef = useRef(false);
  /** Debounce handle for the analysis cache writes. */
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The cache is hydrated at most once per page load. */
  const restoredRef = useRef(false);

  const studiedApi = useStudiedTopics();
  const { isStudied, toggle: toggleStudied, clearAll: clearStudied } = studiedApi;

  /** Phase 5 · which topics are covered / which searches were watched. */
  const playlistProgress = usePlaylistProgress();

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  const completed = useMemo(
    () => topics.filter((t) => results[t.id]).length,
    [topics, results],
  );
  const studiedCount = useMemo(
    () => topics.filter((t) => isStudied(t.title)).length,
    [topics, isStudied],
  );
  const matchedTopics = useMemo(
    () => topics.filter((t) => (results[t.id]?.searches?.length ?? 0) > 0).length,
    [topics, results],
  );
  const videoCount = useMemo(
    () => Object.values(results).reduce((sum, r) => sum + r.searches.length, 0),
    [results],
  );
  const allStudied = topics.length > 0 && studiedCount === topics.length;
  /** Only the syllabus analysis blocks the student — video search is Step 3. */
  const busy = phase === "analyzing";
  /** Search links exist (being built, or finished). */
  const linksReady = phase === "matching" || phase === "done";

  /**
   * Exam Mode rewrites the study order: once the plan exists, must-do topics
   * come first instead of syllabus order. Without papers, importance from the
   * syllabus analysis does the same job — core first — so the list is ALWAYS
   * ordered by what is worth more marks.
   */
  const displayTopics = useMemo<Topic[]>(() => {
    if (exam.plan?.topics?.length) return exam.plan.topics.map((e) => e.topic);
    const WEIGHT: Record<Topic["importance"], number> = { core: 0, important: 1, bonus: 2 };
    return [...topics].sort((a, b) => WEIGHT[a.importance] - WEIGHT[b.importance]);
  }, [exam.plan, topics]);

  /**
   * topicId -> Must / Might / Can skip.
   *
   * With papers the band comes from the real trend. Without them every topic
   * still gets an honest tag from the syllabus analysis, so the student can
   * triage before a single paper is uploaded.
   */
  const bandByTopic = useMemo(() => {
    const map = new Map<string, ExamTopic["band"]>();
    for (const entry of exam.plan?.topics ?? []) map.set(entry.topic.id, entry.band);
    for (const topic of topics) {
      if (map.has(topic.id)) continue;
      map.set(
        topic.id,
        topic.importance === "core"
          ? "must"
          : topic.importance === "important"
            ? "should"
            : "if-time",
      );
    }
    return map;
  }, [exam.plan, topics]);

  /** topicId -> its exam priority entry, for badges and PYQ practice. */
  const examByTopic = useMemo(() => {
    const map = new Map<string, ExamTopic>();
    for (const entry of exam.plan?.topics ?? []) map.set(entry.topic.id, entry);
    return map;
  }, [exam.plan]);

  /**
   * topicId -> the real past questions that belong to it.
   *
   * These come from the PLAN, not from `exam.questions`: the question-to-topic
   * mapping happens inside `buildExamPlan`, and the plan's `signal.questions`
   * are the only client-side copy carrying `topicId`. Reading `exam.questions`
   * here would silently produce an empty map and the PYQ practice panel would
   * never render.
   */
  const pyqByTopic = useMemo(() => {
    const map = new Map<string, PyqQuestion[]>();
    for (const entry of exam.plan?.topics ?? []) {
      const list = entry.signal.questions ?? [];
      if (list.length > 0) map.set(entry.topic.id, list);
    }
    return map;
  }, [exam.plan]);

  /**
   * How many syllabus topics your real papers actually asked about.
   *
   * This is counted, not estimated — it is the honest replacement for the old
   * "syllabus covered" score, which used to be a video-match number.
   */
  const pyqCovered = useMemo(() => pyqByTopic.size, [pyqByTopic]);

  /* ------------------ Phase 4 · smart priority + PYQ evidence ------------------ */

  /** High / Medium / Low + reasons — built from the SAME signals the PYQ tab
   *  displays, so the two views can never disagree on a count. */
  const priority = useMemo<SmartPriorityResult>(
    () => buildSmartPriority({ topics, plan: exam.plan }),
    [topics, exam.plan],
  );

  /* ------------------ Phase 5 · video recommendations (playlists) ------------------ */

  /** Subtopics per topic id — walked in the SAME order syllabusToTopics used
   *  (both derive from this analysis), so ids always line up. */
  const subtopicsByTopicId = useMemo(() => {
    const map: Record<string, string[]> = {};
    if (!syllabusAnalysis) return map;
    let index = 0;
    for (const unit of syllabusAnalysis.units) {
      for (const entry of unit.topics) {
        const topic = topics[index];
        index += 1;
        if (topic && entry.subtopics.length > 0) map[topic.id] = entry.subtopics;
      }
    }
    return map;
  }, [syllabusAnalysis, topics]);

  /** The two playlist plans — deterministic, cached, rebuilt only when the
   *  syllabus / priority / language / study progress actually change. */
  const completePlan = useMemo(
    () =>
      planForRecommendations({
        mode: "complete",
        topics,
        priority,
        subject: subjectName,
        language,
        isStudied,
      }),
    [topics, priority, subjectName, language, isStudied],
  );

  const smartPlan = useMemo(
    () =>
      planForRecommendations({
        mode: "smart",
        topics,
        priority,
        subject: subjectName,
        language,
        isStudied,
      }),
    [topics, priority, subjectName, language, isStudied],
  );

  /** Signature of the exact inputs the evidence is counted from. */
  const evidenceSig = useMemo(() => {
    if (!exam.plan || exam.questions.length === 0) return "";
    const questionIds = exam.questions.map((item) => item.id).join(",");
    const topicIds = topics.map((item) => item.id).join(",");
    return `${questionIds}|${topicIds}`;
  }, [exam.plan, exam.questions, topics]);

  /** Counts evidence once per questions-set — same files are never re-counted. */
  useEffect(() => {
    if (!evidenceSig || !exam.plan) {
      if (evidenceSigRef.current) {
        evidenceSigRef.current = "";
        setEvidence(null);
        setEvidenceError(null);
      }
      return;
    }
    if (evidenceSigRef.current === evidenceSig) return;
    evidenceSigRef.current = evidenceSig;

    let cancelled = false;
    setEvidenceLoading(true);
    setEvidenceError(null);
    setEvidenceProgress(0);

    buildPyqEvidence(
      { topics, questions: exam.questions, plan: exam.plan },
      (done, total) => {
        if (!cancelled) setEvidenceProgress(total > 0 ? done / total : 1);
      },
    )
      .then((result) => {
        if (cancelled) return;
        if (result.ok) {
          setEvidence(result);
          setEvidenceProgress(1);
        } else {
          setEvidenceError(result.error || "Evidence count nahi ho paya.");
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setEvidenceError(err instanceof Error ? err.message : "Evidence count nahi ho paya.");
        }
      })
      .finally(() => {
        if (!cancelled) setEvidenceLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [evidenceSig, evidenceNonce, exam.plan, exam.questions, topics]);

  /** Retry a failed evidence count (same inputs, fresh run). */
  const retryEvidence = useCallback(() => {
    setEvidenceNonce((value) => value + 1);
  }, []);

  /* ------------------------------ matching ------------------------------ */
  /**
   * Builds the per-topic YouTube search links.
   *
   * There is no YouTube call here and no ranking: every entry is a URL to
   * YouTube's own results page, built from the topic's own syllabus wording.
   * What the student sees after clicking is whatever YouTube actually returns.
   */
  const runMatching = useCallback(
    async (
      list: Topic[],
      courseName: string,
      signal: AbortSignal,
      lang: string,
      picks: number,
      skipStudied: boolean,
    ) => {
      for (const topic of list) {
        if (signal.aborted) return;

        // Topics the student already knows do not need a study direction.
        if (skipStudied && isStudied(topic.title)) {
          setResults((prev) => ({
            ...prev,
            [topic.id]: {
              topic,
              searches: [],
              queries: [],
              skipped: true,
            },
          }));
          continue;
        }

        try {
          const result = topicSearches({
            topic,
            subject: courseName,
            language: lang,
            limit: picks,
            examQuestions: pyqByTopic.get(topic.id)?.map((q) => q.text) ?? [],
          });
          setResults((prev) => ({ ...prev, [topic.id]: result }));
        } catch (err) {
          setResults((prev) => ({
            ...prev,
            [topic.id]: {
              topic,
              searches: [],
              queries: [],
              error: err instanceof Error ? err.message : "Search links could not be built.",
            },
          }));
        }

        // Yield a frame so the panels fill in progressively instead of all at once.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      if (!signal.aborted) setPhase("done");
    },
    // pyqByTopic feeds exam-worded queries — a new plan must re-create this.
    [isStudied, pyqByTopic],
  );

  /**
   * Step 3 — the search links, built exactly ONCE per analysis: either right
   * after the PYQ plan lands (queries then use the exam's own wording) or
   * immediately when papers are skipped.
   */
  const beginVideoSearch = useCallback(async () => {
    if (searchStartedRef.current || topics.length === 0) return;
    searchStartedRef.current = true;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPhase("matching");
    setFormError(null);
    await runMatching(topics, subjectName, controller.signal, language, perTopic, true);
  }, [topics, subjectName, language, perTopic, runMatching]);

  /** Step 2 skipped — go straight to links, importance taken from syllabus. */
  const skipPapers = useCallback(() => {
    setPyqSkipped(true);
    notify("Theek hai — syllabus importance se search links bana raha hoon.");
    void beginVideoSearch();
  }, [beginVideoSearch, notify]);

  /* ------------------------------ analyse ------------------------------- */
  const startAnalysis = useCallback(async (text: string) => {
    if (text.trim().length < 20) {
      setFormError("Paste at least a few lines of your syllabus so topics can be extracted.");
      return;
    }
    if (text.length > 24000) {
      setFormError("Syllabus is too long — trim it under 24,000 characters.");
      return;
    }

    // The form passes its LIVE text (typing no longer re-renders the page),
    // so adopt it here — everything downstream sees exactly what analysed.
    setSyllabus(text);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setFormError(null);
    setResults({});
    setTopics([]);
    setSyllabusAnalysis(null);
    setEvidence(null);
    setEvidenceError(null);
    evidenceSigRef.current = "";
    setActiveId(null);
    // Fresh analysis starts on the Overview tab with all units closed.
    setView("home");
    setAnalysisTab("overview");
    setExpandedUnits(new Set());
    // Keep the uploaded PAPERS (re-OCR is expensive) but drop derived state —
    // new topics mean the plan and the topic mapping must be rebuilt.
    setExam({ questions: [], parsedPapers: [], plan: null });
    setPhase("analyzing");

    try {
      // Stage 1 — paint the button label before the synchronous parse lands.
      setStage("Syllabus padh rahe ho…");
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (controller.signal.aborted) return;

      // The deterministic full parser: uncapped, hierarchy-preserving,
      // exact-only dedupe, unclear lines reported instead of guessed.
      const full = analyzeFullSyllabus({ syllabus: text, subject });
      if (!full.ok || full.totalTopics === 0) {
        throw new Error(full.error || "Could not extract topics from this syllabus.");
      }

      // Stage 2 — flatten units → topics for the rest of the app.
      setStage("Units aur topics bana rahe ho…");
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (controller.signal.aborted) return;

      const derived = syllabusToTopics(full);
      if (derived.length === 0) {
        throw new Error("Could not extract topics from this syllabus.");
      }

      const courseName = full.subject || subject || "Your course";
      setSyllabusAnalysis(full);
      setTopics(derived);
      setSubjectName(courseName);
      notify(
        `📄 ${full.totalUnits} unit · ${full.totalTopics} topics mile — rule-based parser se (koi AI key zaroori nahi).`,
      );
      // Step 1 done — topics are on the board. Search links deliberately WAIT
      // for the PYQ step so their order follows real exam importance, not guesses.
      searchStartedRef.current = false;
      matchedPlanRef.current = "";
      setPyqSkipped(false);
      setPhase("papers");
    } catch (err) {
      if (controller.signal.aborted) return;
      setPhase("idle");
      setFormError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setStage(null);
    }
  }, [subject, setExam, notify]);

  /** Builds search links for a single topic (used when a topic is un-ticked). */
  const matchTopic = useCallback(
    (topic: Topic) => {
      setResults((prev) => {
        const next = { ...prev };
        delete next[topic.id];
        return next;
      });

      try {
        const result = topicSearches({
          topic,
          subject: subjectName,
          language,
          limit: perTopic,
          examQuestions: pyqByTopic.get(topic.id)?.map((q) => q.text) ?? [],
        });
        setResults((prev) => ({ ...prev, [topic.id]: result }));
      } catch (err) {
        setResults((prev) => ({
          ...prev,
          [topic.id]: {
            topic,
            searches: [],
            queries: [],
            error: err instanceof Error ? err.message : "Search links could not be built.",
          },
        }));
      }
    },
    [language, subjectName, perTopic, pyqByTopic],
  );

  /** Tick/untick a topic. Unticking a skipped topic rebuilds its links. */
  const handleToggleStudied = useCallback(
    (title: string) => {
      const nowStudied = !isStudied(title);
      toggleStudied(title);
      if (nowStudied) return;

      const topic = topics.find((t) => t.title === title);
      const current = topic ? results[topic.id] : undefined;
      if (topic && (!current || current.skipped)) {
        void matchTopic(topic);
      }
    },
    [isStudied, toggleStudied, topics, results, matchTopic],
  );

  /** Re-builds only the search links, keeping the extracted topics intact. */
  const rematchVideos = useCallback(async () => {
    if (topics.length === 0) return;
    searchStartedRef.current = true;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setResults({});
    setPhase("matching");
    setFormError(null);
    await runMatching(topics, subjectName, controller.signal, language, perTopic, true);
    notify("Search links rebuilt with your current settings.");
  }, [topics, subjectName, language, perTopic, runMatching, notify]);

  /**
   * Step 2 finished — the PYQ plan exists, so the search links can finally be
   * built, in the plan's order (must-do first) and with the exam's own wording.
   *
   * Guarded by a signature of the plan's topic order rather than plan object
   * identity: changing the time budget rebuilds the plan, and a slider nudge
   * must not rebuild every link.
   */
  const handlePlanBuilt = useCallback(
    (plan: ExamPlanResponse) => {
      const must = plan.topics?.filter((t) => t.band === "must").length ?? 0;
      notify(`🎯 PYQ trend ready — ${must} must-do topics sabse upar.`);
      setPyqSkipped(false);

      const signature = (plan.topics ?? []).map((t) => t.topic.id).join(",");
      if (matchedPlanRef.current === signature) return;
      matchedPlanRef.current = signature;

      // Papers came AFTER a skip (links already built on syllabus alone):
      // re-build once with the exam's wording. Otherwise this plan is what
      // STARTS the build.
      if (searchStartedRef.current) {
        notify("🔁 Ab links dobara PYQ ki language me bana rahi hoon.");
        void rematchVideos();
      } else {
        void beginVideoSearch();
      }
    },
    [notify, rematchVideos, beginVideoSearch],
  );

  /** Fills the syllabus box from an uploaded file (or clears it when its
   *  last file was removed). The toast only fires when files were read. */
  const handleFileText = useCallback(
    (text: string, fileName: string) => {
      setSyllabus(text);
      setFormError(null);
      if (fileName) notify(`File padh li gaya: ${fileName}`);
    },
    [notify],
  );

  const handleFileError = useCallback((message: string) => setFormError(message), []);

  const resetAll = useCallback(() => {
    abortRef.current?.abort();
    searchStartedRef.current = false;
    matchedPlanRef.current = "";
    evidenceSigRef.current = "";
    setTopics([]);
    setResults({});
    setSubjectName("");
    setSyllabusAnalysis(null);
    setEvidence(null);
    setEvidenceError(null);
    setExamState(EMPTY_EXAM_STATE);
    setPyqSkipped(false);
    setPhase("idle");
    setFormError(null);
    setActiveId(null);
    setView("home");
    setAnalysisTab("overview");
    setExpandedUnits(new Set());
    // "Start over" also forgets the cached analysis — next load starts clean.
    clearAnalysis();
    clearCachedRecommendations();
  }, []);

  /* ----------------------- analysis cache (Phase 4) ----------------------- */

  /** Hydrate a previous analysis so a refresh never loses the work — and the
   *  SAME syllabus text is never analysed again (its result is the cache). */
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    const cached = loadAnalysis();
    if (!cached) return;

    setSyllabus(cached.syllabus);
    setSubject(cached.subject);
    setSubjectName(cached.subjectName);
    setSyllabusAnalysis(cached.analysis);
    setTopics(cached.topics);
    setPyqSkipped(cached.pyqSkipped);
    setExamState({
      papers: cached.exam.papers,
      questions: cached.exam.questions,
      parsedPapers: cached.exam.parsedPapers,
      plan: cached.exam.plan,
    });

    // Adopt the cached evidence (and its signature) so the count below does
    // not run again for the same questions.
    if (cached.evidence?.ok) {
      setEvidence(cached.evidence);
      evidenceSigRef.current =
        cached.exam.plan && cached.exam.questions.length > 0
          ? `${cached.exam.questions.map((item) => item.id).join(",")}|${cached.topics
              .map((item) => item.id)
              .join(",")}`
          : "";
    } else {
      evidenceSigRef.current = "";
    }

    // Restored phase is always "papers": the search LINKS are not persisted —
    // they rebuild exactly once below when this analysis had already built them.
    searchStartedRef.current = false;
    matchedPlanRef.current = "";
    setPhase("papers");
    if (cached.exam.plan || cached.pyqSkipped) restoreLinksRef.current = true;

    notify("♻️ Pichhla analysis wapas aa gaya — same syllabus dobara analyse nahi kiya.");
  }, [notify]);

  /** After a cache restore, rebuild the search links exactly once. */
  useEffect(() => {
    if (!restoreLinksRef.current) return;
    if (topics.length === 0) return;
    if (!exam.plan && !pyqSkipped) return;
    restoreLinksRef.current = false;
    void beginVideoSearch();
  }, [topics, exam.plan, pyqSkipped, beginVideoSearch]);

  /** Persist the analysis (debounced) so a refresh restores it as-is. */
  useEffect(() => {
    if (topics.length === 0 || !syllabusAnalysis?.ok) return;

    const payload = {
      v: 1 as const,
      syllabus,
      subject,
      subjectName,
      topics,
      analysis: syllabusAnalysis,
      pyqSkipped,
      exam: {
        papers: exam.papers,
        questions: exam.questions,
        parsedPapers: exam.parsedPapers,
        plan: exam.plan,
      },
      evidence,
    };

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveAnalysis(payload), 400);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [syllabus, subject, subjectName, topics, syllabusAnalysis, pyqSkipped, exam, evidence]);

  /* --------------------------- navigation ------------------------------ */
  /** Scrolls to an element after the view/tab has had a frame to render. */
  const scrollToEl = useCallback((id: string, delay = 70) => {
    window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, delay);
  }, []);

  const changeView = useCallback((next: AppView) => {
    setView(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  /** Opens the PYQ Analysis tab (the exam-priority step). */
  const goPyq = useCallback(() => {
    setView("home");
    setAnalysisTab("pyq");
    scrollToEl("analysis", 90);
  }, [scrollToEl]);

  /** Opens the Smart Exam Preparation tab. */
  const goSmart = useCallback(() => {
    setView("home");
    setAnalysisTab("smart");
    scrollToEl("analysis", 90);
  }, [scrollToEl]);

  /** Opens My Study Space, optionally jumping to one of its four panels. */
  const openSpace = useCallback(
    (anchor?: SpaceAnchor) => {
      setView("space");
      if (anchor) scrollToEl(anchor, 120);
      else window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [scrollToEl],
  );

  /** Dashboard feature-card actions — every one lands on a real flow. */
  const handleHeroAction = useCallback(
    (action: DashboardAction) => {
      switch (action) {
        case "syllabus":
          setView("home");
          scrollToEl("syllabus-form", 60);
          break;
        case "pyq":
          if (topics.length === 0) {
            notify("Pehle syllabus analyse karo — phir purane papers daalenge.");
            setView("home");
            scrollToEl("syllabus-form", 60);
            return;
          }
          goPyq();
          break;
        case "complete":
          if (!linksReady) {
            notify("Search links abhi nahi bane — pehle analysis complete karo.");
            return;
          }
          setView("playlists");
          setPlaylistTab("complete");
          window.scrollTo({ top: 0, behavior: "smooth" });
          break;
        case "smart":
          if (topics.length === 0) {
            notify("Pehle syllabus analyse karo — phir exam priority milegi.");
            setView("home");
            scrollToEl("syllabus-form", 60);
            return;
          }
          goSmart();
          break;
        case "space":
          openSpace();
          break;
      }
    },
    [topics.length, linksReady, notify, scrollToEl, goPyq, goSmart, openSpace],
  );

  /* --------------------------- topic accordion -------------------------- */
  const toggleUnit = useCallback((key: string) => {
    setExpandedUnits((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const expandAll = useCallback(
    () => setExpandedUnits(new Set(displayTopics.map(unitKeyOf))),
    [displayTopics],
  );
  const collapseAll = useCallback(() => setExpandedUnits(new Set()), []);

  /* --------------------------- scroll tracking --------------------------- */
  useEffect(() => {
    if (topics.length === 0) return;
    const panels = document.querySelectorAll<HTMLElement>("[data-topic-id]");
    if (panels.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          setActiveId(visible[0].target.getAttribute("data-topic-id"));
        }
      },
      { rootMargin: "-25% 0px -60% 0px", threshold: 0 },
    );

    panels.forEach((panel) => observer.observe(panel));
    return () => observer.disconnect();
    // Tabs and accordion expansion change which panels exist on screen.
  }, [topics, completed, view, analysisTab, expandedUnits]);

  /**
   * Jump to one topic: make sure its tab is open, its unit expanded, then
   * scroll. Works from the sidebar, the study order, playlists and progress —
   * even when the student is on a completely different view.
   */
  const jumpTo = useCallback(
    (id: string) => {
      const topic = topics.find((t) => t.id === id);
      const scrollToTopic = () => {
        document
          .getElementById(`topic-${id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      };

      if (topic) {
        const key = unitKeyOf(topic);
        setExpandedUnits((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
      }

      const onList =
        view === "home" &&
        (analysisTab === "complete" || analysisTab === "smart") &&
        document.getElementById(`topic-${id}`) !== null;

      if (onList) {
        window.setTimeout(scrollToTopic, 70);
      } else {
        setView("home");
        setAnalysisTab("complete");
        window.setTimeout(scrollToTopic, 170);
      }
      setActiveId(id);
    },
    [topics, view, analysisTab],
  );

  /* ------------------------------- exports ------------------------------- */
  const hasLinks = videoCount > 0;

  const handleCopy = useCallback(async () => {
    const ok = await copyText(buildMarkdown(subjectName, topics, results, isStudied));
    notify(ok ? "Study list copied to clipboard ✅" : "Could not copy — try the download button.");
  }, [subjectName, topics, results, isStudied, notify]);

  const handleDownloadMd = useCallback(() => {
    downloadFile(
      `${slugify(subjectName || "syllabus")}-study-list.md`,
      buildMarkdown(subjectName, topics, results, isStudied),
      "text/markdown;charset=utf-8",
    );
    notify("Markdown file downloaded.");
  }, [subjectName, topics, results, isStudied, notify]);

  const handleDownloadCsv = useCallback(() => {
    downloadFile(
      `${slugify(subjectName || "syllabus")}-study-list.csv`,
      buildCsv(topics, results, isStudied),
      "text/csv;charset=utf-8",
    );
    notify("CSV file downloaded.");
  }, [subjectName, topics, results, isStudied, notify]);

  /* ------------------------------ study plan ----------------------------- */
  const generatePlan = useCallback(async () => {
    const planTopics = topics.filter((t) => !isStudied(t.title));

    if (planTopics.length === 0) {
      notify(
        studiedCount > 0
          ? "Sab topics already studied — plan ki zaroorat nahi! 🎉"
          : "Pehle syllabus analyse karo, phir plan banega.",
      );
      return;
    }

    // Each day's video entry is the topic's own YouTube search link — the
    // plan never claims a specific video was watched or recommended.
    const picks = planTopics.map((t) => {
      const search = results[t.id]?.searches?.[0];
      return {
        title: t.title,
        minutes: t.estimatedMinutes,
        importance: t.importance,
        videoTitle: search ? `YouTube search: ${search.query}` : undefined,
        videoUrl: search?.url,
      };
    });

    setPlan({ open: true, loading: true, plan: null, error: null });
    const totalDays = Math.max(3, Math.min(30, Math.ceil(picks.length * 0.8)));

    try {
      const data: PlanResponse = await buildPlan({
        subject: subjectName || "Your course",
        picks,
        totalDays,
      });
      if (!data.ok || !data.days) throw new Error(data.error || "Could not build the study plan.");
      setPlan({ open: true, loading: false, plan: data, error: null });
    } catch (err) {
      setPlan({
        open: true,
        loading: false,
        plan: null,
        error: err instanceof Error ? err.message : "Could not build the study plan.",
      });
    }
  }, [topics, results, subjectName, isStudied, studiedCount, notify]);

  /* --------------------------------- UI ---------------------------------- */
  /** Which of the three steps the student is looking at right now. */
  const step: 1 | 2 | 3 = topics.length === 0 ? 1 : phase === "papers" ? 2 : 3;

  const bandCounts = useMemo(() => {
    let must = 0;
    let should = 0;
    let ifTime = 0;
    for (const band of bandByTopic.values()) {
      if (band === "must") must++;
      else if (band === "should") should++;
      else ifTime++;
    }
    return { must, should, ifTime };
  }, [bandByTopic]);

  /** Complete Syllabus Preparation progress, 0-100 (same ticks, one number). */
  const progressPct = useMemo(
    () => (topics.length > 0 ? Math.round((studiedCount / topics.length) * 100) : 0),
    [studiedCount, topics.length],
  );

  /** Per-unit tick counts for the Complete Syllabus accordion headers. */
  const unitProgress = useMemo(() => {
    const map = new Map<string, { done: number; total: number }>();
    for (const topic of topics) {
      const key = unitKeyOf(topic);
      const row = map.get(key) ?? { done: 0, total: 0 };
      row.total += 1;
      if (isStudied(topic.title)) row.done += 1;
      map.set(key, row);
    }
    return map;
  }, [topics, isStudied]);

  /** One-line PYQ evidence summary for the dashboard — real counts only. */
  const evidenceSummary = useMemo(() => {
    if (!evidence?.ok) return null;
    const parts = [
      `${evidence.papersAnalyzed} paper${evidence.papersAnalyzed === 1 ? "" : "s"} · ${evidence.questionsAnalyzed} questions`,
      `${evidence.exactCount} exact repeats · ${evidence.similarCount} similar concepts`,
      `${evidence.topicFrequency.length} topics covered`,
    ];
    if (evidence.crossPaperTopics.length > 0) {
      parts.push(`${evidence.crossPaperTopics.length} asked in 2+ papers`);
    }
    return parts.join(" · ");
  }, [evidence]);

  /** The "important" tab used to filter topics — Phase 4 keeps EVERY topic
   *  visible in both preparation modes and groups instead of hiding. */

  /** Shown where links do not exist yet — never fake skeletons forever. */
  const linksHint = (
    <div className="card p-5 text-center">
      <p className="text-sm leading-relaxed text-[var(--muted)]">
        Search links abhi bane nahi — PYQ step complete karo (ya skip karo), phir har topic ke
        links yahan mil jayenge.
      </p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={goPyq} className="btn-primary px-4 py-2 text-xs">
          PYQ Analysis par jao →
        </button>
        {phase === "papers" && !exam.plan && (
          <button type="button" onClick={skipPapers} className="btn-ghost px-4 py-2 text-xs">
            Skip karo → links banao
          </button>
        )}
      </div>
    </div>
  );

  const renderTopicPanel = (topic: Topic, index: number) => (
    <TopicPanel
      key={topic.id}
      topic={topic}
      index={index}
      result={results[topic.id]}
      studied={isStudied(topic.title)}
      subject={subjectName}
      syllabus={syllabus}
      examEntry={examByTopic.get(topic.id)}
      band={bandByTopic.get(topic.id) ?? "should"}
      pyqQuestions={pyqByTopic.get(topic.id)}
      onToggleStudied={() => handleToggleStudied(topic.title)}
    />
  );

  const playlistBoard = (
    <PlaylistBoard
      topics={topics}
      subtopicsByTopicId={subtopicsByTopicId}
      bandFor={(topic) => bandByTopic.get(topic.id) ?? "should"}
      priority={priority}
      completePlan={completePlan}
      smartPlan={smartPlan}
      progress={playlistProgress}
      active={playlistTab}
      onChange={setPlaylistTab}
      onJump={jumpTo}
    />
  );

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_88%,transparent)] backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => changeView("home")}
            className="flex items-center gap-2.5 text-left"
          >
            <span
              className="grid h-9 w-9 place-items-center rounded-xl text-white"
              style={{ background: "linear-gradient(135deg, var(--brand), var(--brand-2))" }}
            >
              <GraduationIcon width={19} height={19} />
            </span>
            <div>
              <p className="text-[0.95rem] font-extrabold leading-none">ExamSmasher</p>
              <p className="mt-0.5 hidden text-[0.68rem] text-[var(--muted)] sm:block">
                Past papers → exam priority → notes, PYQs & search links
              </p>
            </div>
          </button>

          <SiteNav view={view} onChange={changeView} />

          <div className="flex items-center gap-2">
            <AiStatusChip />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-24 pt-8 sm:px-6 md:pb-20">
        {view === "home" && (
          <>
            <StepsBar current={step} />

            <HeroDashboard onAction={handleHeroAction} onSpace={openSpace} />

            <div id="syllabus-form" className="scroll-mt-24">
              <SyllabusForm
                syllabus={syllabus}
                subject={subject}
                onSubjectChange={setSubject}
                language={language}
                onLanguageChange={setLanguage}
                perTopic={perTopic}
                onPerTopicChange={setPerTopic}
                onStart={startAnalysis}
                onReset={resetAll}
                onLoadSample={() => {
                  setSyllabus(SAMPLE_SYLLABUS);
                  setSubject(SAMPLE_SUBJECT);
                  notify("Sample syllabus loaded — hit Analyse!");
                }}
                onFileText={handleFileText}
                onFileError={handleFileError}
                busy={busy}
                stage={stage}
                hasResults={topics.length > 0}
                error={formError}
              />
            </div>

            {/* Analysis — one tabbed workspace instead of one long page */}
            {topics.length > 0 && (
              <section id="analysis" className="mt-8 scroll-mt-24">
                <TabBar
                  ariaLabel="Analysis sections"
                  active={analysisTab}
                  onChange={(id) => setAnalysisTab(id as AnalysisTab)}
                  tabs={[
                    { id: "overview", label: "Overview" },
                    { id: "complete", label: "Complete Syllabus", badge: String(topics.length) },
                    {
                      id: "smart",
                      label: "Smart Exam Preparation",
                      ...(priority.hasPapers ? { badge: `${priority.counts.high} high` } : {}),
                    },
                    {
                      id: "pyq",
                      label: "PYQ Analysis",
                      ...(exam.papers.length > 0 ? { badge: String(exam.papers.length) } : {}),
                    },
                    { id: "playlists", label: "Video Playlists" },
                  ]}
                />

                <div className="mt-3">
                  {analysisTab === "overview" && (
                    <OverviewPanel
                      subject={subjectName}
                      stats={{
                        topics: topics.length,
                        units: syllabusAnalysis?.totalUnits ?? 0,
                        must: bandCounts.must,
                        should: bandCounts.should,
                        ifTime: bandCounts.ifTime,
                        pyqCovered,
                        links: videoCount,
                        matched: matchedTopics,
                        papers: exam.papers.length,
                        studied: studiedCount,
                      }}
                      progressPct={progressPct}
                      priorityCounts={priority.hasPapers ? priority.counts : null}
                      evidenceSummary={evidenceSummary}
                      phase={phase}
                      hasPlan={Boolean(exam.plan)}
                      pyqSkipped={pyqSkipped}
                      allStudied={allStudied}
                      hasLinks={hasLinks}
                      onTodo={() => setTodoOpen(true)}
                      onRematch={rematchVideos}
                      onCopy={handleCopy}
                      onDownloadMd={handleDownloadMd}
                      onDownloadCsv={handleDownloadCsv}
                      onResetProgress={() => {
                        clearStudied();
                        playlistProgress.clearAll();
                        notify("Progress reset — sab topics dobara pending.");
                      }}
                      onGeneratePlan={generatePlan}
                      onGoPyq={goPyq}
                      onSkip={skipPapers}
                    />
                  )}

                  {/* Complete Syllabus — every unit/topic, tick progress.
                      Works WITHOUT PYQ papers (that is the whole point). */}
                  {analysisTab === "complete" &&
                    (syllabusAnalysis ? (
                      <div className="space-y-3">
                        <CompleteSyllabusPanel
                          subject={subjectName}
                          analysis={syllabusAnalysis}
                          topics={topics}
                          studiedCount={studiedCount}
                          isStudied={isStudied}
                          onResetProgress={() => {
                            clearStudied();
                            playlistProgress.clearAll();
                            notify("Progress reset — sab topics dobara pending.");
                          }}
                        />

                        <div className="grid items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
                          <TopicSidebar
                            topics={topics}
                            results={results}
                            activeId={activeId}
                            onJump={jumpTo}
                            phase={phase}
                            completed={completed}
                            videoCount={videoCount}
                            studiedCount={studiedCount}
                            isStudied={isStudied}
                            onToggleStudied={handleToggleStudied}
                            bandFor={(topic) => bandByTopic.get(topic.id) ?? "should"}
                            hideBand
                          />

                          <TopicAccordion
                            topics={topics}
                            expanded={expandedUnits}
                            onToggleUnit={toggleUnit}
                            onExpandAll={expandAll}
                            onCollapseAll={collapseAll}
                            renderTopic={renderTopicPanel}
                            unitProgress={(key) => unitProgress.get(key) ?? null}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="card p-5 text-center text-sm text-[var(--muted)]">
                        Complete Syllabus abhi khali hai — syllabus analyse karte hi poora unit-wise
                        structure yahan milega.
                      </div>
                    ))}

                  {/* Smart Exam Preparation — High/Medium/Low with evidence. */}
                  {analysisTab === "smart" && (
                    <SmartExamPanel
                      priority={priority}
                      topics={topics}
                      plan={exam.plan}
                      onGoUpload={goPyq}
                    />
                  )}

                  {analysisTab === "pyq" && (
                    <div className="space-y-3">
                      <StepHeading
                        n={2}
                        title="PYQ importance — kaunsa topic kitna important hai"
                        subtitle="Purane papers daalo: har topic par Must / Might / Can skip ka asli trend, aur har sawaal ka uska place. Papers nahi hain toh skip bhi kar sakte ho."
                        done={Boolean(exam.plan)}
                      />

                      <ExamMode
                        topics={topics}
                        subject={subjectName}
                        exam={exam}
                        setExam={setExam}
                        onPlanBuilt={handlePlanBuilt}
                        onJumpToTopic={jumpTo}
                        onOpenSpace={() => changeView("space")}
                      />

                      {phase === "papers" && !exam.plan && (
                        <div className="card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                          <p className="text-xs leading-relaxed text-[var(--muted)]">
                            Purane papers nahi hain? Koi baat nahi — importance syllabus se nikaal ke
                            search links bana deta hoon.
                          </p>
                          <button
                            type="button"
                            onClick={skipPapers}
                            className="btn-primary shrink-0 px-4 py-2 text-xs"
                          >
                            Skip karo → seedha search links banao →
                          </button>
                        </div>
                      )}

                      {pyqSkipped && !exam.plan && phase !== "papers" && (
                        <p className="text-xs leading-relaxed text-[var(--muted)]">
                          ⏭️ PYQ step chhod diya — Must/Might/Can skip ke tags syllabus importance
                          se bané hain. Upar papers daal kar kabhi bhi asli trend paa sakte ho.
                        </p>
                      )}

                      {/* Evidence counted from the actual uploaded papers */}
                      {(evidence || evidenceLoading || evidenceError || exam.questions.length > 0) && (
                        <PyqEvidencePanel
                          evidence={evidence}
                          loading={evidenceLoading}
                          error={evidenceError}
                          progress={evidenceProgress}
                          onRetry={retryEvidence}
                          topicTitle={(id) => topics.find((t) => t.id === id)?.title ?? id}
                          topicUnit={(id) => topics.find((t) => t.id === id)?.chapter ?? "General"}
                        />
                      )}
                    </div>
                  )}

                  {analysisTab === "playlists" && (linksReady ? playlistBoard : linksHint)}
                </div>
              </section>
            )}
          </>
        )}

        {view === "space" && (
          <StudySpacePanel
            hasTopics={topics.length > 0}
            topics={displayTopics}
            results={results}
            pyqByTopic={pyqByTopic}
            subject={subjectName}
            syllabus={syllabus}
            questions={exam.questions}
            plan={exam.plan}
            stats={{
              topics: topics.length,
              studied: studiedCount,
              must: bandCounts.must,
              links: videoCount,
            }}
            onJump={jumpTo}
            onHome={() => changeView("home")}
            onGoPyq={goPyq}
          />
        )}

        {view === "playlists" && (
          <div className="space-y-4">
            <div>
              <h1 className="text-xl font-extrabold">My Playlists</h1>
              <p className="mt-0.5 text-sm text-[var(--muted)]">
                Do playlist — poore syllabus ke asli video suggestions + coverage %, ya exam
                priority ke hisaab se.
              </p>
            </div>
            {linksReady ? (
              playlistBoard
            ) : (
              <div className="card p-5 text-center">
                <p className="text-sm leading-relaxed text-[var(--muted)]">
                  Search links abhi nahi bane — pehle syllabus analyse karo, phir dono playlists
                  yahan mil jayengi.
                </p>
                <button
                  type="button"
                  onClick={() => changeView("home")}
                  className="btn-primary mt-3 px-4 py-2 text-xs"
                >
                  Home par jao →
                </button>
              </div>
            )}
          </div>
        )}

        {view === "settings" && (
          <SettingsPanel
            language={language}
            onLanguageChange={setLanguage}
            perTopic={perTopic}
            onPerTopicChange={setPerTopic}
          />
        )}
      </main>

      <footer className="border-t border-[var(--line)] py-6 text-center text-xs text-[var(--muted)]">
        ExamSmasher · trends from YOUR real papers · no sign-in, no API key needed from you ·
        priority is computed from actual questions, not guessed.
      </footer>

      <StudyPlanModal
        open={plan.open}
        loading={plan.loading}
        plan={plan.plan}
        error={plan.error}
        onClose={() => setPlan((p) => ({ ...p, open: false }))}
        onRegenerate={generatePlan}
      />

      <TodoPanel open={todoOpen} onClose={() => setTodoOpen(false)} />

      <ChatWidget
        subject={subjectName}
        topics={topics}
        syllabus={syllabus.slice(0, 3000)}
        pastQuestions={exam.plan?.topics?.flatMap((t) => t.signal.questions) ?? []}
      />

      {toast && (
        <div className="pointer-events-none fixed bottom-24 left-1/2 z-50 -translate-x-1/2 sm:bottom-6">
          <div className="card animate-fade-up px-4 py-2.5 text-sm font-semibold">{toast}</div>
        </div>
      )}

      <BottomNav view={view} onChange={changeView} />
    </>
  );
}

/**
 * The whole site is these three steps. The bar sits above everything so the
 * student always knows where they are and what comes next — this is what
 * replaces the old wall of panels.
 */
function StepsBar({ current }: { current: 1 | 2 | 3 }) {
  const steps = [
    { n: 1 as const, label: "Syllabus" },
    { n: 2 as const, label: "PYQ importance" },
    { n: 3 as const, label: "Links + notes" },
  ];

  return (
    <div className="card mb-6 flex flex-wrap items-center gap-1.5 px-4 py-3">
      {steps.map((s, index) => (
        <Fragment key={s.n}>
          {index > 0 && <span className="px-1 text-xs text-[var(--muted)]">→</span>}
          <span
            className="flex items-center gap-2 rounded-xl px-2.5 py-1 text-xs font-bold"
            style={
              current === s.n
                ? {
                    background: "color-mix(in srgb, var(--brand) 12%, transparent)",
                    color: "var(--brand)",
                  }
                : { color: current > s.n ? "var(--good)" : "var(--muted)" }
            }
          >
            <span
              className="grid h-5 w-5 place-items-center rounded-full text-[0.66rem] font-extrabold"
              style={{
                background:
                  current > s.n
                    ? "var(--good)"
                    : current === s.n
                      ? "var(--brand)"
                      : "var(--surface-2)",
                color: current >= s.n ? "#fff" : "var(--muted)",
              }}
            >
              {current > s.n ? "✓" : s.n}
            </span>
            {s.label}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

/** Heading for one step inside the results flow. */
function StepHeading({
  n,
  title,
  subtitle,
  done,
}: {
  n: number;
  title: string;
  subtitle?: string;
  done?: boolean;
}) {
  return (
    <div className="mb-3 flex items-start gap-3">
      <span
        className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl text-sm font-extrabold text-white"
        style={{
          background: done
            ? "var(--good)"
            : "linear-gradient(135deg, var(--brand), var(--brand-2))",
        }}
      >
        {done ? <CheckIcon width={16} height={16} /> : n}
      </span>
      <div className="min-w-0">
        <p className="text-[1.02rem] font-extrabold leading-tight">
          Step {n} · {title}
        </p>
        {subtitle && (
          <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "examsmasher"
  );
}
