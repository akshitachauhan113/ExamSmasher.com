"use client";

import { BarChart3, ClipboardList, FileCheck2, FileUp, ListVideo, NotebookPen, Target } from "lucide-react";

/** What a dashboard card wants to happen when tapped. */
export type DashboardAction = "syllabus" | "pyq" | "complete" | "smart" | "space";

interface FeatureCard {
  id: DashboardAction;
  title: string;
  body: string;
  Icon: typeof FileUp;
  /** Signature colour for this card's wash, watermark and icon tile. */
  tint: string;
  /** Gradient used for the icon tile (kept readable behind white glyphs). */
  grad: string;
}

/**
 * The four things a student actually came to do. Each card is a real
 * navigation shortcut into an existing flow — no dead links, no mock data.
 */
const FEATURES: FeatureCard[] = [
  {
    id: "syllabus",
    title: "Upload Syllabus",
    body: "PDF, photo ya text — topics khud ban jayenge.",
    Icon: FileUp,
    tint: "#ec4899",
    grad: "linear-gradient(135deg, #ec4899, #ff7a59)",
  },
  {
    id: "pyq",
    title: "Upload PYQs",
    body: "Purane papers se Must / Might / Can skip ka tag.",
    Icon: ClipboardList,
    tint: "#8b5cf6",
    grad: "linear-gradient(135deg, #8b5cf6, #6366f1)",
  },
  {
    id: "complete",
    title: "Complete Syllabus Playlist",
    body: "Poore syllabus ke search links, unit by unit.",
    Icon: ListVideo,
    tint: "#f59e0b",
    grad: "linear-gradient(135deg, #f59e0b, #f97316)",
  },
  {
    id: "smart",
    title: "Smart Exam Preparation",
    body: "Exam trend se priority order aur study plan.",
    Icon: Target,
    tint: "#10b981",
    grad: "linear-gradient(135deg, #10b981, #06b6d4)",
  },
];

/** Secondary features — a compact strip, never big cards on the homepage. */
const SPACE_ITEMS = [
  { id: "notes" as const, label: "Notes", Icon: NotebookPen },
  { id: "mock" as const, label: "Mock Tests", Icon: FileCheck2 },
  { id: "solutions" as const, label: "PYQ Solutions", Icon: ClipboardList },
  { id: "progress" as const, label: "Study Progress", Icon: BarChart3 },
];

export type SpaceAnchor = (typeof SPACE_ITEMS)[number]["id"];

interface HeroDashboardProps {
  onAction: (action: DashboardAction) => void;
  onSpace: (anchor?: SpaceAnchor) => void;
}

/**
 * Compact student dashboard: one heading, four feature cards with subtle
 * icon illustrations, and a small "My Study Space" strip. Kept deliberately
 * short — everything below it is the real work surface.
 */
export function HeroDashboard({ onAction, onSpace }: HeroDashboardProps) {
  return (
    <section className="mb-6">
      <div className="mb-4 text-center">
        <h1 className="text-2xl font-extrabold leading-tight sm:text-3xl">
          Study Smarter, <span className="gradient-text">Score Better.</span>
        </h1>
        <p className="mx-auto mt-1.5 max-w-2xl text-sm text-[var(--muted)]">
          Syllabus daalo → purane papers se priority → har topic ke search links, notes aur solved
          PYQs. Sab kuch ek hi jagah.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map(({ id, title, body, Icon, tint, grad }) => (
          <button
            key={id}
            type="button"
            onClick={() => onAction(id)}
            className="card group relative overflow-hidden p-4 text-left transition-shadow hover:shadow-[var(--shadow-card)]"
            style={{
              background: `radial-gradient(120% 90% at 100% 0%, ${tint}1f, transparent 55%), var(--surface)`,
            }}
          >
            {/* Subtle background illustration — same icon, big and faint. */}
            <Icon
              width={78}
              height={78}
              strokeWidth={1.5}
              aria-hidden
              className="pointer-events-none absolute -bottom-4 -right-3 opacity-[0.06] transition-opacity group-hover:opacity-[0.11]"
              style={{ color: tint }}
            />
            <span
              className="mb-2.5 grid h-9 w-9 place-items-center rounded-xl text-white"
              style={{ background: grad }}
            >
              <Icon width={18} height={18} strokeWidth={2.2} />
            </span>
            <p className="relative text-sm font-extrabold leading-snug">{title}</p>
            <p className="relative mt-1 text-xs leading-relaxed text-[var(--muted)]">{body}</p>
          </button>
        ))}
      </div>

      {/* Secondary features, as one compact strip */}
      <div
        className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border px-3 py-2.5"
        style={{ borderColor: "var(--line)", background: "var(--surface)" }}
      >
        <span className="flex items-center gap-1.5 text-[0.7rem] font-extrabold uppercase tracking-wide text-[var(--muted)]">
          <span style={{ color: "var(--brand)" }} aria-hidden>
            <BarChart3 width={13} height={13} />
          </span>
          My Study Space
        </span>
        <div className="flex flex-wrap gap-1.5">
          {SPACE_ITEMS.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => onSpace(id)}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-colors hover:bg-[var(--surface-2)]"
              style={{ color: "var(--text)" }}
            >
              <Icon width={14} height={14} strokeWidth={2.1} style={{ color: "var(--brand)" }} />
              {label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
