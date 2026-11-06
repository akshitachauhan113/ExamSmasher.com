"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  kindLabel,
  kindOf,
  MAX_SYLLABUS_CHARS,
  MAX_UPLOAD_BYTES,
  shrinkImage,
  uploadKey,
  validateUpload,
  type FileKind,
} from "@/lib/files";
import { AlertIcon, CheckIcon, CloseIcon, UploadIcon } from "./Icons";

interface FileDropzoneProps {
  /** Receives the COMBINED text of every file that has been read so far. */
  onExtracted: (text: string, fileName: string) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}

interface ExtractFileResult {
  fileName?: string;
  ok?: boolean;
  text?: string;
  method?: string;
  error?: string;
}

interface ExtractResponse {
  ok: boolean;
  text?: string;
  results?: ExtractFileResult[];
  method?: string;
  fileName?: string;
  truncated?: boolean;
  error?: string;
}

const ACCEPT = ".pdf,.docx,.txt,.md,.markdown,.csv,image/*";

/** Photos group into ONE OCR request while they fit in a body safely. */
const IMAGE_BATCH_BYTES = 3.2 * 1024 * 1024;
const IMAGE_BATCH_MAX = 12;

type EntryStatus = "queued" | "reading" | "done" | "error";

interface Entry {
  id: string;
  key: string;
  name: string;
  kind: FileKind;
  file: File;
  status: EntryStatus;
  text?: string;
  error?: string;
  /** Server/transient failures can be retried; local validation cannot. */
  retryable?: boolean;
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

function errorText(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "Could not read that file.";
}

/**
 * Upload syllabus files (PDF, DOCX, TXT/MD or photos of the pages) — one or
 * many, in any combination. Every selected file shows up in the list with its
 * type, status and size, can be removed or retried on its own, and the texts
 * are COMBINED (in selection order) into the syllabus box. Nothing is dropped
 * silently: unsupported, empty, broken or oversized files stay in the list
 * with a clear per-file reason.
 */
export function FileDropzone({ onExtracted, onError, disabled }: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [readingLabel, setReadingLabel] = useState<string | null>(null);

  const entriesRef = useRef<Entry[]>([]);
  const runningRef = useRef(false);
  const cancelRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const idRef = useRef(0);
  const mountedRef = useRef(true);
  /** Last text pushed to the box — only clear it if WE put it there. */
  const lastPushedRef = useRef<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const sync = useCallback((next: Entry[]) => {
    entriesRef.current = next;
    if (mountedRef.current) setEntries(next);
  }, []);

  const update = useCallback(
    (ids: string[], patch: Partial<Entry>) => {
      const idSet = new Set(ids);
      sync(
        entriesRef.current.map((e) => (idSet.has(e.id) ? { ...e, ...patch } : e)),
      );
    },
    [sync],
  );

  /** Push the combined text of every read file into the syllabus box.
   *  `withLabel` is on only for reads — a removal pushes silently. */
  const pushCombined = useCallback(
    (list: Entry[], withLabel: boolean) => {
      const done = list.filter((e) => e.status === "done" && e.text);
      if (done.length === 0) {
        // Only wipe the box if file-derived text is actually in it — never a
        // syllabus the student typed by hand.
        if (lastPushedRef.current) {
          lastPushedRef.current = "";
          onExtracted("", "");
        }
        return;
      }
      let combined = done.map((e) => e.text).join("\n\n");
      if (combined.length > MAX_SYLLABUS_CHARS) {
        combined = combined.slice(0, MAX_SYLLABUS_CHARS);
      }
      if (combined === lastPushedRef.current) return;
      lastPushedRef.current = combined;
      const label = !withLabel
        ? ""
        : done.length === 1
          ? done[0].name
          : `${done[0].name} + ${done.length - 1} more`;
      onExtracted(combined, label);
    },
    [onExtracted],
  );

  const pump = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      while (true) {
        const list = entriesRef.current;
        const start = list.findIndex((e) => e.status === "queued");
        if (start === -1 || cancelRef.current) break;

        // Group CONSECUTIVE queued photos into one OCR request (one worker,
        // order preserved); every other format is read on its own so its
        // result and any error stay attached to that single file.
        const group: Entry[] = [];
        let bytes = 0;
        for (let i = start; i < list.length && list[i].status === "queued"; i += 1) {
          if (list[i].kind !== "image") break;
          if (group.length >= IMAGE_BATCH_MAX) break;
          if (group.length > 0 && bytes + list[i].file.size > IMAGE_BATCH_BYTES) break;
          group.push(list[i]);
          bytes += list[i].file.size;
        }
        const targets = group.length > 0 ? group : [list[start]];
        const targetIds = targets.map((t) => t.id);

        update(targetIds, { status: "reading", error: undefined });
        setReadingLabel(
          targets.length > 1
            ? `Reading ${targets.length} photos…`
            : `Reading ${targets[0].name}…`,
        );

        try {
          // Oversized photos are shrunk first; anything still too big fails
          // on its own without blocking the other files.
          const ready: Array<{ entry: Entry; payload: File }> = [];
          for (const target of targets) {
            const payload =
              target.kind === "image" ? await shrinkImage(target.file) : target.file;
            if (payload.size > MAX_UPLOAD_BYTES) {
              update([target.id], {
                status: "error",
                error: "4 MB se bada hai — compress karke dobara try karo.",
                retryable: false,
              });
            } else {
              ready.push({ entry: target, payload });
            }
          }
          if (ready.length === 0) continue;
          if (cancelRef.current) {
            // Cancelled while shrinking — park the ready files as pending.
            update(ready.map((r) => r.entry.id), { status: "queued" });
            break;
          }

          const form = new FormData();
          for (const item of ready) {
            form.append("file", item.payload, item.payload.name);
          }
          const controller = new AbortController();
          abortRef.current = controller;
          const response = await fetch("/api/extract", {
            method: "POST",
            body: form,
            signal: controller.signal,
          });
          const data: ExtractResponse = await response.json();

          if (data.ok && data.text) {
            ready.forEach((item, i) => {
              const result = data.results?.[i];
              if (result && !result.ok) {
                update([item.entry.id], {
                  status: "error",
                  error: result.error || "Could not read that file.",
                  retryable: true,
                });
              } else {
                update([item.entry.id], {
                  status: "done",
                  text: result?.text ?? data.text,
                  error: undefined,
                  retryable: false,
                });
              }
            });
            pushCombined(entriesRef.current, true);
          } else {
            // Whole request failed: use per-file errors when the server gave
            // them, otherwise the same message applies to every file in it.
            ready.forEach((item, i) => {
              update([item.entry.id], {
                status: "error",
                error:
                  data.results?.[i]?.error ||
                  data.error ||
                  "Could not read that file.",
                retryable: true,
              });
            });
          }
        } catch (err) {
          if (isAbort(err)) {
            update(targetIds, { status: "queued" }); // cancel = pause, not lose
            break;
          }
          update(targetIds, {
            status: "error",
            error: errorText(err),
            retryable: true,
          });
        } finally {
          abortRef.current = null;
          setReadingLabel(null);
        }
      }
    } finally {
      runningRef.current = false;
      // A file added right as the loop finished would otherwise be stranded.
      if (!cancelRef.current && entriesRef.current.some((e) => e.status === "queued")) {
        setTimeout(() => void pump(), 0);
      }
    }
  }, [pushCombined, update]);

  const addFiles = useCallback(
    (files: FileList | File[] | null) => {
      const list = Array.from(files ?? []);
      if (list.length === 0) return;
      onError("");
      const existing = new Set(entriesRef.current.map((e) => e.key));
      const seen = new Set<string>();
      const added: Entry[] = [];
      const skipped: string[] = [];
      for (const file of list) {
        const key = uploadKey(file);
        if (existing.has(key) || seen.has(key)) {
          skipped.push(file.name);
          continue;
        }
        seen.add(key);
        const validation = validateUpload(file);
        added.push({
          id: `f${(idRef.current += 1)}`,
          key,
          name: file.name,
          kind: kindOf(file),
          file,
          status: validation ? "error" : "queued",
          error: validation ?? undefined,
          retryable: validation ? false : undefined,
        });
      }
      sync([...entriesRef.current, ...added]);
      setNotice(
        skipped.length > 0
          ? `${skipped.length} file pehle se added hai — skip kar diya: ${skipped
              .slice(0, 3)
              .join(", ")}`
          : null,
      );
      if (added.some((a) => a.status === "queued")) {
        cancelRef.current = false;
        void pump();
      }
    },
    [onError, pump, sync],
  );

  const removeEntry = useCallback(
    (id: string) => {
      const next = entriesRef.current.filter((e) => e.id !== id);
      sync(next);
      pushCombined(next, false);
    },
    [pushCombined, sync],
  );

  const retryEntry = useCallback(
    (id: string) => {
      cancelRef.current = false;
      update([id], { status: "queued", error: undefined });
      void pump();
    },
    [pump, update],
  );

  const cancel = useCallback(() => {
    cancelRef.current = true;
    abortRef.current?.abort();
  }, []);

  const resume = useCallback(() => {
    cancelRef.current = false;
    void pump();
  }, [pump]);

  const doneCount = entries.filter((e) => e.status === "done").length;
  const queuedCount = entries.filter((e) => e.status === "queued").length;
  const errorCount = entries.filter((e) => e.status === "error").length;
  const readingCount = entries.filter((e) => e.status === "reading").length;
  const combinedChars = Math.min(
    MAX_SYLLABUS_CHARS,
    entries
      .filter((e) => e.status === "done" && e.text)
      .reduce((sum, e) => sum + (e.text?.length ?? 0), 0),
  );
  const busy = readingCount > 0;

  const title = busy
    ? (readingLabel ?? "Reading files…")
    : entries.length > 0
      ? doneCount === entries.length
        ? `${doneCount} file${entries.length > 1 ? "s" : ""} padh li gayi`
        : `${doneCount}/${entries.length} files padhi gayi`
      : "Syllabus file daalo";

  return (
    <div>
      <div
        className="relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center transition"
        style={{
          borderColor: dragging ? "var(--brand)" : "var(--line)",
          background: dragging ? "color-mix(in srgb, var(--brand) 7%, transparent)" : "transparent",
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled) addFiles(e.dataTransfer.files);
        }}
      >
        <span
          className="mb-2 flex h-10 w-10 items-center justify-center rounded-full"
          style={{
            background: "color-mix(in srgb, var(--brand) 12%, transparent)",
            color: "var(--brand)",
          }}
        >
          {busy ? (
            <span
              className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
              aria-hidden
            />
          ) : doneCount > 0 ? (
            <CheckIcon width={18} height={18} />
          ) : (
            <UploadIcon width={18} height={18} />
          )}
        </span>
        <p className="text-sm font-bold">{title}</p>
        <p className="mt-1 max-w-md text-xs leading-relaxed text-[var(--muted)]">
          {entries.length > 0
            ? `${combinedChars.toLocaleString()} / ${MAX_SYLLABUS_CHARS.toLocaleString()} characters · PDF · DOCX · TXT · photos — order me hi combine hote hain`
            : "PDF · DOCX · TXT/MD ya syllabus ki photos — multiple files ek saath chalegi, pages ki alag-alag photo bhi chalegi"}
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            className="btn"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <UploadIcon width={15} height={15} />
            {entries.length > 0 ? "Aur files add karo" : "Choose file"}
          </button>
          {busy && (
            <button type="button" className="btn-ghost px-3 py-2 text-xs" onClick={cancel}>
              Cancel
            </button>
          )}
          {!busy && queuedCount > 0 && (
            <button type="button" className="btn-ghost px-3 py-2 text-xs" onClick={resume}>
              Read {queuedCount} pending file{queuedCount > 1 ? "s" : ""}
            </button>
          )}
        </div>
        <p className="mt-2 text-[0.68rem] text-[var(--muted)]">
          {busy ? "Large PDFs and photos take ~10-20 seconds." : "Drag & drop bhi chalega"}
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          disabled={disabled}
          aria-label="Upload syllabus files"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = ""; // re-choosing the same file is still detected
          }}
        />
      </div>

      {notice && (
        <p className="mt-2 text-xs text-[var(--muted)]">{notice}</p>
      )}

      {entries.length > 0 && (
        <ul className="mt-2 space-y-1.5" aria-label="Selected syllabus files">
          {entries.map((e) => (
            <li
              key={e.id}
              className="rounded-lg border px-2.5 py-1.5"
              style={{
                borderColor:
                  e.status === "error"
                    ? "color-mix(in srgb, var(--bad) 45%, var(--line))"
                    : "var(--line)",
                background: "var(--surface-2)",
              }}
            >
              <div className="flex items-center gap-2">
                <span className="chip shrink-0">{kindLabel(e.kind)}</span>
                <span className="min-w-0 flex-1 truncate text-xs font-semibold" title={e.name}>
                  {e.name}
                </span>
                <span className="hidden text-[0.65rem] text-[var(--muted)] sm:inline">
                  {e.file.size > 0 ? `${Math.max(1, Math.round(e.file.size / 1024))} KB` : "0 KB"}
                </span>
                {e.status === "queued" && (
                  <span className="text-[0.65rem] text-[var(--muted)]">waiting</span>
                )}
                {e.status === "reading" && (
                  <span
                    className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
                    style={{ color: "var(--brand)" }}
                    aria-label="Reading"
                  />
                )}
                {e.status === "done" && (
                  <CheckIcon
                    width={14}
                    height={14}
                    style={{ color: "var(--good, #16a34a)" }}
                  />
                )}
                {e.status === "error" && (
                  <AlertIcon width={14} height={14} style={{ color: "var(--bad)" }} />
                )}
                {e.status === "error" && e.retryable && (
                  <button
                    type="button"
                    className="text-[0.68rem] font-bold"
                    style={{ color: "var(--brand)" }}
                    onClick={() => retryEntry(e.id)}
                  >
                    Retry
                  </button>
                )}
                <button
                  type="button"
                  className="rounded p-1 text-[var(--muted)] transition hover:text-[var(--text)]"
                  aria-label={`Remove ${e.name}`}
                  onClick={() => removeEntry(e.id)}
                >
                  <CloseIcon width={13} height={13} />
                </button>
              </div>
              {e.status === "error" && e.error && (
                <p className="mt-1 text-[0.68rem] leading-snug" style={{ color: "var(--bad)" }}>
                  {e.error}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {errorCount > 0 && !busy && (
        <p className="mt-2 text-[0.68rem] text-[var(--muted)]">
          {errorCount} file fail hui (upar reason hai) — Retry dabao ya hata do.{" "}
          {doneCount > 0
            ? `${doneCount} successful file${doneCount > 1 ? "s" : ""} syllabus me included hain.`
            : ""}
        </p>
      )}
    </div>
  );
}
