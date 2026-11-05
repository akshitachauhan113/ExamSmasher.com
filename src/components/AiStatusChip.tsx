"use client";

import type { CSSProperties } from "react";

import { AI_MODEL_LABEL, useAiStatus } from "@/lib/ai/status";

/**
 * The one place the UI is allowed to claim anything about AI.
 *
 * Every state below is read straight from the status store, which is only ever
 * written by the model loader — so this chip cannot say "AI ready" while the
 * model is still downloading, and cannot say anything at all when it failed.
 */
export function AiStatusChip({ compact = false }: { compact?: boolean }) {
  const status = useAiStatus();

  const title =
    status.phase === "idle"
      ? "The rule-based engine is in charge. The optional browser model downloads in the background."
      : status.phase === "loading"
        ? `${AI_MODEL_LABEL} is downloading to this browser. Nothing is sent anywhere.`
        : status.phase === "ready"
          ? `${AI_MODEL_LABEL} is loaded and running locally on ${status.device === "webgpu" ? "WebGPU" : "WASM"}.`
          : "The browser model could not run here — the rule-based engine covers everything instead.";

  const style: CSSProperties | undefined =
    status.phase === "ready"
      ? {
          borderColor: "color-mix(in srgb, var(--good) 55%, var(--line))",
          color: "var(--good)",
        }
      : status.phase === "loading"
        ? {
            borderColor: "color-mix(in srgb, var(--brand) 45%, var(--line))",
            color: "var(--brand)",
          }
        : status.phase === "error" || status.phase === "unsupported"
          ? {
              borderColor: "color-mix(in srgb, var(--warn) 55%, var(--line))",
              color: "var(--warn)",
            }
          : undefined;

  const label =
    status.phase === "idle"
      ? "Rules mode"
      : status.phase === "loading"
        ? `AI ${status.progress > 0 ? `${status.progress}%` : "loading…"}`
        : status.phase === "ready"
          ? `AI ready · ${status.device === "webgpu" ? "WebGPU" : "WASM"}`
          : "Rules mode";

  return (
    <span
      className="chip hidden items-center gap-1.5 sm:inline-flex"
      style={style}
      title={title}
      role="status"
      aria-live="polite"
    >
      {status.phase === "loading" ? (
        <span className="block h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-2 border-[var(--line)] border-t-[var(--brand)]" />
      ) : (
        <span
          className="block h-1.5 w-1.5 shrink-0 rounded-full"
          style={{
            background:
              status.phase === "ready"
                ? "var(--good)"
                : status.phase === "error" || status.phase === "unsupported"
                  ? "var(--warn)"
                  : "var(--muted)",
          }}
        />
      )}
      {compact ? label.replace("AI ready · ", "") : label}
    </span>
  );
}
