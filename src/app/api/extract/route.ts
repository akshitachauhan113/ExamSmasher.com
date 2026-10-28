import { generateVisionText, getLlmConfig } from "@/lib/llm";

/**
 * Reads an uploaded syllabus file and returns its text so the normal
 * analysis pipeline can continue. Supported:
 *   - .txt / .md / .csv            -> read directly (no AI needed)
 *   - .pdf                         -> text layer via unpdf (no AI needed)
 *   - .docx                        -> text via mammoth (no AI needed)
 *   - .jpg / .png / .webp / ...    -> read by the AI (photo of a syllabus)
 */

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB
const MAX_FILES = 4;
const MAX_TEXT_CHARS = 8000;

interface ExtractResponse {
  ok: boolean;
  text?: string;
  method?: "direct" | "pdf" | "docx" | "vision" | "ocr";
  fileName?: string;
  pageCount?: number;
  truncated?: boolean;
  error?: string;
}

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      { ok: false, error: "Send the file as multipart/form-data." },
      { status: 400 },
    );
  }

  const files = form
    .getAll("file")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (files.length === 0) {
    return Response.json({ ok: false, error: "No file was uploaded." }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return Response.json(
      { ok: false, error: `Too many files — upload at most ${MAX_FILES}.` },
      { status: 400 },
    );
  }
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      return Response.json(
        { ok: false, error: `"${file.name}" is larger than 8 MB.` },
        { status: 413 },
      );
    }
  }

  const primary = files[0];
  const name = primary.name.toLowerCase();
  const buffers = await Promise.all(files.map(async (f) => Buffer.from(await f.arrayBuffer())));

  try {
    // ---- plain text -------------------------------------------------------
    if (/\.(txt|md|markdown|csv|text)$/.test(name) || primary.type.startsWith("text/")) {
      const text = buffers[0].toString("utf-8").replace(/\u0000/g, "").trim();
      return respond(text, "direct", primary.name);
    }

    // ---- PDF --------------------------------------------------------------
    if (name.endsWith(".pdf") || primary.type === "application/pdf") {
      const { extractText } = await import("unpdf");
      const result = await extractText(new Uint8Array(buffers[0]), { mergePages: true });
      const text = (result.text ?? "").replace(/\u0000/g, "").trim();
      if (!text) {
        return Response.json(
          {
            ok: false,
            error:
              "This PDF has no selectable text (it is a scan). Export its pages as photos and upload those — images are read automatically, no AI key needed.",
          },
          { status: 422 },
        );
      }
      return respond(text, "pdf", primary.name, result.totalPages);
    }

    // ---- DOCX -------------------------------------------------------------
    if (
      name.endsWith(".docx") ||
      primary.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer: buffers[0] });
      return respond((result.value ?? "").trim(), "docx", primary.name);
    }

    // ---- images (photo of a syllabus) -------------------------------------
    // AI vision reads it best; without an AI key we fall back to on-device
    // OCR (tesseract.js) so photos still work with zero keys configured.
    if (files.every((f) => f.type.startsWith("image/"))) {
      const images = files.map((f, index) => ({
        mimeType: f.type || "image/jpeg",
        base64: buffers[index].toString("base64"),
      }));

      let visionError: unknown = null;
      if (getLlmConfig()) {
        try {
          const text = await readImagesAsText(images);
          return respond(text, "vision", primary.name, files.length);
        } catch (err) {
          visionError = err;
        }
      }

      try {
        const text = await ocrImages(buffers);
        return respond(text, "ocr", primary.name, files.length);
      } catch (ocrError) {
        // Report the more specific failure when we have one.
        const detail =
          visionError instanceof Error
            ? visionError.message
            : ocrError instanceof Error
              ? ocrError.message
              : "Could not read the image.";
        return Response.json({ ok: false, error: detail }, { status: 422 });
      }
    }

    return Response.json(
      {
        ok: false,
        error:
          "Unsupported file type. Upload a .pdf, .docx, .txt, .md or an image (jpg/png/webp) of your syllabus.",
      },
      { status: 415 },
    );
  } catch (err) {
    return Response.json(
      {
        ok: false,
        error: err instanceof Error ? `Could not read the file: ${err.message}` : "Could not read the file.",
      },
      { status: 422 },
    );
  }
}

function respond(
  rawText: string,
  method: ExtractResponse["method"],
  fileName: string,
  pageCount?: number,
): Response {
  const text = rawText.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  if (text.length < 40) {
    return Response.json(
      {
        ok: false,
        error:
          "Almost no text could be read from that file. If it is a scanned PDF, upload a photo of it instead.",
      },
      { status: 422 },
    );
  }

  const payload: ExtractResponse = {
    ok: true,
    text: text.slice(0, MAX_TEXT_CHARS),
    method,
    fileName,
    pageCount,
    truncated: text.length > MAX_TEXT_CHARS,
  };
  return Response.json(payload);
}

async function readImagesAsText(
  images: Array<{ mimeType: string; base64: string }>,
): Promise<string> {
  const prompt = `You are transcribing a student's syllabus document. It may be a photo or screenshot of printed text, possibly at an angle or with uneven lighting.

Transcribe the syllabus COMPLETELY and EXACTLY as written:
- Keep every chapter / unit / module heading.
- Keep the original numbering and order.
- Include every listed topic, sub-topic and practical.
- Do NOT summarise, simplify, translate or add anything.
- Ignore watermarks, page numbers, headers and footers.
- Output plain text only (no markdown, no commentary).

If the images are unreadable, blurry beyond recognition, or clearly not a syllabus, reply with exactly: NOT_SYLLABUS`;

  const answer = await generateVisionText(prompt, images, {
    temperature: 0,
    maxOutputTokens: 8192,
    timeoutMs: 120_000,
  });

  const cleaned = answer.trim();
  if (!cleaned || cleaned.includes("NOT_SYLLABUS")) {
    throw new Error(
      "The image could not be read as a syllabus. Try a clearer, straight-on photo with good lighting.",
    );
  }
  return cleaned;
}

/**
 * Reads text straight off an image with Tesseract OCR. Runs entirely on this
 * machine — no API key, no quota, no data leaves the server except the
 * language model download on first use (~15 MB, cached afterwards).
 */
async function ocrImages(buffers: Buffer[]): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");

  try {
    const pages: string[] = [];
    for (const buffer of buffers) {
      const { data } = await worker.recognize(buffer);
      const page = (data.text ?? "").replace(/\u0000/g, "").trim();
      if (page) pages.push(page);
    }
    return pages.join("\n\n");
  } finally {
    await worker.terminate().catch(() => undefined);
  }
}
