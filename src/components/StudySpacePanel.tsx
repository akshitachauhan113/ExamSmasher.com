"use client";

import type { ReactNode } from "react";
import { BarChart3, ClipboardList, FileCheck2, NotebookPen } from "lucide-react";
import { CoverageReport } from "./CoverageReport";
import { FullNotesPanel } from "./FullNotesPanel";
import { QuizBox } from "./QuizBox";
import { MockTestPanel, PaperSolutions } from "./ExamMode";
import type { ExamPlanResponse, PyqQuestion, Topic, TopicResult } from "@/lib/types";

type Anchor = "notes" | "solutions" | "mock" | "progress";

interface StudySpacePanelProps {
  hasTopics: boolean;
  /** Priority-ordered topics, used by the progress report. */
  topics: Topic[];
  results: Record<string, TopicResult>;
  pyqByTopic: Map<string, PyqQuestion[]>;
  subject: string;
  syllabus: string;
  /** Questions parsed from the uploaded papers (empty until step 2 runs). */
  questions: PyqQuestion[];
  plan: ExamPlanResponse | null;
  stats: { topics: number; studied: number; must: number; links: number };
  onJump: (topicId: string) => void;
  onHome: () => void;
  onGoPyq: () => void;
}

const ITEMS: Array<{ id: Anchor; label: string; Icon: typeof NotebookPen; hint: string }> = [
  { id: "notes", label: "Notes", Icon: NotebookPen, hint: "Poore syllabus ke notes" },
  { id: "mock", label: "Mock Tests", Icon: FileCheck2, hint: "Pattern + quiz practice" },
  { id: "solutions", label: "PYQ Solutions", Icon: ClipboardList, hint: "Har sawaal ka jawab" },
  { id: "progress", label: "Study Progress", Icon: BarChart3, hint: "Coverage + gaps" },
];

function Panel({ id, title, subtitle, children }: { id: string; title: string; subtitle: string; children: ReactNode }) {
  return (
    <section id={id} className="card scroll-mt-28 p-4">
      <header className="mb-3">
        <h2 className="text-[1.05rem] font-extrabold">{title}</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">{subtitle}</p>
      </header>
      {children}
    </section>
  );
}

function EmptyCard({ message, buttonLabel, onAction }: { message: string; buttonLabel: string; onAction: () => void }) {
  return (
    <div className="rounded-xl border border-dashed px-4 py-5 text-center" style={{ borderColor: "var(--line)" }}>
      <p className="text-sm text-[var(--muted)]">{message}</p>
      <button type="button" onClick={onAction} className="btn-primary mt-3 px-4 py-2 text-xs">
        {buttonLabel}
      </button>
    </div>
  );
}

/**
 * My Study Space — the four secondary features in one compact place:
 * Notes, Mock Tests (+ quiz), PYQ Solutions and Study Progress.
 *
 * Each block renders the SAME components the analysis flow used before; they
 * were moved here, not duplicated, so generating notes or solutions in one
 * place is the only place they live.
 */
export function StudySpacePanel({
  hasTopics,
  topics,
  results,
  pyqByTopic,
  subject,
  syllabus,
  questions,
  plan,
  stats,
  onJump,
  onHome,
  onGoPyq,
}: StudySpacePanelProps) {
  const goTo = (anchor: Anchor) => {
    document.getElementById(anchor)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const hasPapers = Boolean(plan) && questions.length > 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-extrabold">My Study Space</h1>
        <p className="mt-0.5 text-sm text-[var(--muted)]">
          Notes, mock tests, solved PYQs aur progress — sab ek chhote se jagah me.
        </p>
      </div>

      {/* Compact index — jump straight to a feature */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {ITEMS.map(({ id, label, Icon, hint }) => (
          <button
            key={id}
            type="button"
            onClick={() => goTo(id)}
            className="card flex items-center gap-2.5 p-3 text-left transition-shadow hover:shadow-[var(--shadow-card)]"
          >
            <span
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white"
              style={{ background: "linear-gradient(135deg, var(--brand), var(--brand-2))" }}
            >
              <Icon width={16} height={16} strokeWidth={2.2} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-extrabold">{label}</span>
              <span className="block truncate text-[0.65rem] text-[var(--muted)]">{hint}</span>
            </span>
          </button>
        ))}
      </div>

      {!hasTopics ? (
        <Panel id="notes" title="📒 Notes" subtitle="Syllabus analyse hone ke baad notes yahan banenge.">
          <EmptyCard
            message="Abhi tak koi syllabus analyse nahi hua — pehle syllabus daalo."
            buttonLabel="Syllabus par jao →"
            onAction={onHome}
          />
        </Panel>
      ) : (
        <Panel
          id="notes"
          title="📒 Notes"
          subtitle="Poore syllabus ke detailed notes — padhne ke liye ya download karne ke liye."
        >
          <FullNotesPanel syllabus={syllabus} subject={subject} topics={topics} />
        </Panel>
      )}

      <Panel
        id="solutions"
        title="✍️ PYQ Solutions"
        subtitle="Har asli sawaal ka jawab uske neeche — Easy/Medium/Hard aur important tags ke saath."
      >
        {hasPapers && plan ? (
          <PaperSolutions questions={questions} plan={plan} subject={subject} syllabus={syllabus} />
        ) : (
          <EmptyCard
            message="Purane papers upload karke exam plan banao — phir har sawaal ka solved paper yahan milega."
            buttonLabel="PYQ Analysis par jao →"
            onAction={onGoPyq}
          />
        )}
      </Panel>

      <Panel
        id="mock"
        title="🧪 Mock Tests & Quiz"
        subtitle="Tumhare asli papers jaisa pattern me mock paper, aur repeating topics par quiz."
      >
        {hasPapers && plan ? (
          <div className="space-y-4">
            <MockTestPanel questions={questions} plan={plan} subject={subject} />
            <QuizBox topics={plan.topics ?? []} subject={plan.subject ?? subject} />
          </div>
        ) : (
          <EmptyCard
            message="Papers padhne ke baad yahan mock test aur quiz ban jayenge."
            buttonLabel="PYQ Analysis par jao →"
            onAction={onGoPyq}
          />
        )}
      </Panel>

      <Panel
        id="progress"
        title="📊 Study Progress"
        subtitle="Kitna cover ho gaya, kaunsa topic pending hai, aur aapke papers ne kaunsa topic chhoda."
      >
        {hasTopics ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <div>
                <p className="text-[0.68rem] uppercase tracking-wide text-[var(--muted)]">Topics</p>
                <p className="text-sm font-extrabold">{stats.topics}</p>
              </div>
              <div>
                <p className="text-[0.68rem] uppercase tracking-wide text-[var(--muted)]">Studied</p>
                <p className="text-sm font-extrabold" style={{ color: "var(--brand)" }}>
                  {stats.studied}/{stats.topics}
                </p>
              </div>
              <div>
                <p className="text-[0.68rem] uppercase tracking-wide text-[var(--muted)]">Must-do</p>
                <p className="text-sm font-extrabold">{stats.must}</p>
              </div>
              <div>
                <p className="text-[0.68rem] uppercase tracking-wide text-[var(--muted)]">Search links</p>
                <p className="text-sm font-extrabold">{stats.links}</p>
              </div>
            </div>

            {plan ? (
              <CoverageReport topics={topics} results={results} pyqByTopic={pyqByTopic} onJumpToTopic={onJump} />
            ) : (
              <p className="rounded-xl border border-dashed px-4 py-4 text-xs leading-relaxed text-[var(--muted)]" style={{ borderColor: "var(--line)" }}>
                Papers daal kar exam plan banao — tab pata chalega ki aapke papers ne kaunsa syllabus
                topic kabhi nahi poocha.
              </p>
            )}
          </div>
        ) : (
          <EmptyCard
            message="Progress wahi dikhega jab syllabus analyse hoga."
            buttonLabel="Syllabus par jao →"
            onAction={onHome}
          />
        )}
      </Panel>
    </div>
  );
}
