"use client";

import { useState } from "react";
import type { HealthResponse } from "@/lib/types";
import { AlertIcon, CloseIcon, KeyIcon } from "./Icons";

/**
 * Shown while API keys are missing so the app explains itself
 * instead of failing with a raw 401 later.
 */
export function SetupBanner({
  health,
  onOpenKeys,
}: {
  health: HealthResponse;
  onOpenKeys: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);

  const missing: string[] = [];
  if (!health.youtube) missing.push("YOUTUBE_API_KEY");
  if (!health.llm) missing.push("GEMINI_API_KEY (or OPENAI_API_KEY)");

  if (missing.length === 0 || dismissed) return null;

  return (
    <div
      className="card animate-fade-up mb-6 flex items-start gap-3 p-4"
      style={{ borderColor: "color-mix(in srgb, var(--warn) 45%, var(--line))" }}
    >
      <span className="mt-0.5 text-[var(--warn)]">
        <AlertIcon width={20} height={20} />
      </span>

      <div className="min-w-0 flex-1 text-sm">
        <p className="font-bold">
          Setup pending — add {missing.length} key{missing.length > 1 ? "s" : ""} to unlock full
          analysis
        </p>
        <p className="mt-1 text-[var(--muted)]">
          Missing: <code className="font-mono text-[0.8em]">{missing.join(", ")}</code>
        </p>

        <button
          type="button"
          onClick={onOpenKeys}
          className="btn-primary mt-3 flex items-center gap-2 px-4 py-2.5 text-sm"
        >
          <KeyIcon width={15} height={15} /> Open API Keys panel
        </button>

        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[var(--muted)]">
          <li>
            <strong className="text-[var(--text)]">YouTube Data API v3</strong> (free, 10,000
            units/day): open{" "}
            <a
              className="font-semibold text-[var(--brand)] underline underline-offset-2"
              href="https://console.cloud.google.com/apis/library/youtube.googleapis.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google Cloud → YouTube Data API
            </a>
            , enable it, then create an API key.
          </li>
          <li>
            <strong className="text-[var(--text)]">Gemini API key</strong> (free tier): grab it
            from{" "}
            <a
              className="font-semibold text-[var(--brand)] underline underline-offset-2"
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google AI Studio
            </a>
            .
          </li>
        </ol>

        <p className="mt-3 text-xs">
          Paste both in the panel above — no file editing needed. Saving works instantly (no
          restart).
        </p>
      </div>

      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss setup notice"
        className="btn-ghost grid h-8 w-8 shrink-0 place-items-center"
      >
        <CloseIcon width={16} height={16} />
      </button>
    </div>
  );
}
