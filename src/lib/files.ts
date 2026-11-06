/**
 * Shared upload rules for BOTH uploaders (syllabus files and previous-year
 * papers) so validation, dedupe and size limits behave identically in each:
 *   - format classification (pdf / docx / text / image)
 *   - a dedupe key (same name + same size = the same file)
 *   - the Vercel body-size limit
 *   - a client-side image shrinker so multi-megabyte phone photos still fit
 */

export type FileKind = "pdf" | "docx" | "text" | "image" | "unknown";

/** Vercel caps request bodies at 4.5 MB — stay safely under it. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
/** The syllabus box (and the analysis step) cap at 24k characters. */
export const MAX_SYLLABUS_CHARS = 24000;

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Classify from the file name (papers keep only their name in state). */
export function kindFromName(name: string): FileKind {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf")) return "pdf";
  if (n.endsWith(".docx")) return "docx";
  if (/\.(txt|md|markdown|csv|text)$/.test(n)) return "text";
  if (/\.(jpg|jpeg|png|webp|bmp|gif|tiff?)$/.test(n)) return "image";
  return "unknown";
}

/** Classify a real File — name first, MIME type as the fallback. */
export function kindOf(file: File): FileKind {
  const byName = kindFromName(file.name);
  if (byName !== "unknown") return byName;
  if (file.type === "application/pdf") return "pdf";
  if (file.type === DOCX_MIME) return "docx";
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("text/")) return "text";
  return "unknown";
}

/** Short chip label shown next to every file. */
export function kindLabel(kind: FileKind): string {
  switch (kind) {
    case "pdf":
      return "PDF";
    case "docx":
      return "DOCX";
    case "text":
      return "TXT";
    case "image":
      return "IMG";
    default:
      return "FILE";
  }
}

/** Dedupe key — re-selecting the exact same file is a no-op, not a duplicate. */
export function uploadKey(file: File): string {
  return `${file.name}:${file.size}`;
}

/**
 * Returns a human-readable error, or null when the file may be uploaded.
 * Oversized IMAGES are checked after shrinking instead (see shrinkImage).
 */
export function validateUpload(file: File): string | null {
  if (file.size === 0) {
    return "File khali hai (0 bytes) — isko hatao ya sahi file choose karo.";
  }
  const kind = kindOf(file);
  if (kind === "unknown") {
    return "Unsupported format — sirf PDF, DOCX, TXT/MD/CSV ya image (JPG/PNG/WEBP) chalega.";
  }
  if (kind !== "image" && file.size > MAX_UPLOAD_BYTES) {
    return "4 MB se bada hai — compress karke dobara try karo.";
  }
  return null;
}

/* ----------------------------- image shrinking ---------------------------- */

/** Phone photos are often 4-8 MB; re-encode down to about this. */
const SHRINK_TARGET = 1.2 * 1024 * 1024;
/** Only images above this are touched at all. */
const SHRINK_OVER = 1.5 * 1024 * 1024;
/** Longest edge after scaling — still far above what OCR reads comfortably. */
const MAX_DIMENSION = 2200;

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not re-encode the image."))),
      type,
      quality,
    );
  });
}

/**
 * Big photos are re-encoded as JPEG (max 2200px, quality stepping down only
 * while needed) so every upload fits inside Vercel's 4.5 MB body limit —
 * without hurting OCR, which reads comfortably at this resolution.
 *
 * Files that are already small, or cannot be decoded at all, pass through
 * untouched: a genuinely broken image should surface the server's real error,
 * not a misleading one from here.
 */
export async function shrinkImage(file: File): Promise<File> {
  if (file.size <= SHRINK_OVER) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    let quality = 0.9;
    let blob = await canvasToBlob(canvas, "image/jpeg", quality);
    while (blob.size > SHRINK_TARGET && quality > 0.62) {
      quality -= 0.14;
      blob = await canvasToBlob(canvas, "image/jpeg", quality);
    }
    if (blob.size >= file.size) return file; // no benefit — keep the original

    const base = file.name.replace(/\.[^.]+$/, "") || "image";
    return new File([blob], `${base}.jpg`, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } catch {
    return file;
  }
}
