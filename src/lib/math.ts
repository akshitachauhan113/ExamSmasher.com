import katex from "katex";

/**
 * Notebook-style equation rendering.
 *
 * The AI writes formulas in LaTeX (`$E = mc^2$` inline, `$$...$$` for
 * display equations). KaTeX typesets them the way a student would write them
 * in a notebook — fractions stacked, integrals with real limits — instead of
 * the raw `\frac{a}{b}` code that used to leak through as plain text.
 *
 * Everything rendered here comes from model output, so bad LaTeX never
 * breaks the page: it falls back to the escaped source text.
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

/** Renders one LaTeX expression to HTML. Broken LaTeX falls back to text. */
export function renderTex(tex: string, displayMode: boolean): string {
  const source = tex.trim();
  if (!source) return "";

  try {
    return katex.renderToString(source, {
      displayMode,
      throwOnError: false,
      strict: false,
      // HTML only — the page already renders one representation, duplicating
      // it for screen readers costs bytes without adding meaning here.
      output: "htmlAndMathml",
      fleqn: false,
    });
  } catch {
    const cls = displayMode ? "math math-fallback-block" : "math math-fallback";
    return `<span class="${cls}">${escapeHtml(source)}</span>`;
  }
}

/* -------------------------------------------------------------------------- */
/*                  delimiters shared by markdown + plain text                 */
/* -------------------------------------------------------------------------- */

/**
 * One pass over every math form the model is told to use:
 *   $$display$$   \[display\]   $inline$   \(inline\)
 *
 * `$5 and $6` style currency is protected — a lone number between dollar
 * signs is money, not maths.
 */
export function replaceMath(
  text: string,
  render: (tex: string, displayMode: boolean) => string,
): string {
  return text.replace(
    /\$\$([\s\S]+?)\$\$|\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]|\$([^$\n]+?)\$/g,
    (_match, blockDollar?: string, paren?: string, bracket?: string, inlineDollar?: string) => {
      if (typeof blockDollar === "string") return render(blockDollar, true);
      if (typeof paren === "string") return render(paren, false);
      if (typeof bracket === "string") return render(bracket, true);
      if (typeof inlineDollar === "string") {
        // Currency guard — money, not maths. Covers a lone amount ("$20")
        // and the common "5 and " shape of "$5 and $6", where the pair of
        // dollar signs would otherwise capture words as an equation.
        if (/^\s*\d[\d,.]*\s*$/.test(inlineDollar)) return `$${inlineDollar}$`;
        if (/^\s*\d/.test(inlineDollar) && /\s$/.test(inlineDollar)) return `$${inlineDollar}$`;
        return render(inlineDollar, false);
      }
      return "";
    },
  );
}

/**
 * For plain-text React fields (flashcard answers, summary bullets, question
 * text): escapes everything, then typesets any math it finds. Safe to drop
 * straight into dangerouslySetInnerHTML.
 */
export function texHtml(text: string): string {
  return replaceMath(escapeHtml(text), renderTex);
}
