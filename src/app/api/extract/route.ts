/**
 * Reads an uploaded file (or a batch of them) and returns text so the normal
 * analysis pipeline can continue. Every file is handled by its own format
 * reader, and each file comes back with its own status in `results`, so a
 * batch can mix PDFs, DOCX, text and photos without anything being silently
 * dropped:
 *   - .txt / .md / .csv            -> read directly
 *   - .pdf                         -> text layer via unpdf
 *   - .docx                        -> text via mammoth
 *   - .jpg / .png / .webp / ...    -> on-device OCR (tesseract.js); a run of
 *                                     consecutive photos shares one worker
 *
 * Everything here runs without any API key. Photos are read by OCR rather
 * than a vision model, because no key is required any more.
 *
 * Response shape:
 *   - `text`    combined text of all readable files, in upload order
 *   - `results` one entry per file (same order) with ok/text/method/error
 */

import { kindOf } from "@/lib/files";

const MAX_FILE_BYTES = 4 * 1024 * 1024; // stay under Vercel's 4.5 MB body limit
const MAX_FILES = 20;
const MAX_TEXT_CHARS = 24000;
const MIN_TEXT_CHARS = 40; // below this a "syllabus" is meaningless noise

type Method = "direct" | "pdf" | "docx" | "ocr";

interface FileResult {
  fileName: string;
  ok: boolean;
  text?: string;
  method?: Method;
  error?: string;
}

interface ExtractResponse {
  ok: boolean;
  text?: string;
  results?: FileResult[];
  method?: Method;
  fileName?: string;
  truncated?: boolean;
  error?: string;
}

function json(body: ExtractResponse, status: number): Response {
  return Response.json(body, { status });
}

const EMPTY_FILE = "File khali hai (0 bytes) — ise hatakar sahi file daalo.";
const UNSUPPORTED = "Unsupported file type — PDF, DOCX, TXT/MD/CSV ya image chalega.";
const TOO_LITTLE_TEXT =
  "Almost no text could be read from that file. If it is a scanned PDF, upload a photo of its pages instead.";
const OCR_FAILED =
  "Image padh nahi gayi — ye file shayad corrupt ya blur hai. Ise hatakar dobara photo lo.";

async function readBuffer(file: File): Promise<Buffer> {
  return Buffer.from(await file.arrayBuffer());
}

function fail(fileName: string, error: string): FileResult {
  return { fileName, ok: false, error };
}

function finalize(fileName: string, text: string, method: Method): FileResult {
  const cleaned = text.replace(/\u0000/g, "").trim();
  if (cleaned.length < MIN_TEXT_CHARS) return fail(fileName, TOO_LITTLE_TEXT);
  return { fileName, ok: true, text: cleaned, method };
}

/** Read one non-image file with its own format reader. */
async function readOne(file: File): Promise<FileResult> {
  if (file.size === 0) return fail(file.name, EMPTY_FILE);
  const kind = kindOf(file);
  try {
    if (kind === "text") {
      const text = (await readBuffer(file)).toString("utf-8");
      return finalize(file.name, text, "direct");
    }
    if (kind === "pdf") {
      const { extractText } = await import("unpdf");
      const result = await extractText(new Uint8Array(await readBuffer(file)), {
        mergePages: true,
      });
      const text = result.text ?? "";
      if (!text.trim()) {
        return fail(
          file.name,
          "Is PDF me koi selectable text nahi (scan PDF hai) — iske pages ki photo upload karo, images OCR se padhi jati hain.",
        );
      }
      return finalize(file.name, text, "pdf");
    }
    if (kind === "docx") {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer: await readBuffer(file) });
      return finalize(file.name, result.value ?? "", "docx");
    }
    return fail(file.name, UNSUPPORTED);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return fail(file.name, `Could not read the file: ${detail}`);
  }
}

/** OCR a run of photos with ONE worker (one language-data load for all).
 *  A broken photo returns null for ITS slot only — the rest still read. */
async function ocrPages(buffers: Buffer[]): Promise<Array<string | null>> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const pages: Array<string | null> = [];
    for (const buffer of buffers) {
      try {
        const { data } = await worker.recognize(buffer);
        pages.push(data.text ?? "");
      } catch {
        pages.push(null);
      }
    }
    return pages;
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "Send the file as multipart/form-data." }, 400);
  }

  const files = form
    .getAll("file")
    .filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) {
    return json({ ok: false, error: "No file was uploaded." }, 400);
  }
  if (files.length > MAX_FILES) {
    return json(
      { ok: false, error: `Too many files — upload at most ${MAX_FILES} per batch.` },
      400,
    );
  }
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      return json({ ok: false, error: `"${file.name}" is larger than 4 MB.` }, 413);
    }
  }

  // Walk the files in upload order, OCRing consecutive photos as one group so
  // page order is preserved and a single worker serves the whole run.
  const results: FileResult[] = [];
  try {
    let index = 0;
    while (index < files.length) {
      const file = files[index];
      if (kindOf(file) === "image") {
        const run: File[] = [];
        while (
          index < files.length &&
          kindOf(files[index]) === "image" &&
          run.length < 12
        ) {
          run.push(files[index]);
          index += 1;
        }
        let pages: Array<string | null> | null = null;
        try {
          pages = await ocrPages(await Promise.all(run.map(readBuffer)));
        } catch {
          pages = null; // worker itself failed — clear message per file below
        }
        run.forEach((image, i) => {
          const slot = pages?.[i];
          const text = slot ? slot.replace(/\u0000/g, "").trim() : "";
          if (text.length >= MIN_TEXT_CHARS) {
            results.push({ fileName: image.name, ok: true, text, method: "ocr" });
          } else {
            results.push(
              fail(image.name, slot == null ? OCR_FAILED : TOO_LITTLE_TEXT),
            );
          }
        });
        continue;
      }
      results.push(await readOne(file));
      index += 1;
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return json({ ok: false, error: `Could not read the file: ${detail}`, results }, 422);
  }

  const okResults = results.filter((r) => r.ok && r.text);
  const combined = okResults
    .map((r) => r.text ?? "")
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (combined.length < MIN_TEXT_CHARS) {
    const firstError =
      results.find((r) => !r.ok)?.error ?? TOO_LITTLE_TEXT;
    return json({ ok: false, error: firstError, results }, 422);
  }

  return json({
    ok: true,
    text: combined.slice(0, MAX_TEXT_CHARS),
    results,
    method: okResults[0]?.method,
    fileName: files[0].name,
    truncated: combined.length > MAX_TEXT_CHARS,
  }, 200);
}
