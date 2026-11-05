/**
 * Shared text plumbing for the rule-based engine.
 *
 * Everything in `src/lib/engine/rules` is DETERMINISTIC: the same syllabus
 * always produces the same topics, the same questions and the same plan. No
 * network, no model, no key — which is exactly why the site keeps working when
 * the browser AI cannot run.
 */

const STOPWORDS = new Set([
  "a", "an", "the", "of", "and", "or", "to", "in", "for", "with", "on", "at",
  "by", "from", "as", "is", "are", "was", "were", "be", "been", "it", "its",
  "this", "that", "these", "those", "into", "than", "then", "also", "such",
  "any", "all", "each", "every", "which", "who", "whom", "what", "when",
  "where", "how", "why", "not", "no", "do", "does", "did", "has", "have",
  "had", "will", "would", "can", "could", "should", "may", "might", "shall",
  "about", "under", "over", "between", "both", "more", "most", "other",
  "using", "used", "use", "via", "per", "up", "out", "if", "their", "there",
  "here", "one", "two", "three", "first", "second", "new", "well", "much",
  "many", "unit", "chapter", "module", "topic", "section", "part", "lesson",
]);

/** Lower-cased, de-punctuated words that carry meaning. */
export function tokenize(text: string, keepShort = false): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#.]+/gu, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[.\-–—]+|[.\-–—]+$/g, ""))
    .filter((w) => (keepShort ? w.length > 1 : w.length > 2))
    .filter((w) => !STOPWORDS.has(w));
}

export function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Collapses the whitespace runs a PDF/DOCX export always leaves behind. */
export function tidy(text: string): string {
  return text.replace(/\u0000/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Splits a syllabus/paper into lines, keeping a stable index so later passes
 * can ask "which line did this come from".
 */
export function lines(text: string): string[] {
  return tidy(text)
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim());
}

/** Words a student would type into YouTube for this thing. */
export function keywordsFrom(title: string, extra: string[] = [], limit = 8): string[] {
  const seen = new Set<string>();
  const push = (word: string) => {
    const clean = word.trim().slice(0, 60);
    if (clean.length > 1 && !seen.has(clean.toLowerCase())) seen.add(clean.toLowerCase());
  };

  // Keep multi-word technical phrases whole before tokenising them apart.
  for (const phrase of extra) {
    for (const word of phrase.split(/[\s,;()\/]+/)) push(word);
  }
  for (const word of tokenize(title, true)) push(word);

  return [...seen].slice(0, limit);
}

/**
 * Scores how well a block of text matches a set of terms.
 * Title-ish terms count double because "Determinants" beating "Matrices"
 * must actually mean something.
 */
export function overlapScore(text: string, terms: string[], weight = 1): number {
  if (terms.length === 0) return 0;
  const haystack = ` ${tokenize(text).join(" ")} `;
  let score = 0;
  for (const term of terms) {
    const words = tokenize(term);
    if (words.length === 0) continue;
    const joined = words.join(" ");
    if (words.length > 1) {
      if (haystack.includes(` ${joined} `)) score += weight * 2;
    } else if (haystack.includes(` ${joined} `)) {
      score += weight;
    }
  }
  return score;
}

/** Sentence-ish split that keeps "Q4. Explain …" and numbered points intact. */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?;])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
}
