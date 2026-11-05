/**
 * Reads an uploaded syllabus file and returns its text so the normal
 * analysis pipeline can continue. Supported:
 *   - .txt / .md / .csv            -> read directly
 *   - .pdf                         -> text layer via unpdf
 *   - .docx                        -> text via mammoth
 *   - .jpg / .png / .webp / ...    -> on-device OCR (tesseract.js)
 *
 * Everything here runs without any API key. Photos are read by OCR rather
 * than a vision model, because no key is required any more.
 */

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8 MB
const MAX_FILES = 4;
const MAX_TEXT_CHARS = 24000;

interface ExtractResponse {
  ok: boolean;
  text?: string;
  method?: "direct" | "pdf" | "docx" | "ocr";
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
              "This PDF has no selectable text (it is a scan). Export its pages as photos and upload those — images are read automatically on-device, no API key needed.",
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
    // Read on-device with Tesseract OCR: no API key, no external vision call,
    // and the upload never leaves the machine running the OCR.
    if (files.every((f) => f.type.startsWith("image/"))) {
      try {
        const text = await ocrImages(buffers);
        return respond(text, "ocr", primary.name, files.length);
      } catch (ocrError) {
        const detail = ocrError instanceof Error ? ocrError.message : "Could not read the image.";
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

/**
 * Reads text straight off an image with Tesseract OCR. Runs entirely on this
 * machine — no API key, no quota, no data leaves the machine except the
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
