/**
 * Helpers shared by the loader and the generator.
 *
 * Kept in their own module so `model.ts` (which decides whether the model is
 * usable at all) and `generate.ts` (which decides whether one reply is usable)
 * agree on exactly what "usable" means — no second opinion, no drift.
 */

/**
 * Pulls the assistant's text out of a pipeline result.
 *
 * Chat input comes back as the full message list, plain input as a string;
 * anything else means the model said nothing we can read.
 */
export function extractAssistantText(output: unknown): string {
  const entry = Array.isArray(output)
    ? (output[0] as { generated_text?: unknown } | undefined)
    : undefined;
  const generated = entry?.generated_text;

  if (typeof generated === "string") return generated;

  if (Array.isArray(generated)) {
    const last = generated[generated.length - 1] as
      | { content?: unknown }
      | string
      | undefined;
    if (last && typeof last === "object" && typeof last.content === "string") {
      return last.content;
    }
    if (typeof last === "string") return last;
  }

  return "";
}

/**
 * Cheap sanity filter for model output.
 *
 * On some GPUs the WebGPU session loads happily and then produces noise —
 * punctuation soup with no real words in it. That must never reach a student
 * (and must never be labelled "browser AI"), so it is rejected here and the
 * caller falls back to the rule-based engine.
 *
 * Short replies are waved through: "42" or "OK" are legitimate answers and
 * there is nothing to judge them by.
 */
export function looksLikeText(value: string): boolean {
  const text = value.trim();
  if (text.length < 2) return false;

  const letters = text.match(/[\p{L}]/gu)?.length ?? 0;
  const alnum = text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;

  if (alnum < 8) return true;
  return letters / alnum >= 0.5;
}
