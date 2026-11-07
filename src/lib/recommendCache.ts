import {
  buildRecommendations,
  recommendationSignature,
  type BuildRecommendationsInput,
} from "@/lib/engine/rules/recommend";
import type { RecommendationMode, RecommendationPlan } from "@/lib/types";

/**
 * Persists the generated recommendation plans so a reload reuses them
 * instead of rebuilding — keyed by a signature of the exact inputs, so a
 * changed syllabus/priority/language can never serve a stale plan.
 *
 * Only derived data lives here: any plan can be rebuilt from the cached
 * analysis in milliseconds, and "Start over" wipes it with the rest.
 */

const KEY = "es-recommendations-v1";

interface CacheSlot {
  signature: string;
  plan: RecommendationPlan;
}

type CacheShape = Partial<Record<RecommendationMode, CacheSlot>>;

function readCache(): CacheShape {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as CacheShape;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeCache(cache: CacheShape): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* quota or storage blocked — plans just rebuild on next load */
  }
}

/** Returns the cached plan when the inputs still match, else builds + caches. */
export function planForRecommendations(input: BuildRecommendationsInput): RecommendationPlan {
  const signature = recommendationSignature(input);

  if (typeof window !== "undefined") {
    const cached = readCache()[input.mode];
    if (cached && cached.signature === signature && cached.plan?.ok) return cached.plan;
  }

  const plan = buildRecommendations(input);
  if (typeof window !== "undefined") {
    const cache = readCache();
    cache[input.mode] = { signature, plan };
    writeCache(cache);
  }
  return plan;
}

export function clearCachedRecommendations(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}
