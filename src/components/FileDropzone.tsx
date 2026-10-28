"use client";

import { useRef, useState } from "react";
import { AlertIcon, CheckIcon, UploadIcon } from "./Icons";

interface FileDropzoneProps {
  onExtracted: (text: string, fileName: string) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}

interface ExtractResponse {
  ok: boolean;
  text?: string;
  method?: string;
  fileName?: string;
  truncated?: boolean;
  error?: string;
}

const ACCEPT = ".pdf,.docx,.txt,.md,.markdown,.csv,image/*";

/**
 * Upload a syllabus file (PDF, DOCX, TXT/MD or a photo of the syllabus).
 * The server reads it and returns text, which then fills the syllabus box.
 */
export function FileDropzone({ onExtracted, onError, disabled }: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadedFile, setLoadedFile] = useState<string | null>(null);

  const upload = async (files: FileList | File[] | null) => {
    const list = Array.from(files ?? []);
    if (list.length === 0 || busy) return;

    onError("");
    setBusy(true);
    try {
      const form = new FormData();
      for (const file of list.slice(0, 4)) form.append("file", file);

      const response = await fetch("/api/extract", { method: "POST", body: form });
      const data: ExtractResponse = await response.json();

      if (!data.ok || !data.text) {
        throw new Error(data.error || "Could not read that file.");
      }

      const label =
        data.method === "vision"
          ? `${list[0].name} (read by AI from image)`
          : list[0].name;

      setLoadedFile(label);
      onExtracted(data.text, label);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not read that file.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="mb-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled && !busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled && !busy) void upload(e.dataTransfer.files);
        }}
        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed px-4 py-3 transition-colors"
        style={{
          borderColor: dragging ? "var(--brand)" : "var(--line)",
          background: dragging ? "color-mix(in srgb, var(--brand) 8%, transparent)" : "transparent",
        }}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl"
            style={{ background: "var(--surface-2)", color: "var(--brand)" }}
          >
            {busy ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--line)] border-t-[var(--brand)]" />
            ) : loadedFile ? (
              <CheckIcon width={17} height={17} />
            ) : (
              <UploadIcon width={17} height={17} />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              {busy ? "Reading your file…" : "File hai? Upload karo — text khud aa jayega"}
            </p>
            <p className="truncate text-xs text-[var(--muted)]">
              {loadedFile
                ? `Loaded: ${loadedFile}`
                : "PDF · DOCX · TXT/MD · ya syllabus ki photo (AI padh lega)"}
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => inputRef.current?.click()}
          className="btn-ghost shrink-0 px-3 py-2 text-xs"
        >
          {busy ? "Please wait…" : "Choose file"}
        </button>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => void upload(e.target.files)}
          aria-label="Upload syllabus file"
        />
      </div>

      {busy && (
        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-[var(--muted)]">
          <AlertIcon width={13} height={13} /> Large PDFs and photos take ~10-20 seconds.
        </p>
      )}
    </div>
  );
}
