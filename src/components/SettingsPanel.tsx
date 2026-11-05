"use client";

import type { ReactNode } from "react";
import { AiStatusChip } from "./AiStatusChip";
import { NotesLangToggle } from "./NotesLangToggle";
import { ThemeToggle } from "./ThemeToggle";
import { GlobeIcon, PlayIcon } from "./Icons";
import { AI_MODEL_LABEL } from "@/lib/ai/status";
import { LANGUAGES } from "@/lib/languages";

interface SettingsPanelProps {
  language: string;
  onLanguageChange: (value: string) => void;
  perTopic: number;
  onPerTopicChange: (value: number) => void;
}

function Row({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
      <div className="min-w-0">
        <p className="text-sm font-extrabold">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-[var(--muted)]">{hint}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/**
 * Settings — only controls that already existed elsewhere in the app
 * (theme, notes language, video search preferences, browser AI status),
 * gathered into one small page. Nothing here changes how anything works.
 */
export function SettingsPanel({
  language,
  onLanguageChange,
  perTopic,
  onPerTopicChange,
}: SettingsPanelProps) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-extrabold">Settings</h1>
        <p className="mt-0.5 text-sm text-[var(--muted)]">
          Theme, language aur search preferences — sab kuch yahan se.
        </p>
      </div>

      <section className="card divide-y divide-[var(--line)] overflow-hidden" style={{ padding: 0 }}>
        <Row title="Appearance" hint="Light ya dark — jo aankhein pasand karein.">
          <ThemeToggle />
        </Row>

        <Row
          title="Notes language"
          hint="Notes English ya Hinglish me banenge — flip karke doosra version bhi dekh sakte ho."
        >
          <NotesLangToggle />
        </Row>

        <Row
          title="Video search language"
          hint="Search links me kis language ka hint aaye (jaise 'in Hindi' ya 'Hinglish')."
        >
          <label className="flex items-center gap-2">
            <GlobeIcon width={15} height={15} />
            <select
              value={language}
              onChange={(e) => onLanguageChange(e.target.value)}
              className="field px-3 py-2 text-sm"
              aria-label="Video search language"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        </Row>

        <Row
          title="Links per topic"
          hint="Har topic ke liye kitne YouTube search links banaun (2-4)."
        >
          <label className="flex items-center gap-2">
            <PlayIcon width={15} height={15} />
            <select
              value={perTopic}
              onChange={(e) => onPerTopicChange(Number(e.target.value))}
              className="field px-3 py-2 text-sm"
              aria-label="Links per topic"
            >
              {[2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n} link{n > 1 ? "s" : ""}
                </option>
              ))}
            </select>
          </label>
        </Row>

        <Row
          title="Browser AI"
          hint={`${AI_MODEL_LABEL} — ek chhota model jo isi browser me chalta hai. Off ho toh rule engine sab kuch khud bana deta hai; koi key ya upload nahi.`}
        >
          <AiStatusChip />
        </Row>
      </section>

      <section className="card p-4">
        <p className="text-sm font-extrabold">About ExamSmasher</p>
        <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-[var(--muted)]">
          <li>• Koi API key nahi — analysis, notes aur quiz sab isi browser me bante hain.</li>
          <li>• Sirf ek server route: file upload padhne ke liye (PDF/DOCX/photo → text).</li>
          <li>• Search links YouTube ke results page kholte hain — koi video rank/verify nahi hoti.</li>
          <li>• Aapka progress (topics, notes, todos) sirf isi device ke browser me save hota hai.</li>
        </ul>
      </section>
    </div>
  );
}
