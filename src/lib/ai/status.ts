"use client";

import { useSyncExternalStore } from "react";

/**
 * Honest state of the in-browser AI model.
 *
 * There is exactly ONE source of truth for "is a model running?". Every chip,
 * banner and footer line reads from here, so the UI can never claim a model is
 * loaded while it is still downloading, and can never claim one is running
 * when it failed to start.
 */
export type AiPhase =
  /** Nothing asked for the model yet — rule-based engine is in charge. */
  | "idle"
  /** Downloading / compiling the model right now. */
  | "loading"
  /** The model is loaded and inference works. */
  | "ready"
  /** The model could not load or could not run — rules take over permanently. */
  | "error"
  /** This browser has no usable WebAssembly/WebGPU path at all. */
  | "unsupported";

export interface AiStatus {
  phase: AiPhase;
  /** The device the model ACTUALLY initialised on — never a guess. */
  device: "webgpu" | "wasm" | null;
  /** Aggregate download progress, 0-100. */
  progress: number;
  /** Short human line for the status chip ("Downloading 42%"). */
  detail: string;
  error: string | null;
  /** Model id, so the claim is checkable rather than vague. */
  model: string;
}

/** Small, instruction-tuned, quantised — small enough to download in one go. */
export const AI_MODEL_ID = "onnx-community/SmolLM2-360M-Instruct-ONNX";
export const AI_MODEL_LABEL = "SmolLM2-360M (browser)";

const INITIAL: AiStatus = {
  phase: "idle",
  device: null,
  progress: 0,
  detail: "",
  error: null,
  model: AI_MODEL_LABEL,
};

let status: AiStatus = INITIAL;
const listeners = new Set<() => void>();

export function getAiStatus(): AiStatus {
  return status;
}

/** Internal mutator — only the loader may call this. */
export function setAiStatus(patch: Partial<AiStatus>): void {
  status = { ...status, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getServerSnapshot(): AiStatus {
  return INITIAL;
}

/** React view onto the store. Safe during SSR (returns the idle snapshot). */
export function useAiStatus(): AiStatus {
  return useSyncExternalStore(subscribe, getAiStatus, getServerSnapshot);
}
