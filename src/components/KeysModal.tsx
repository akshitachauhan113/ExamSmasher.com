"use client";

import { useEffect, useState } from "react";
import type { HealthResponse } from "@/lib/types";
import { AlertIcon, CheckIcon, CloseIcon, ExternalIcon, KeyIcon, RefreshIcon } from "./Icons";

interface KeysModalProps {
  open: boolean;
  health: HealthResponse | null;
  onClose: () => void;
  /** Called after a successful save so the parent can refresh /api/health. */
  onSaved: () => void;
}

type TestState = { phase: "idle" | "busy" | "ok" | "err"; message?: string };

const IDLE: TestState = { phase: "idle" };

/**
 * In-app API key setup: paste a key, test it, save it to .env.local.
 * The values are write-only — they are never read back by the client.
 */
export function KeysModal({ open, health, onClose, onSaved }: KeysModalProps) {
  const [youtube, setYoutube] = useState("");
  const [gemini, setGemini] = useState("");
  const [openai, setOpenai] = useState("");
  const [showOpenAI, setShowOpenAI] = useState(false);
  const [showValues, setShowValues] = useState(false);

  const [ytTest, setYtTest] = useState<TestState>(IDLE);
  const [gemTest, setGemTest] = useState<TestState>(IDLE);
  const [oaiTest, setOaiTest] = useState<TestState>(IDLE);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  const runTest = async (
    kind: "youtube" | "gemini" | "openai",
    key: string,
    setState: (state: TestState) => void,
  ) => {
    setState({ phase: "busy" });
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test", kind, key }),
      });
      const data = (await res.json()) as { ok: boolean; message?: string };
      setState({
        phase: data.ok ? "ok" : "err",
        message: data.message || (data.ok ? "Valid ✅" : "Test failed."),
      });
    } catch {
      setState({ phase: "err", message: "Network error — test dobara karo." });
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          values: { YOUTUBE_API_KEY: youtube, GEMINI_API_KEY: gemini, OPENAI_API_KEY: openai },
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error || "Save failed.");

      setYoutube("");
      setGemini("");
      setOpenai("");
      setYtTest(IDLE);
      setGemTest(IDLE);
      setOaiTest(IDLE);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the keys.");
    } finally {
      setSaving(false);
    }
  };

  const hasSomethingToSave = youtube.trim() || gemini.trim() || openai.trim();

  /** Empties a stored key (removes it from .env.local and this process). */
  const clearKey = async (name: string) => {
    setError(null);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save", values: {}, clear: [name] }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error || "Could not remove the key.");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the key.");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/70 p-3 backdrop-blur-sm sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="API key settings"
    >
      <div
        className="card my-4 w-full max-w-2xl animate-fade-up p-5 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              className="grid h-9 w-9 place-items-center rounded-xl text-white"
              style={{ background: "linear-gradient(135deg, var(--brand), var(--brand-2))" }}
            >
              <KeyIcon width={17} height={17} />
            </span>
            <div>
              <h2 className="text-base font-extrabold">API Keys</h2>
              <p className="text-xs text-[var(--muted)]">
                Paste karo, Test karo, Save karo — file chhune ki zarurat nahi.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="btn-ghost grid h-8 w-8 shrink-0 place-items-center"
          >
            <CloseIcon width={15} height={15} />
          </button>
        </div>

        {/* Current status */}
        <div className="mt-4 flex flex-wrap gap-2">
          <span
            className="chip"
            style={{
              color: health?.youtube ? "var(--good)" : "var(--warn)",
              borderColor: health?.youtube
                ? "color-mix(in srgb, var(--good) 45%, var(--line))"
                : "color-mix(in srgb, var(--warn) 45%, var(--line))",
            }}
          >
            {health?.youtube ? "YouTube: set ✓" : "YouTube: missing"}
          </span>
          <span
            className="chip"
            style={{
              color: health?.llm ? "var(--good)" : "var(--warn)",
              borderColor: health?.llm
                ? "color-mix(in srgb, var(--good) 45%, var(--line))"
                : "color-mix(in srgb, var(--warn) 45%, var(--line))",
            }}
          >
            {health?.llm ? `AI: ${health.llm} ✓ (${health.model})` : "AI: missing"}
          </span>
        </div>

        <div className="mt-5 space-y-4">
          <KeyField
            name="YOUTUBE_API_KEY"
            label="YouTube Data API key"
            hint="Free — 10,000 units/day ≈ 100 video searches"
            placeholder="AIzaSy..."
            value={youtube}
            onChange={setYoutube}
            test={ytTest}
            onTest={() => void runTest("youtube", youtube, setYtTest)}
            onClear={() => void clearKey("YOUTUBE_API_KEY")}
            show={showValues}
            alreadySet={Boolean(health?.youtube)}
          />

          <KeyField
            name="GEMINI_API_KEY"
            label="Gemini API key"
            hint="Syllabus analysis + content matching + study plan"
            placeholder="AIza..."
            value={gemini}
            onChange={setGemini}
            test={gemTest}
            onTest={() => void runTest("gemini", gemini, setGemTest)}
            onClear={() => void clearKey("GEMINI_API_KEY")}
            show={showValues}
            alreadySet={Boolean(health?.llm === "gemini")}
          />

          {!showOpenAI ? (
            <button
              type="button"
              onClick={() => setShowOpenAI(true)}
              className="text-xs font-semibold text-[var(--muted)] underline underline-offset-2 hover:text-[var(--text)]"
            >
              Ya phir OpenAI key use karni hai?
            </button>
          ) : (
            <KeyField
              name="OPENAI_API_KEY"
              label="OpenAI API key (optional)"
              hint="Alternative to Gemini — sirf ek chahiye"
              placeholder="sk-..."
              value={openai}
              onChange={setOpenai}
              test={oaiTest}
              onTest={() => void runTest("openai", openai, setOaiTest)}
              onClear={() => void clearKey("OPENAI_API_KEY")}
              show={showValues}
              alreadySet={Boolean(health?.llm === "openai")}
            />
          )}

          <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--muted)]">
            <input
              type="checkbox"
              checked={showValues}
              onChange={(e) => setShowValues(e.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--brand)]"
            />
            Pasted values dikhao
          </label>
        </div>

        {error && (
          <p
            className="mt-4 rounded-xl border px-3 py-2 text-sm"
            style={{
              borderColor: "color-mix(in srgb, var(--bad) 45%, var(--line))",
              color: "var(--bad)",
              background: "color-mix(in srgb, var(--bad) 7%, var(--surface))",
            }}
          >
            {error}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !hasSomethingToSave}
            className="btn-primary flex items-center gap-2 px-4 py-2.5 text-sm disabled:opacity-50"
          >
            {saving ? (
              <>
                <RefreshIcon width={15} height={15} /> Saving…
              </>
            ) : (
              <>
                <CheckIcon width={15} height={15} /> Save keys
              </>
            )}
          </button>
          <button type="button" onClick={onClose} className="btn-ghost px-4 py-2.5 text-sm">
            Baad me
          </button>
        </div>

        <div className="mt-5 space-y-2 border-t border-[var(--line)] pt-4 text-xs text-[var(--muted)]">
          <p>
            <strong className="text-[var(--text)]">Kaise banayein (dono FREE, 2 minute):</strong>
          </p>
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>
              YouTube key:{" "}
              <a
                className="font-semibold text-[var(--brand)] underline underline-offset-2"
                href="https://console.cloud.google.com/apis/library/youtube.googleapis.com"
                target="_blank"
                rel="noopener noreferrer"
              >
                Google Cloud → YouTube Data API <ExternalIcon width={11} height={11} />
              </a>{" "}
              → Enable → Credentials → Create credentials → API key
            </li>
            <li>
              Gemini key:{" "}
              <a
                className="font-semibold text-[var(--brand)] underline underline-offset-2"
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noopener noreferrer"
              >
                aistudio.google.com/apikey <ExternalIcon width={11} height={11} />
              </a>{" "}
              → Create API key
            </li>
          </ol>
          <p className="flex items-start gap-1.5 pt-1">
            <span className="mt-0.5 shrink-0 text-[var(--good)]">
              <CheckIcon width={13} height={13} />
            </span>
            Keys sirf is computer ke <code className="font-mono">.env.local</code> me save hoti
            hain — wo file git me commit nahi hoti, kahin bahar nahi jaati.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- key field ------------------------------- */

interface KeyFieldProps {
  name: string;
  label: string;
  hint: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  test: TestState;
  onTest: () => void;
  onClear: () => void;
  show: boolean;
  alreadySet: boolean;
}

function KeyField({
  name,
  label,
  hint,
  placeholder,
  value,
  onChange,
  test,
  onTest,
  onClear,
  show,
  alreadySet,
}: KeyFieldProps) {
  return (
    <div className="rounded-2xl border border-[var(--line)] p-3">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-sm font-bold" htmlFor={`key-${name}`}>
          {label}
        </label>
        {alreadySet && !value && (
          <span className="flex items-center gap-2">
            <span className="text-[0.68rem] font-semibold" style={{ color: "var(--good)" }}>
              already set ✓
            </span>
            <button
              type="button"
              onClick={onClear}
              className="text-[0.68rem] font-semibold text-[var(--muted)] underline underline-offset-2 hover:text-[var(--bad)]"
            >
              remove
            </button>
          </span>
        )}
      </div>
      <p className="mt-0.5 text-xs text-[var(--muted)]">{hint}</p>

      <div className="mt-2 flex flex-wrap gap-2">
        <input
          id={`key-${name}`}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={alreadySet ? "Paste to replace…" : placeholder}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className="field min-w-0 flex-1 px-3 py-2 font-mono text-sm"
        />
        <button
          type="button"
          onClick={onTest}
          disabled={test.phase === "busy" || !value.trim()}
          className="btn-ghost flex shrink-0 items-center gap-1.5 px-3 py-2 text-xs disabled:opacity-50"
        >
          {test.phase === "busy" ? (
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--line)] border-t-[var(--brand)]" />
          ) : (
            <RefreshIcon width={13} height={13} />
          )}
          Test
        </button>
      </div>

      {test.phase !== "idle" && test.message && (
        <p
          className="mt-2 flex items-start gap-1.5 text-xs"
          style={{ color: test.phase === "ok" ? "var(--good)" : test.phase === "err" ? "var(--bad)" : "var(--muted)" }}
        >
          <span className="mt-0.5 shrink-0">
            {test.phase === "ok" ? (
              <CheckIcon width={13} height={13} />
            ) : test.phase === "err" ? (
              <AlertIcon width={13} height={13} />
            ) : (
              <RefreshIcon width={13} height={13} />
            )}
          </span>
          {test.message}
        </p>
      )}
    </div>
  );
}
