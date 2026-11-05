"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CalendarIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  GraduationIcon,
  ListIcon,
  RefreshIcon,
} from "@/components/Icons";
import { AiStatusChip } from "@/components/AiStatusChip";
import { ChatWidget } from "@/components/ChatWidget";
import { CoverageReport } from "@/components/CoverageReport";
import { ExamMode, EMPTY_EXAM_STATE, type ExamState } from "@/components/ExamMode";
import { FullNotesPanel } from "@/components/FullNotesPanel";
import { StudyPlanModal } from "@/components/StudyPlanModal";
import { SyllabusForm } from "@/components/SyllabusForm";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TodoPanel } from "@/components/TodoPanel";
import { TopicPanel } from "@/components/TopicPanel";
import { TopicSidebar } from "@/components/TopicSidebar";
import { useStudiedTopics } from "@/hooks/useStudiedTopics";
import { primeBrowserAi } from "@/lib/ai/run";
import { analyzeSyllabus, buildPlan, topicSearches } from "@/lib/engine";
import { buildCsv, buildMarkdown, copyText, downloadFile } from "@/lib/exporters";
import { SAMPLE_SUBJECT, SAMPLE_SYLLABUS } from "@/lib/sample";
import type {
  AnalyzeResponse,
  ExamPlanResponse,
  ExamTopic,
  PlanResponse,
  PyqQuestion,
  Topic,
  TopicResult,
} from "@/lib/types";

type Phase = "idle" | "analyzing" | "papers" | "matching" | "done";

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

  const studiedApi = useStudiedTopics();
  const { isStudied, toggle: toggleStudied, clearAll: clearStudied } = studiedApi;

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
  const startAnalysis = useCallback(async () => {
    if (syllabus.trim().length < 20) {
      setFormError("Paste at least a few lines of your syllabus so topics can be extracted.");
      return;
    }
    if (syllabus.length > 24000) {
      setFormError("Syllabus is too long — trim it under 24,000 characters.");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setFormError(null);
    setResults({});
    setTopics([]);
    setActiveId(null);
    // Keep the uploaded PAPERS (re-OCR is expensive) but drop derived state —
    // new topics mean the plan and the topic mapping must be rebuilt.
    setExam({ questions: [], parsedPapers: [], plan: null });
    setPhase("analyzing");

    try {
      // Runs in this browser: rule-based parser first, the optional model
      // only when it has genuinely loaded. No key, no network call.
      const data: AnalyzeResponse = await analyzeSyllabus({ syllabus, subject });

      if (!data.ok || !data.topics?.length) {
        throw new Error(data.error || "Could not extract topics from this syllabus.");
      }

      const courseName = data.subject || subject || "Your course";
      setTopics(data.topics);
      setSubjectName(courseName);
      if (data.truncated) {
        notify("Syllabus was large — showing the top topics first.");
      }
      notify(
        data.source === "ai"
          ? "🧠 Browser AI model ne syllabus split kiya."
          : "📄 Syllabus split by the rule-based engine (browser AI optional).",
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
    }
  }, [syllabus, subject, setExam, notify]);

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

  /** Fills the syllabus box from an uploaded file. */
  const handleFileText = useCallback((text: string, fileName: string) => {
    setSyllabus(text);
    setFormError(null);
    notify(`File padh li gaya: ${fileName}`);
  }, [notify]);

  const handleFileError = useCallback((message: string) => setFormError(message), []);

  const resetAll = useCallback(() => {
    abortRef.current?.abort();
    searchStartedRef.current = false;
    matchedPlanRef.current = "";
    setTopics([]);
    setResults({});
    setSubjectName("");
    setExamState(EMPTY_EXAM_STATE);
    setPyqSkipped(false);
    setPhase("idle");
    setFormError(null);
    setActiveId(null);
  }, []);

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
  }, [topics, completed]);

  const jumpTo = useCallback((id: string) => {
    document.getElementById(`topic-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveId(id);
  }, []);

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
  const mustCount = useMemo(
    () => [...bandByTopic.values()].filter((b) => b === "must").length,
    [bandByTopic],
  );

  return (
    <>
      <header className="sticky top-0 z-30 border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_88%,transparent)] backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span
              className="grid h-9 w-9 place-items-center rounded-xl text-white"
              style={{ background: "linear-gradient(135deg, var(--brand), var(--brand-2))" }}
            >
              <GraduationIcon width={19} height={19} />
            </span>
            <div>
              <p className="text-[0.95rem] font-extrabold leading-none">ExamSmasher</p>
              <p className="mt-0.5 text-[0.68rem] text-[var(--muted)]">
                Past papers → exam priority → notes, PYQs & search links
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <AiStatusChip />
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-20 pt-8 sm:px-6">
        <StepsBar current={step} />

        {/* Hero — only before the first analysis */}
        {phase === "idle" && topics.length === 0 && (
          <section className="mb-8 text-center">
            <h1 className="mx-auto max-w-3xl text-3xl font-extrabold leading-tight sm:text-5xl">
              Kam time me zyada <span className="gradient-text">marks</span> — teen step me.
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-[var(--muted)] sm:text-base">
              Syllabus paste karo, apne <strong className="text-[var(--text)]">purane papers</strong>{" "}
              daalo (optional hai), aur app khud batayega — kaunsa topic{" "}
              <strong className="text-[var(--text)]">Must</strong> hai, kaunsa{" "}
              <strong className="text-[var(--text)]">Can skip</strong> — aur usi order me har topic
              ke YouTube search links, notes aur solved PYQs de dega. Bas tu padh.
            </p>

            <div className="mx-auto mt-7 grid max-w-4xl gap-3 sm:grid-cols-3">
              {[
                {
                  icon: <span className="text-lg">📝</span>,
                  title: "1 · Syllabus daalo",
                  body: "Apna syllabus paste karo — browser AI ya rule engine har unit ke alag study topics banayega.",
                },
                {
                  icon: <span className="text-lg">🎯</span>,
                  title: "2 · PYQ se importance",
                  body: "Purane papers daalo toh har topic par Must / Might / Can skip ka tag lagega — asli trend se, guess se nahi. Skip bhi kar sakte ho.",
                },
                {
                  icon: <span className="text-lg">📚</span>,
                  title: "3 · Links, notes, jawab",
                  body: "Har topic ke YouTube search links (important pehle), poore syllabus ke notes, aur har PYQ sawaal ka jawab uske neeche hi.",
                },
              ].map((feature) => (
                <div key={feature.title} className="card p-4 text-left">
                  <span
                    className="mb-2 grid h-9 w-9 place-items-center rounded-xl text-white"
                    style={{ background: "linear-gradient(135deg, var(--brand), var(--brand-2))" }}
                  >
                    {feature.icon}
                  </span>
                  <p className="text-sm font-bold">{feature.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{feature.body}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        <SyllabusForm
          syllabus={syllabus}
          onSyllabusChange={setSyllabus}
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
          hasResults={topics.length > 0}
          error={formError}
        />

        {/* Results */}
        {topics.length > 0 && (
          <>
            {/* Step 2 — real papers decide what matters. Videos wait for it. */}
            <section className="mt-8">
              <StepHeading
                n={2}
                title="PYQ importance — kaunsa topic kitna important hai"
                subtitle="Purane papers daalo: har sawaal ka jawab uske neeche + Easy/Medium/Hard tag, aur har topic par Must / Might / Can skip. Papers nahi hain toh skip bhi kar sakte ho."
                done={Boolean(exam.plan)}
              />

              <ExamMode
                topics={topics}
                subject={subjectName}
                syllabus={syllabus}
                exam={exam}
                setExam={setExam}
                onPlanBuilt={handlePlanBuilt}
                onJumpToTopic={jumpTo}
              />

              {phase === "papers" && !exam.plan && (
                <div className="card mt-3 flex flex-wrap items-center justify-between gap-3 px-4 py-3">
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
                <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
                  ⏭️ PYQ step chhod diya — Must/Might/Can skip ke tags syllabus importance se
                  bané hain. Upar papers daal kar kabhi bhi asli trend paa sakte ho.
                </p>
              )}
            </section>

            {/* Step 3 — everything to actually study with, in the order above */}
            {(phase === "matching" || phase === "done") && (
              <section className="mt-8">
                <StepHeading
                  n={3}
                  title="Links, notes & practice"
                  subtitle="Must-do topics pehle — har topic ke YouTube search links, poore syllabus ke notes aur PYQ practice, sab isi page par."
                  done={phase === "done"}
                />

                <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                    <Stat label="Topics" value={String(topics.length)} />
                    <Stat label="Must-do" value={String(mustCount)} accent />
                    <Stat
                      label="Topics with real PYQs"
                      value={exam.plan ? `${pyqCovered}/${topics.length}` : "—"}
                      accent
                    />
                    <Stat label="Search links" value={String(videoCount)} />
                    {exam.papers.length > 0 && (
                      <Stat label="Past papers" value={String(exam.papers.length)} accent />
                    )}
                    <Stat
                      label="Studied"
                      value={`${studiedCount}/${topics.length}`}
                      accent
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setTodoOpen(true)}
                      className="btn-ghost flex items-center gap-1.5 px-3 py-2 text-xs"
                      title="Your personal to-do list"
                    >
                      <ListIcon width={14} height={14} /> To-do
                    </button>
                    <button
                      type="button"
                      onClick={rematchVideos}
                      disabled={phase === "matching"}
                      className="btn-ghost flex items-center gap-1.5 px-3 py-2 text-xs"
                      title="Rebuild the search links (studied topics are skipped)"
                    >
                      <RefreshIcon width={14} height={14} /> Re-match
                    </button>

                    {/* One Export menu instead of three loose buttons */}
                    <details className="relative">
                      <summary className="btn-ghost flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-xs [&::-webkit-details-marker]:hidden">
                        <DownloadIcon width={14} height={14} /> Export ▾
                      </summary>
                      <div
                        className="absolute right-0 z-20 mt-1.5 w-44 rounded-xl border p-1"
                        style={{
                          background: "var(--surface)",
                          borderColor: "var(--line)",
                          boxShadow: "var(--shadow-card)",
                        }}
                      >
                        {[
                          {
                            label: "Copy list",
                            icon: <CopyIcon width={13} height={13} />,
                            onClick: handleCopy,
                            disabled: !hasLinks,
                          },
                          {
                            label: "Markdown (.md)",
                            icon: <DownloadIcon width={13} height={13} />,
                            onClick: handleDownloadMd,
                            disabled: !hasLinks,
                          },
                          {
                            label: "CSV",
                            icon: <DownloadIcon width={13} height={13} />,
                            onClick: handleDownloadCsv,
                            disabled: !hasLinks,
                          },
                          ...(studiedCount > 0
                            ? [
                                {
                                  label: "Reset progress",
                                  icon: <CheckIcon width={13} height={13} />,
                                  onClick: () => {
                                    clearStudied();
                                    notify("Progress reset — sab topics dobara pending.");
                                  },
                                  disabled: false,
                                },
                              ]
                            : []),
                        ].map((item) => (
                          <button
                            key={item.label}
                            type="button"
                            onClick={item.onClick}
                            disabled={item.disabled}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold transition-colors hover:bg-[var(--surface-2)] disabled:opacity-50"
                          >
                            {item.icon} {item.label}
                          </button>
                        ))}
                      </div>
                    </details>

                    <button
                      type="button"
                      onClick={generatePlan}
                      disabled={phase === "matching" || topics.length === 0}
                      className="btn-primary flex items-center gap-1.5 px-3.5 py-2 text-xs"
                    >
                      <CalendarIcon width={14} height={14} /> Study plan
                    </button>
                  </div>
                </div>

                {/* Whole syllabus as one long document — read it like a textbook */}
                <FullNotesPanel syllabus={syllabus} subject={subjectName} topics={topics} />

                <div className="mt-6 grid items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
                  <TopicSidebar
                    topics={displayTopics}
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
                  />

                  <div className="space-y-10">
                    {displayTopics.map((topic, index) => (
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
                    ))}

                    {phase === "done" && (
                      <div className="card p-5 text-center">
                        {allStudied ? (
                          <>
                            <p className="text-sm font-bold">🎉 Poori syllabus cover ho gayi!</p>
                            <p className="mt-1 text-xs text-[var(--muted)]">
                              Sab {topics.length} topics studied — ab revision aur practice pe
                              focus karo.
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="text-sm font-bold">
                              🎉 Analysis complete — {matchedTopics}/{topics.length} topics par
                              search links ban gaye.
                            </p>
                            <p className="mt-1 text-xs text-[var(--muted)]">
                              {studiedCount > 0
                                ? `${topics.length - studiedCount} topics baaki · padhte jao aur tick karte jao.`
                                : "Padhna shuru karo — har topic par tick lagate jao, progress save rehta hai."}
                            </p>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Honest gap list — which topics your papers never asked about */}
                {phase === "done" && (
                  <CoverageReport
                    topics={displayTopics}
                    results={results}
                    pyqByTopic={pyqByTopic}
                    onJumpToTopic={jumpTo}
                  />
                )}
              </section>
            )}
          </>
        )}
      </main>

      <footer className="border-t border-[var(--line)] py-6 text-center text-xs text-[var(--muted)]">
        ExamSmasher · trends from YOUR real papers · runs in your browser with no API keys ·
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
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
          <div className="card animate-fade-up px-4 py-2.5 text-sm font-semibold">{toast}</div>
        </div>
      )}
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-[0.68rem] uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p
        className="text-sm font-extrabold"
        style={accent ? { color: "var(--brand)" } : undefined}
      >
        {value}
      </p>
    </div>
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
