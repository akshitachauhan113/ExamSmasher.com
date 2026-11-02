/**
 * A deliberately small Markdown renderer for the AI study-plan output.
 * Supports headings, bold/italic/inline code, links, lists, tables, rules
 * and LaTeX equations ($...$ / $$...$$ typeset with KaTeX, notebook style).
 * Everything is HTML-escaped first, so model output cannot inject markup.
 */

import { escapeHtml, renderTex, replaceMath } from "./math";

/**
 * Math is pulled out BEFORE escaping and markdown formatting, parked behind a
 * NUL-delimited placeholder, and written back as KaTeX HTML afterwards —
 * so an exponent inside `$x^2$` never becomes `<sup>` and a `<` inside
 * `\alpha < 1` never becomes an HTML tag.
 */
function parkMath(text: string): { text: string; math: string[] } {
  const math: string[] = [];
  const parked = replaceMath(text, (tex, displayMode) => {
    const token = `\u0000M${math.length}\u0000`;
    math.push(renderTex(tex, displayMode));
    return token;
  });
  return { text: parked, math };
}

function unparkMath(html: string, math: string[]): string {
  return html.replace(/\u0000M(\d+)\u0000/g, (_m, index: string) => math[Number(index)] ?? "");
}

function isSafeUrl(url: string): boolean {
  return /^(https?:\/\/|\/|#|mailto:)/i.test(url.trim());
}

function splitRow(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function inline(text: string): string {
  const { text: parked, math } = parkMath(text.replace(/\u0000/g, ""));
  let out = escapeHtml(parked);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) =>
    isSafeUrl(url) ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>` : label,
  );
  return unparkMath(out, math);
}

export function renderMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let inUl = false;
  let inOl = false;

  const closeLists = () => {
    if (inUl) {
      out.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      out.push("</ol>");
      inOl = false;
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Display equation — $$...$$ or \[...\], on one line or several.
    if (trimmed.startsWith("$$") || trimmed.startsWith("\\[")) {
      closeLists();
      const closer = trimmed.startsWith("$$") ? "$$" : "\\]";
      let tex = trimmed.slice(2);
      if (tex.endsWith(closer)) {
        tex = tex.slice(0, -closer.length);
        // Single-line equation — consume this line or the loop never advances.
        i++;
      } else {
        i++;
        while (i < lines.length && !lines[i].includes(closer)) {
          tex += `${tex ? "\n" : ""}${lines[i]}`;
          i++;
        }
        if (i < lines.length) {
          const closing = lines[i].trim();
          tex += `${tex ? "\n" : ""}${closing.slice(0, closing.lastIndexOf(closer))}`;
          i++;
        }
      }
      out.push(`<div class="math-block">${renderTex(tex, true)}</div>`);
      continue;
    }

    // Table: header row followed by a |---| separator row.
    if (
      /^\s*\|.*\|\s*$/.test(line) &&
      i + 1 < lines.length &&
      /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])
    ) {
      closeLists();
      const headers = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      out.push(
        `<table><thead><tr>${headers
          .map((h) => `<th>${inline(h)}</th>`)
          .join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`,
      );
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      closeLists();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      closeLists();
      out.push("<hr/>");
      i++;
      continue;
    }

    const ulItem = /^\s*[-*]\s+(.*)$/.exec(line);
    if (ulItem) {
      if (!inUl) {
        closeLists();
        out.push("<ul>");
        inUl = true;
      }
      out.push(`<li>${inline(ulItem[1])}</li>`);
      i++;
      continue;
    }

    const olItem = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (olItem) {
      if (!inOl) {
        closeLists();
        out.push("<ol>");
        inOl = true;
      }
      out.push(`<li>${inline(olItem[1])}</li>`);
      i++;
      continue;
    }

    if (!line.trim()) {
      closeLists();
      i++;
      continue;
    }

    closeLists();
    out.push(`<p>${inline(line)}</p>`);
    i++;
  }

  closeLists();
  return out.join("\n");
}
