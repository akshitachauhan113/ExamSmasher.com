"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CalendarIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  GraduationIcon,
  KeyIcon,
  ListIcon,
  RefreshIcon,
} from "@/components/Icons";
import { ChatWidget } from "@/components/ChatWidget";
import { CoverageReport } from "@/components/CoverageReport";
import { ExamMode, EMPTY_EXAM_STATE, type ExamState } from "@/components/ExamMode";
import { FullNotesPanel } from "@/components/FullNotesPanel";
import { PlaylistBanner } from "@/components/PlaylistBanner";
import { SetupBanner } from "@/components/SetupBanner";
import { StudyPlanModal } from "@/components/StudyPlanModal";
import { KeysModal } from "@/components/KeysModal";
import { SyllabusForm } from "@/components/SyllabusForm";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TodoPanel } from "@/components/TodoPanel";
import { TopicPanel } from "@/components/TopicPanel";
import { TopicSidebar } from "@/components/TopicSidebar";
import { VideoPlayerModal, type PlayerVideo } from "@/components/VideoPlayerModal";
import { useStudiedTopics } from "@/hooks/useStudiedTopics";
import {
  buildCsv,
  buildMarkdown,
  copyText,
  downloadFile,
} from "@/lib/exporters";
import { formatMinutes, videoUrl } from "@/lib/format";
import { coverageMap } from "@/lib/playlists";
import { SAMPLE_SUBJECT, SAMPLE_SYLLABUS } from "@/lib/sample";
import type {
  AnalyzeResponse,
  CoursePlaylist,
  ExamPlanResponse,
  ExamTopic,
  HealthResponse,
  PlanResponse,
  PlaylistResponse,
  PyqQuestion,
  Topic,
  TopicResult,
  VideosResponse,
} from "@/lib/types";

type Phase = "idle" | "analyzing" | "matching" | "done";

interface PlanState {
  open: boolean;
  loading: boolean;
  plan: PlanResponse | null;
  error: string | null;
}

export default function Home() {
  /* ------------------------------- setup ------------------------------- */
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [keysOpen, setKeysOpen] = useState(false);
  const refreshHealth = useCallback(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((data: HealthResponse) => setHealth(data))
      .catch(() => setHealth(null));
  }, []);
  useEffect(() => {
    refreshHealth();
  }, [refreshHealth]);

  /* -------------------------------- form -------------------------------- */
  const [syllabus, setSyllabus] = useState("");
  const [subject, setSubject] = useState("");
  const [language, setLanguage] = useState("hinglish");
  // Default to 6: more videos per topic costs no extra search quota (one
  // videos.list call already returns 50 ids), and the student asked for depth.
  const [perTopic, setPerTopic] = useState(6);

  /* ------------------------------- results ------------------------------ */
  const [phase, setPhase] = useState<Phase>("idle");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [subjectName, setSubjectName] = useState("");
  const [results, setResults] = useState<Record<string, TopicResult>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [player, setPlayer] = useState<PlayerVideo | null>(null);
  /** The verified full-course playlist covering the biggest share of syllabus. */
  const [playlist, setPlaylist] = useState<CoursePlaylist | null>(null);
  const [playlistLoading, setPlaylistLoading] = useState(false);
  /** Exam Mode output — priority plan built from the student's real papers.
   *  Held in the page so a re-analysis does not wipe uploaded papers. */
  const [exam, setExamState] = useState<ExamState>(EMPTY_EXAM_STATE);

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
  const pendingTopics = useMemo(
    () => topics.filter((t) => !isStudied(t.title)),
    [topics, isStudied],
  );
  const matchedTopics = useMemo(
    () => topics.filter((t) => (results[t.id]?.videos?.length ?? 0) > 0).length,
    [topics, results],
  );
  /**
   * Honest syllabus coverage: a topic only counts as covered when it has a
   * video we would actually recommend (top score >= 55). A panel where search
   * technically returned something weak is not real coverage.
   */
  const coveragePercent = useMemo(() => {
    if (topics.length === 0) return 0;
    const covered = topics.filter((t) => (results[t.id]?.videos?.[0]?.score ?? 0) >= 55).length;
    return Math.round((covered / topics.length) * 100);
  }, [topics, results]);
  const videoCount = useMemo(
    () => Object.values(results).reduce((sum, r) => sum + r.videos.length, 0),
    [results],
  );
  const watchSeconds = useMemo(
    () =>
      pendingTopics.reduce(
        (sum, t) => sum + (results[t.id]?.videos?.[0]?.video.durationSeconds ?? 0),
        0,
      ),
    [pendingTopics, results],
  );
  const allStudied = topics.length > 0 && studiedCount === topics.length;
  const busy = phase === "analyzing" || phase === "matching";

  /**
   * Exam Mode rewrites the study order: once the plan exists, must-do topics
   * come first instead of syllabus order. Same topics, same ids — just ranked
   * by how much they are actually worth per minute spent.
   */
  const displayTopics = useMemo<Topic[]>(
    () => (exam.plan?.topics?.length ? exam.plan.topics.map((e) => e.topic) : topics),
    [exam.plan, topics],
  );

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
   * mapping happens server-side inside /api/examplan, and the plan's
   * `signal.questions` are the only client-side copy carrying `topicId`.
   * Reading `exam.questions` here would silently produce an empty map and the
   * PYQ practice panel would never render.
   */
  const pyqByTopic = useMemo(() => {
    const map = new Map<string, PyqQuestion[]>();
    for (const entry of exam.plan?.topics ?? []) {
      const list = entry.signal.questions ?? [];
      if (list.length > 0) map.set(entry.topic.id, list);
    }
    return map;
  }, [exam.plan]);

  const handlePlanBuilt = useCallback(
    (plan: ExamPlanResponse) => {
      const must = plan.topics?.filter((t) => t.band === "must").length ?? 0;
      notify(`🎯 Exam plan ready — ${must} must-do topics prioritised.`);
    },
    [notify],
  );

  /* ------------------------------ matching ------------------------------ */
  const runMatching = useCallback(
    async (
      list: Topic[],
      courseName: string,
      signal: AbortSignal,
      lang: string,
      picks: number,
      skipStudied: boolean,
      /** topicId -> playlist video id that teaches it (syllabus continuity). */
      course: Record<string, string> = {},
    ) => {
      let cursor = 0;

      const worker = async () => {
        while (cursor < list.length) {
          const index = cursor++;
          const topic = list[index];

          // Topics the student already knows are not worth API quota.
          if (skipStudied && isStudied(topic.title)) {
            setResults((prev) => ({
              ...prev,
              [topic.id]: {
                topic,
                videos: [],
                candidatesConsidered: 0,
                queries: [],
                skipped: true,
              },
            }));
            continue;
          }

          try {
            const response = await fetch("/api/videos", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                topic,
                language: lang,
                subject: courseName,
                limit: picks,
                courseVideoId: course[topic.id],
                examQuestions: pyqByTopic.get(topic.id)?.map((q) => q.text) ?? [],
                topicCount: list.length,
              }),
              signal,
            });
            const data: VideosResponse = await response.json();
            if (!data.ok || !data.result) {
              throw new Error(data.error || "Video search failed.");
            }
            setResults((prev) => ({ ...prev, [topic.id]: data.result as TopicResult }));
          } catch (err) {
            if (signal.aborted) return;
            setResults((prev) => ({
              ...prev,
              [topic.id]: {
                topic,
                videos: [],
                candidatesConsidered: 0,
                queries: [],
                error: err instanceof Error ? err.message : "Video search failed.",
              },
            }));
          }
        }
      };

      await Promise.all(Array.from({ length: Math.min(3, list.length) }, worker));
      if (!signal.aborted) setPhase("done");
    },
    // pyqByTopic feeds exam-worded queries — a new plan must re-create this.
    [isStudied, pyqByTopic],
  );

  /* ------------------------------ playlist ------------------------------- */
  /**
   * Looks for an EXISTING full-course playlist that already teaches this
   * syllabus. This runs BEFORE per-topic matching on purpose: once we know the
   * playlist, every single topic gets its continuity pick from the first video
   * onwards, instead of half the list being re-done later. A miss is a normal
   * outcome, not an error — matching just falls back to pure per-topic search.
   */
  const lookupPlaylist = useCallback(
    async (
      list: Topic[],
      courseName: string,
      lang: string,
      syllabusText: string,
    ): Promise<CoursePlaylist | null> => {
      if (list.length === 0) return null;
      setPlaylistLoading(true);
      try {
        const response = await fetch("/api/playlists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            topics: list.map((t) => ({
              id: t.id,
              title: t.title,
              description: t.description,
              keywords: t.keywords,
            })),
            subject: courseName,
            language: lang,
            syllabus: syllabusText,
          }),
        });
        const data: PlaylistResponse = await response.json();
        if (data.ok && data.playlist) {
          setPlaylist(data.playlist);
          notify(
            `📘 Playlist mili — ${data.playlist.coveragePercent}% syllabus cover kar rahi hai.`,
          );
          return data.playlist;
        }
        return null;
      } catch {
        /* playlist lookup is a bonus — never block the student on it */
        return null;
      } finally {
        setPlaylistLoading(false);
      }
    },
    [notify],
  );

  /**
   * Kicks off per-topic matching. When `wanted` is null the playlist is looked
   * up FIRST, so matching can use it from the very first topic rather than
   * half-way through.
   */
  const startMatching = useCallback(
    async (
      list: Topic[],
      courseName: string,
      signal: AbortSignal,
      lang: string,
      picks: number,
      syllabusText: string,
      wanted: CoursePlaylist | null,
    ) => {
      const chosen = wanted ?? (await lookupPlaylist(list, courseName, lang, syllabusText));
      await runMatching(list, courseName, signal, lang, picks, true, coverageMap(chosen));
    },
    [lookupPlaylist, runMatching],
  );

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
    setPlaylist(null);
    // Keep the uploaded PAPERS (re-OCR is expensive) but drop derived state —
    // new topics mean the plan and the topic mapping must be rebuilt.
    setExam({ questions: [], parsedPapers: [], plan: null });
    setPhase("analyzing");

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ syllabus, subject }),
        signal: controller.signal,
      });
      const data: AnalyzeResponse = await response.json();

      if (!data.ok || !data.topics?.length) {
        throw new Error(data.error || "Could not extract topics from this syllabus.");
      }

      const courseName = data.subject || subject || "Your course";
      setTopics(data.topics);
      setSubjectName(courseName);
      if (data.truncated) {
        notify("Syllabus was large — showing the top topics first.");
      }
      setPhase("matching");
      void startMatching(
        data.topics,
        courseName,
        controller.signal,
        language,
        perTopic,
        syllabus,
        null,
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      setPhase("idle");
      setFormError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }, [syllabus, subject, language, perTopic, startMatching, setExam, notify]);

  /** Fetches videos for a single topic (used when a topic is un-ticked). */
  const matchTopic = useCallback(
    async (topic: Topic) => {
      setResults((prev) => {
        const next = { ...prev };
        delete next[topic.id];
        return next;
      });

      try {
        const response = await fetch("/api/videos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            topic,
            language,
            subject: subjectName,
            limit: perTopic,
            courseVideoId: coverageMap(playlist)[topic.id],
            examQuestions: pyqByTopic.get(topic.id)?.map((q) => q.text) ?? [],
            topicCount: topics.length,
          }),
        });
        const data: VideosResponse = await response.json();
        if (!data.ok || !data.result) throw new Error(data.error || "Video search failed.");
        setResults((prev) => ({ ...prev, [topic.id]: data.result as TopicResult }));
      } catch (err) {
        setResults((prev) => ({
          ...prev,
          [topic.id]: {
            topic,
            videos: [],
            candidatesConsidered: 0,
            queries: [],
            error: err instanceof Error ? err.message : "Video search failed.",
          },
        }));
      }
    },
    [language, subjectName, perTopic, playlist, pyqByTopic, topics],
  );

  /** Tick/untick a topic. Unticking a skipped topic re-searches its videos. */
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

  /** Re-runs only the video search, keeping the extracted topics intact. */
  const rematchVideos = useCallback(async () => {
    if (topics.length === 0) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setResults({});
    setPhase("matching");
    setFormError(null);
    // Re-use the playlist we already verified, so the coverage promise holds.
    await startMatching(
      topics,
      subjectName,
      controller.signal,
      language,
      perTopic,
      syllabus,
      playlist,
    );
    notify("Videos re-matched with your current settings.");
  }, [topics, subjectName, language, perTopic, syllabus, playlist, startMatching, notify]);

  /**
   * Videos always match BEFORE the papers exist (Exam Mode only appears once
   * topics are extracted), so the first pass only knows syllabus wording.
   * Once a plan lands, re-run once with the exam's own words.
   *
   * Guarded by a signature of the questions + topics rather than plan object
   * identity, because changing the time budget rebuilds the plan — and a
   * slider nudge must not trigger a full re-search of every topic.
   */
  const handledPlanRef = useRef<string | null>(null);
  useEffect(() => {
    const plan = exam.plan;
    if (!plan || phase !== "done" || topics.length === 0) return;

    const signature = [
      plan.subject ?? "",
      exam.questions.length,
      (plan.topics ?? []).map((t) => t.topic.id).join(","),
    ].join("|");
    if (handledPlanRef.current === signature) return;
    handledPlanRef.current = signature;

    // Nothing mapped means re-searching would repeat the exact same queries.
    if (pyqByTopic.size === 0) return;

    notify("🔁 Ab videos dobara PYQ ki language me chal rahi hain — exam jaisa dhoond rahi hoon.");
    void rematchVideos();
  }, [exam.plan, exam.questions, phase, topics, pyqByTopic, rematchVideos, notify]);

  /** Fills the syllabus box from an uploaded file. */
  const handleFileText = useCallback((text: string, fileName: string) => {
    setSyllabus(text);
    setFormError(null);
    notify(`File padh li gaya: ${fileName}`);
  }, [notify]);

  const handleFileError = useCallback((message: string) => setFormError(message), []);

  const resetAll = useCallback(() => {
    abortRef.current?.abort();
    setTopics([]);
    setResults({});
    setSubjectName("");
    setPlaylist(null);
    setExamState(EMPTY_EXAM_STATE);
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
  const hasVideos = videoCount > 0;

  const handleCopy = useCallback(async () => {
    const ok = await copyText(
      buildMarkdown(subjectName, topics, results, isStudied, playlist),
    );
    notify(ok ? "Study list copied to clipboard ✅" : "Could not copy — try the download button.");
  }, [subjectName, topics, results, isStudied, playlist, notify]);

  const handleDownloadMd = useCallback(() => {
    downloadFile(
      `${slugify(subjectName || "syllabus")}-best-videos.md`,
      buildMarkdown(subjectName, topics, results, isStudied, playlist),
      "text/markdown;charset=utf-8",
    );
    notify("Markdown file downloaded.");
  }, [subjectName, topics, results, isStudied, playlist, notify]);

  const handleDownloadCsv = useCallback(() => {
    downloadFile(
      `${slugify(subjectName || "syllabus")}-videos.csv`,
      buildCsv(topics, results, isStudied),
      "text/csv;charset=utf-8",
    );
    notify("CSV file downloaded.");
  }, [subjectName, topics, results, isStudied, notify]);

  /* ------------------------------ study plan ----------------------------- */
  const generatePlan = useCallback(async () => {
    const planTopics = topics.filter((t) => !isStudied(t.title));
    const picks = planTopics
      .map((t) => {
        const video = results[t.id]?.videos?.[0];
        return video
          ? {
              title: t.title,
              videoTitle: video.video.title,
              videoUrl: videoUrl(video.video.id),
              seconds: video.video.durationSeconds,
            }
          : null;
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    if (picks.length === 0) {
      notify(
        studiedCount > 0
          ? "Sab topics already studied — plan ki zaroorat nahi! 🎉"
          : "Pehle kuch videos match karwa, phir plan banega.",
      );
      return;
    }

    setPlan({ open: true, loading: true, plan: null, error: null });
    const totalDays = Math.max(3, Math.min(30, Math.ceil(picks.length * 0.8)));

    try {
      const response = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subjectName || "Your course",
          topics: planTopics.map((t) => ({
            title: t.title,
            minutes: t.estimatedMinutes,
            importance: t.importance,
          })),
          picks,
          totalDays,
        }),
      });
      const data: PlanResponse = await response.json();
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
                Past papers → exam priority → notes, PYQs & videos
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {health && (
              <span className="chip hidden sm:inline-flex">
                {health.llm ? `AI: ${health.llm}` : "AI key missing"}
                {health.youtube ? " · YouTube ✓" : " · YouTube ✗"}
              </span>
            )}
            <button
              type="button"
              onClick={() => setKeysOpen(true)}
              className="btn-ghost flex items-center gap-1.5 px-2.5 py-1.5 text-xs"
              style={
                health && (!health.llm || !health.youtube)
                  ? {
                      borderColor: "color-mix(in srgb, var(--warn) 55%, var(--line))",
                      color: "var(--warn)",
                    }
                  : undefined
              }
              title="Add or change API keys"
            >
              <KeyIcon width={14} height={14} />
              <span className="hidden sm:inline">API Keys</span>
            </button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-20 pt-8 sm:px-6">
        {health && <SetupBanner health={health} onOpenKeys={() => setKeysOpen(true)} />}

        {/* Hero — only before the first analysis */}
        {phase === "idle" && topics.length === 0 && (
          <section className="mb-8 text-center">
            <h1 className="mx-auto max-w-3xl text-3xl font-extrabold leading-tight sm:text-5xl">
              Chal, milke padhte hain — <span className="gradient-text">kam time me zyada</span>{" "}
              marks.
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-[var(--muted)] sm:text-base">
              Sabse pehle apne <strong className="text-[var(--text)]">purane question papers</strong>{" "}
              phenk de. Main unhe padh ke batata hoon — kaunsa topic har saal aata hai, kaunsa
              kabhi nahi aaya — phir tujhe ek clear order deta hoon:{" "}
              <em>pehle ye kar, ye baad me, ye chhod de.</em> Uske andar concept ke liye videos,{" "}
              <strong className="text-[var(--text)]">3-level notes</strong>, PYQ ke solutions, mock
              test aur quiz. Bas tu padh, baaki sambhal lunga.
            </p>

            <div className="mx-auto mt-7 grid max-w-4xl gap-3 sm:grid-cols-3">
              {[
                {
                  icon: <span className="text-lg">🎯</span>,
                  title: "Tere papers se hi trend nikaale",
                  body: "2-3 purane papers daal — kaunsa topic repeat hota hai, kitne marks ka hai, kya aata hi nahi, sab tere asli data se. Guess nahi.",
                },
                {
                  icon: <span className="text-lg">⏳</span>,
                  title: "Bol de kitna time hai",
                  body: "1 din ya 2 hafta — plan utna hi banega. Har topic ko uske hisaab ke minutes milenge, must-do wale sabse upar.",
                },
                {
                  icon: <span className="text-lg">📚</span>,
                  title: "Padho, solve karo, revise karo",
                  body: "Detailed notes se samajh → short bullets + flashcards se revise → PYQ solve → mock test se check. Poori circle, ek jagah.",
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
            <div className="card mt-6 flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <Stat label="Subject" value={subjectName || "Your course"} />
                <Stat label="Topics" value={String(topics.length)} />
                <Stat label="Matched" value={`${matchedTopics}/${topics.length}`} />
                <Stat
                  label="Syllabus covered"
                  value={`${coveragePercent}%`}
                  accent
                />
                <Stat label="Videos" value={String(videoCount)} />
                {exam.papers.length > 0 && (
                  <Stat label="Past papers" value={String(exam.papers.length)} accent />
                )}
                <Stat
                  label="Studied"
                  value={`${studiedCount}/${topics.length}`}
                  accent
                />
                <Stat
                  label={studiedCount > 0 ? "Watch time left" : "Watch time"}
                  value={formatMinutes(watchSeconds)}
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
                {studiedCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      clearStudied();
                      notify("Progress reset — sab topics dobara pending.");
                    }}
                    className="btn-ghost flex items-center gap-1.5 px-3 py-2 text-xs"
                    title="Clear all studied ticks"
                  >
                    <CheckIcon width={14} height={14} /> Reset progress
                  </button>
                )}
                <button
                  type="button"
                  onClick={rematchVideos}
                  disabled={busy}
                  className="btn-ghost flex items-center gap-1.5 px-3 py-2 text-xs"
                  title="Search videos again (studied topics are skipped)"
                >
                  <RefreshIcon width={14} height={14} /> Re-match videos
                </button>
                <button
                  type="button"
                  onClick={handleCopy}
                  disabled={!hasVideos}
                  className="btn-ghost flex items-center gap-1.5 px-3 py-2 text-xs"
                >
                  <CopyIcon width={14} height={14} /> Copy list
                </button>
                <button
                  type="button"
                  onClick={handleDownloadMd}
                  disabled={!hasVideos}
                  className="btn-ghost flex items-center gap-1.5 px-3 py-2 text-xs"
                >
                  <DownloadIcon width={14} height={14} /> Markdown
                </button>
                <button
                  type="button"
                  onClick={handleDownloadCsv}
                  disabled={!hasVideos}
                  className="btn-ghost flex items-center gap-1.5 px-3 py-2 text-xs"
                >
                  <DownloadIcon width={14} height={14} /> CSV
                </button>
                <button
                  type="button"
                  onClick={generatePlan}
                  disabled={busy || !hasVideos}
                  className="btn-primary flex items-center gap-1.5 px-3.5 py-2 text-xs"
                >
                  <CalendarIcon width={14} height={14} /> Study plan
                </button>
              </div>
            </div>

            {/* Whole syllabus as one long document — read it like a textbook */}
            <FullNotesPanel syllabus={syllabus} subject={subjectName} />

            {/* Exam Mode — real past papers -> priority plan, PYQs, expected questions, quiz */}
            <ExamMode
              topics={topics}
              subject={subjectName}
              exam={exam}
              setExam={setExam}
              onPlanBuilt={handlePlanBuilt}
              onJumpToTopic={jumpTo}
            />

            {/* Verified full-course playlist — the "one playlist, whole syllabus" answer */}
            {playlistLoading && !playlist && (
              <div className="card mt-4 flex items-center gap-3 px-4 py-3 text-xs text-[var(--muted)]">
                <span className="skeleton h-4 w-4 shrink-0 rounded-full" />
                Existing full-course playlist dhoond raha hoon, taaki poora syllabus ek hi
                jagah cover ho sake…
              </div>
            )}

            {playlist && (
              <PlaylistBanner
                playlist={playlist}
                totalTopics={topics.length}
                matching={phase === "matching"}
                onUse={() => {
                  if (!playlist.coverage.length) return;
                  void startMatching(
                    topics,
                    subjectName,
                    new AbortController().signal,
                    language,
                    perTopic,
                    syllabus,
                    playlist,
                  );
                  notify("Playlist se videos dobara match ho rahe hain…");
                }}
              />
            )}

            {/* Honest gap list — named topics, their own PYQs, no silent empty panels */}
            {phase === "done" && (
              <CoverageReport
                topics={displayTopics}
                results={results}
                pyqByTopic={pyqByTopic}
                onJumpToTopic={jumpTo}
              />
            )}

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
                    languageCode={language}
                    examEntry={examByTopic.get(topic.id)}
                    pyqQuestions={pyqByTopic.get(topic.id)}
                    onToggleStudied={() => handleToggleStudied(topic.title)}
                    onPlay={setPlayer}
                  />
                ))}

                {phase === "done" && (
                  <div className="card p-5 text-center">
                    {allStudied ? (
                      <>
                        <p className="text-sm font-bold">🎉 Poori syllabus cover ho gayi!</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          Sab {topics.length} topics studied — ab revision aur practice pe focus
                          karo.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-sm font-bold">
                          🎉 Analysis complete — {matchedTopics}/{topics.length} topics matched.
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
          </>
        )}
      </main>

      <footer className="border-t border-[var(--line)] py-6 text-center text-xs text-[var(--muted)]">
        ExamSmasher · trends from YOUR real papers · YouTube + Gemini · priority is computed from
        actual questions, not guessed.
      </footer>

      <StudyPlanModal
        open={plan.open}
        loading={plan.loading}
        plan={plan.plan}
        error={plan.error}
        onClose={() => setPlan((p) => ({ ...p, open: false }))}
        onRegenerate={generatePlan}
      />

      <VideoPlayerModal video={player} onClose={() => setPlayer(null)} />

      <TodoPanel open={todoOpen} onClose={() => setTodoOpen(false)} />

      <ChatWidget
        subject={subjectName}
        topics={topics}
        syllabus={syllabus.slice(0, 3000)}
      />

      <KeysModal
        open={keysOpen}
        health={health}
        onClose={() => setKeysOpen(false)}
        onSaved={() => {
          refreshHealth();
          notify("Keys save ho gayi ✅ — ab Analyse karke dekh!");
        }}
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

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "examsmasher"
  );
}
