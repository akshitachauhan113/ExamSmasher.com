"use client";

import { useMemo } from "react";
import { texHtml } from "@/lib/math";

interface TexProps {
  /** Plain text that may contain $...$ / $$...$$ equations. */
  text: string;
  className?: string;
}

/**
 * Renders a plain-text field with its equations typeset notebook-style.
 *
 * The model writes formulas as LaTeX everywhere; anything rendered as a
 * React text node (note bullets, flashcard faces, question text) would show
 * that LaTeX raw. Wrapping the field in <Tex/> typesets it in place — the
 * surrounding text stays escaped, only KaTeX output is injected.
 */
export function Tex({ text, className }: TexProps) {
  const html = useMemo(() => texHtml(text), [text]);
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
