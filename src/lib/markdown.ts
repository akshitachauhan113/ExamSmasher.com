/**
 * A deliberately small Markdown renderer for the AI study-plan output.
 * Supports headings, bold/italic/inline code, links, lists, tables and rules.
 * Everything is HTML-escaped first, so model output cannot inject markup.
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
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
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) =>
    isSafeUrl(url) ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>` : label,
  );
  return out;
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
