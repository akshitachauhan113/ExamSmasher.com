import { loadBrowserModel } from "./model";
import { getAiStatus } from "./status";

/**
 * Which engine actually produced a result — surfaced to the student so the
 * UI never pretends a rule-based answer came from a model (or the reverse).
 */
export type EngineSource = "ai" | "rules";

export interface WithAiOptions {
  /**
   * How long to wait for a first-time model download before giving up and
   * returning the rule-based answer. 0 = never wait (load in the background).
   */
  waitMs?: number;
  /** Ceiling on a single inference call. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT = 60_000;

/** Starts the model download in the background. Never throws. */
export function primeBrowserAi(): void {
  if (getAiStatus().phase === "idle") void loadBrowserModel();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Resolves when the model is ready, or as soon as it definitively fails. */
async function waitForReady(deadlineMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < deadlineMs) {
    const phase = getAiStatus().phase;
    if (phase === "ready") return true;
    if (phase === "error" || phase === "unsupported") return false;
    await delay(300);
  }
  return getAiStatus().phase === "ready";
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Model call timed out.")), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Run `ai()` when a browser model is genuinely available, otherwise `rules()`.
 *
 * The rule-based path is the guaranteed baseline: it runs instantly, needs no
 * download and no key. The model is only ever claimed as the source when it
 * really produced the output.
 */
export async function withAi<T>(
  ai: () => Promise<T>,
  rules: () => T | Promise<T>,
  options: WithAiOptions = {},
): Promise<{ value: T; source: EngineSource }> {
  const { waitMs = 0, timeoutMs = DEFAULT_TIMEOUT } = options;
  const current = getAiStatus().phase;

  if (current === "error" || current === "unsupported") {
    return { value: await rules(), source: "rules" };
  }

  // Kick the download off either way — the next call benefits even if this
  // one does not wait for it.
  void loadBrowserModel();

  let ready = current === "ready";
  if (!ready && waitMs > 0) ready = await waitForReady(waitMs);

  if (!ready) {
    return { value: await rules(), source: "rules" };
  }

  try {
    return { value: await withTimeout(ai(), timeoutMs), source: "ai" };
  } catch (err) {
    console.warn("[ai] falling back to rules:", err);
    return { value: await rules(), source: "rules" };
  }
}
