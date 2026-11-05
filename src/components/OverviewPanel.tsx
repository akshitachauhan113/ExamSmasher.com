"use client";

import { CalendarIcon, CheckIcon, CopyIcon, DownloadIcon, ListIcon, RefreshIcon } from "@/components/Icons";

/** The page's flow phase — kept identical to the one in page.tsx. */
type Phase = "idle" | "analyzing" | "papers" | "matching" | "done";

interface OverviewPanelProps {
  stats: {
    topics: number;
    must: number;
    should: number;
    ifTime: number;
    /** Syllabus topics your real papers actually asked about. */
    pyqCovered: number;
    links: number;
    /** Topics that already have search links built. */
    matched: number;
    papers: number;
    studied: number;
  };
  phase: Phase;
  hasPlan: boolean;
  pyqSkipped: boolean;
  allStudied: boolean;
  hasLinks: boolean;
  onTodo: () => void;
  onRematch: () => void;
  onCopy: () => void;
  onDownloadMd: () => void;
  onDownloadCsv: () => void;
  onResetProgress: () => void;
  onGeneratePlan: () => void;
  /** Opens the PYQ Analysis tab. */
  onGoPyq: () => void;
  /** Skips the PYQ step and builds links from syllabus importance. */
  onSkip: () => void;
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
 * The Overview tab: a short summary of where the student stands, the actions
 * that apply to the whole analysis, and the single next step. Everything here
 * already existed on the page — it is reorganised, not changed.
 */
export function OverviewPanel({
  stats,
  phase,
  hasPlan,
  pyqSkipped,
  allStudied,
  hasLinks,
  onTodo,
  onRematch,
  onCopy,
  onDownloadMd,
  onDownloadCsv,
  onResetProgress,
  onGeneratePlan,
  onGoPyq,
  onSkip,
}: OverviewPanelProps) {
  const exportItems = [
    { label: "Copy list", icon: <CopyIcon width={13} height={13} />, onClick: onCopy, disabled: !hasLinks },
    { label: "Markdown (.md)", icon: <DownloadIcon width={13} height={13} />, onClick: onDownloadMd, disabled: !hasLinks },
    { label: "CSV", icon: <DownloadIcon width={13} height={13} />, onClick: onDownloadCsv, disabled: !hasLinks },
    ...(stats.studied > 0
      ? [
          {
            label: "Reset progress",
            icon: <CheckIcon width={13} height={13} />,
            onClick: onResetProgress,
            disabled: false,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-3">
      {/* Short summary first */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Stat label="Topics" value={String(stats.topics)} />
            <Stat label="Must-do" value={String(stats.must)} accent />
            <Stat label="Should" value={String(stats.should)} />
            <Stat label="Can skip" value={String(stats.ifTime)} />
            <Stat
              label="Topics with real PYQs"
              value={hasPlan ? `${stats.pyqCovered}/${stats.topics}` : "—"}
              accent
            />
            <Stat label="Search links" value={String(stats.links)} />
            {stats.papers > 0 && <Stat label="Past papers" value={String(stats.papers)} accent />}
            <Stat
              label="Studied"
              value={`${stats.studied}/${stats.topics}`}
              accent
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onTodo}
              className="btn-ghost flex items-center gap-1.5 px-3 py-2 text-xs"
              title="Your personal to-do list"
            >
              <ListIcon width={14} height={14} /> To-do
            </button>
            <button
              type="button"
              onClick={onRematch}
              disabled={phase === "matching"}
              className="btn-ghost flex items-center gap-1.5 px-3 py-2 text-xs"
              title="Rebuild the search links (studied topics are skipped)"
            >
              <RefreshIcon width={14} height={14} /> Re-match
            </button>

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
                {exportItems.map((item) => (
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
              onClick={onGeneratePlan}
              disabled={phase === "matching" || stats.topics === 0}
              className="btn-primary flex items-center gap-1.5 px-3.5 py-2 text-xs"
            >
              <CalendarIcon width={14} height={14} /> Study plan
            </button>
          </div>
        </div>
      </div>

      {/* The single next step */}
      {!hasPlan && phase === "papers" && (
        <div className="card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="text-xs leading-relaxed text-[var(--muted)]">
            <strong className="text-[var(--text)]">Step 2 ·</strong> Purane papers daalo toh har
            topic par Must / Might / Can skip ka asli trend lagega. Papers nahi hain? Skip bhi kar
            sakte ho.
          </p>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button type="button" onClick={onGoPyq} className="btn-primary px-4 py-2 text-xs">
              Papers upload karo →
            </button>
            <button type="button" onClick={onSkip} className="btn-ghost px-4 py-2 text-xs">
              Skip karo → search links
            </button>
          </div>
        </div>
      )}

      {hasPlan && (
        <div className="card flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="text-xs leading-relaxed text-[var(--muted)]">
            🎯 PYQ trend ready — <strong className="text-[var(--text)]">{stats.must} must-do</strong>{" "}
            topics sabse upar. Study order, solved paper aur mock test PYQ Analysis tab me hain.
          </p>
          <button type="button" onClick={onGoPyq} className="btn-ghost shrink-0 px-4 py-2 text-xs">
            PYQ Analysis kholo →
          </button>
        </div>
      )}

      {pyqSkipped && !hasPlan && phase !== "papers" && (
        <p className="text-xs leading-relaxed text-[var(--muted)]">
          ⏭️ PYQ step chhod diya — Must/Might/Can skip ke tags syllabus importance se bané hain. Upar
          papers daal kar kabhi bhi asli trend paa sakte ho.
        </p>
      )}

      {/* Completion */}
      {phase === "done" && (
        <div className="card p-5 text-center">
          {allStudied ? (
            <>
              <p className="text-sm font-bold">🎉 Poori syllabus cover ho gayi!</p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Sab {stats.topics} topics studied — ab revision aur practice pe focus karo.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-bold">
                🎉 Analysis complete — {stats.matched}/{stats.topics} topics par search links ban
                gaye.
              </p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {stats.studied > 0
                  ? `${stats.topics - stats.studied} topics baaki · padhte jao aur tick karte jao.`
                  : "Padhna shuru karo — har topic par tick lagate jao, progress save rehta hai."}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
