import { connection } from "next/server";

import { getLlmConfig, hasYouTubeKey } from "@/lib/llm";
import type { HealthResponse } from "@/lib/types";

/** Lets the UI show a friendly setup banner instead of a cryptic failure. */
export async function GET(): Promise<Response> {
  // Key status must reflect the current env, so never prerender this route.
  await connection();

  const config = getLlmConfig();

  const payload: HealthResponse = {
    youtube: hasYouTubeKey(),
    llm: config?.provider ?? null,
    model: config?.model ?? null,
  };

  return Response.json(payload);
}
