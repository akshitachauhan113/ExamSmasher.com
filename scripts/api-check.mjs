/**
 * API smoke tests for the restored functionality — run with:
 *   node scripts/api-check.mjs [baseUrl]
 *
 * Tests, honestly and offline-ish (each Gemini call costs real tokens):
 *   1. POST /api/videos  → real YouTube metadata, `limit` + `exclude` honoured
 *   2. POST /api/notes   → topic scope, 12-element structure, via:"server"
 *   3. POST /api/notes   → document scope (whole syllabus markdown)
 *   4. POST /api/videos  → bad request → honest ok:false reason (no crash)
 *
 * Prints PASS/FAIL per case and exits non-zero if anything failed.
 */

const BASE = process.argv[2] ?? "http://localhost:3000";

const SYLLABUS = `Unit 1: Thermodynamics
- First law of thermodynamics: internal energy, heat and work
- Second law of thermodynamics: entropy, irreversible processes
- Isothermal and adiabatic processes
- Carnot engine and its efficiency
Unit 2: Kinematics
- Equations of motion with constant acceleration
- Projectile motion and range
- Relative velocity`;

const TOPIC = {
  title: "Thermodynamics",
  description: "First and second law of thermodynamics, entropy, processes, Carnot engine",
  keywords: ["thermodynamics", "entropy", "first law", "Carnot engine"],
  chapter: "Unit 1: Thermodynamics",
};

const EXAM_QUESTIONS = [
  "Explain the first law of thermodynamics with an example. (2023)",
  "Define entropy and state the second law of thermodynamics. (2022)",
];

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

async function post(path, body, timeoutMs = 150_000) {
  const started = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, elapsedMs: Date.now() - started };
}

/* 1 · videos: real metadata, per-key limit honoured */
{
  try {
    const { status, json, elapsedMs } = await post("/api/videos", {
      queries: [
        { key: "t1", query: "Thermodynamics Physics Class 11 full lecture" },
        { key: "t2", query: "Kinematics Physics Class 11 full lecture" },
      ],
      topics: [
        { title: TOPIC.title, keywords: TOPIC.keywords },
        { title: "Kinematics", keywords: ["equations of motion", "projectile"] },
      ],
      limit: 4,
      exclude: ["dQw4w9WgXcQ"], // must not appear in results
    });
    const t1 = json?.results?.t1 ?? [];
    const t2 = json?.results?.t2 ?? [];
    const fieldsOk = t1.every(
      (v) =>
        typeof v.id === "string" &&
        typeof v.title === "string" &&
        v.title.length > 0 &&
        typeof v.url === "string" &&
        v.url.includes("youtube.com/watch") &&
        typeof v.thumb === "string" &&
        v.thumb.includes("i.ytimg.com"),
    );
    const excluded = ![...t1, ...t2].some((v) => v.id === "dQw4w9WgXcQ");
    record(
      "videos: real metadata (title/thumb/url), limit, exclude",
      status === 200 && json?.ok === true && t1.length > 0 && t1.length <= 4 && fieldsOk && excluded,
      `status=${status} ok=${json?.ok} t1=${t1.length} t2=${t2.length} elapsed=${(elapsedMs / 1000).toFixed(1)}s` +
        (t1[0] ? ` top="${t1[0].title.slice(0, 60)}…"` : ""),
    );
  } catch (err) {
    record("videos: real metadata (title/thumb/url), limit, exclude", false, String(err));
  }
}

/* 2 · topic notes: 12-element structure written server-side */
{
  try {
    const { status, json, elapsedMs } = await post("/api/notes", {
      scope: "topic",
      subject: "Physics Class 11",
      syllabus: SYLLABUS,
      language: "hinglish",
      topic: TOPIC,
      examQuestions: EXAM_QUESTIONS,
    });
    const sections = json?.detailed ?? [];
    const headings = sections.map((s) => s.heading);
    const hasPyyHeading = headings.some((h) => /exam/i.test(h));
    const hasRevision = headings.some((h) => /revision/i.test(h));
    const hasShortOrLong = headings.some((h) => /short|long/i.test(h));
    const contentOk =
      sections.length >= 8 &&
      sections.every((s) => s.paragraphs.length > 0 && s.paragraphs.join("").trim().length > 40);
    const pyqQuoted = JSON.stringify(sections).includes("first law of thermodynamics");
    record(
      "notes(topic): 8+ real sections incl. exam + revision, via=server",
      status === 200 &&
        json?.ok === true &&
        json?.via === "server" &&
        json?.source === "ai" &&
        contentOk &&
        hasPyyHeading &&
        hasRevision &&
        hasShortOrLong &&
        pyqQuoted,
      `status=${status} via=${json?.via} sections=${sections.length} cards=${json?.cards?.length ?? 0} elapsed=${(elapsedMs / 1000).toFixed(1)}s headings="${headings.slice(0, 4).join(" / ")}…"`,
    );
  } catch (err) {
    record("notes(topic): 8+ real sections incl. exam + revision, via=server", false, String(err));
  }
}

/* 3 · document notes: markdown for the whole syllabus */
{
  try {
    const { status, json, elapsedMs } = await post("/api/notes", {
      scope: "document",
      subject: "Physics Class 11",
      syllabus: SYLLABUS,
      language: "english",
      topicTitles: [
        { title: TOPIC.title, chapter: TOPIC.chapter },
        { title: "Kinematics", chapter: "Unit 2: Kinematics" },
      ],
    });
    record(
      "notes(document): markdown built, via=server",
      status === 200 && json?.ok === true && typeof json?.markdown === "string" && json.markdown.length > 300 && json.via === "server",
      `status=${status} via=${json?.via} chars=${json?.markdown?.length ?? 0} elapsed=${(elapsedMs / 1000).toFixed(1)}s`,
    );
  } catch (err) {
    record("notes(document): markdown built, via=server", false, String(err));
  }
}

/* 4 · honest failures: bad requests must not crash */
{
  try {
    const a = await post("/api/videos", { queries: [], topics: [] });
    const b = await post("/api/notes", { scope: "topic" });
    record(
      "bad requests → honest ok:false, no crash",
      a.json?.ok === false && typeof a.json?.reason === "string" && b.json?.ok === false && typeof b.json?.reason === "string",
      `videos=${a.status}/${a.json?.reason} notes=${b.status}/${b.json?.reason}`,
    );
  } catch (err) {
    record("bad requests → honest ok:false, no crash", false, String(err));
  }
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
