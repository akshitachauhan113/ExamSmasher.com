import type { TextGenerationPipeline } from "@huggingface/transformers";

import { AI_MODEL_ID, setAiStatus } from "./status";

/**
 * Lazy loader for the in-browser text model.
 *
 * Rules:
 *   - nothing is imported until the first feature actually asks for the model,
 *   - WebGPU is tried first (fast), WASM is the guaranteed fallback,
 *   - download progress is published to the status store so the UI can show it,
 *   - assets land in the browser Cache API, so the second visit is instant,
 *   - a failure is recorded once and never retried in a loop.
 *
 * `loadModel()` resolves to `null` when the model cannot run. Callers must
 * treat `null` as "use the rule-based engine" — never as an error to show.
 */

/** WebGPU needs an explicit dtype: the fp32 default is over a gigabyte. */
const WEBGPU_DTYPE = "q4f16" as const;
/** WASM's default is int8 (~360 MB) — the same weights, just slower. */
const WASM_DTYPE = "q8" as const;

type DType = typeof WEBGPU_DTYPE | typeof WASM_DTYPE;

/** `navigator.gpu` is not in every TS lib, so ask for it structurally. */
interface GpuLike {
  requestAdapter(): Promise<unknown>;
}

let inFlight: Promise<TextGenerationPipeline | null> | null = null;
let resolved: TextGenerationPipeline | null = null;
let gaveUp = false;

type ProgressPayload = {
  status?: string;
  progress?: number;
  file?: string;
  [key: string]: unknown;
};

async function canUseWebGpu(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined") return false;
    const gpu = (navigator as Navigator & { gpu?: GpuLike }).gpu;
    if (!gpu) return false;
    const adapter = await gpu.requestAdapter();
    return adapter !== null && adapter !== undefined;
  } catch {
    return false;
  }
}

function onProgress(payload: ProgressPayload): void {
  if (payload?.status === "progress_total" && typeof payload.progress === "number") {
    const percent = Math.max(0, Math.min(100, Math.round(payload.progress)));
    setAiStatus({
      phase: "loading",
      progress: percent,
      detail: `Downloading browser AI… ${percent}%`,
    });
    return;
  }
  if (payload?.status === "ready") {
    setAiStatus({ phase: "loading", progress: 100, detail: "Starting the model…" });
  }
}

async function createPipeline(
  device: "webgpu" | "wasm",
  dtype: DType,
): Promise<TextGenerationPipeline> {
  const { pipeline, env } = await import("@huggingface/transformers");

  // Always load from the Hugging Face CDN and cache the result locally.
  env.allowRemoteModels = true;
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  // Multi-threaded WASM only works when the page is cross-origin isolated,
  // which Vercel does not set by default — ask for one thread up front so
  // ORT never tries to spawn workers it is not allowed to.
  const ort = env.backends?.onnx?.wasm;
  if (ort && typeof ort.numThreads === "number" && !self.crossOriginIsolated) {
    ort.numThreads = 1;
  }

  return pipeline("text-generation", AI_MODEL_ID, {
    dtype,
    device,
    progress_callback: onProgress,
  }) as Promise<TextGenerationPipeline>;
}

async function run(): Promise<TextGenerationPipeline | null> {
  setAiStatus({
    phase: "loading",
    progress: 0,
    error: null,
    device: null,
    detail: "Preparing browser AI…",
  });

  const webgpu = await canUseWebGpu();

  if (webgpu) {
    try {
      const pipe = await createPipeline("webgpu", WEBGPU_DTYPE);
      setAiStatus({
        phase: "ready",
        device: "webgpu",
        progress: 100,
        detail: "Browser AI · WebGPU",
        error: null,
      });
      return pipe;
    } catch (err) {
      // WebGPU is optional — fall through to WASM rather than give up.
      console.warn("[ai] WebGPU init failed, falling back to WASM:", err);
      setAiStatus({
        phase: "loading",
        progress: 0,
        detail: "WebGPU unavailable — switching to WASM…",
      });
    }
  }

  try {
    const pipe = await createPipeline("wasm", WASM_DTYPE);
    setAiStatus({
      phase: "ready",
      device: "wasm",
      progress: 100,
      detail: "Browser AI · WASM",
      error: null,
    });
    return pipe;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[ai] WASM model load failed:", err);
    setAiStatus({
      phase: "error",
      device: null,
      progress: 0,
      detail: "Browser AI unavailable — rules mode",
      error: message,
    });
    return null;
  }
}

/**
 * Starts (or joins) the single model load. Resolves to `null` when the model
 * cannot run in this browser — callers fall back to the rule-based engine.
 */
export function loadBrowserModel(): Promise<TextGenerationPipeline | null> {
  if (resolved) return Promise.resolve(resolved);
  if (gaveUp) return Promise.resolve(null);
  if (inFlight) return inFlight;

  inFlight = run()
    .then((pipe) => {
      resolved = pipe;
      if (!pipe) gaveUp = true;
      return pipe;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** True once a model is genuinely loaded and usable. */
export function hasModel(): boolean {
  return resolved !== null;
}
