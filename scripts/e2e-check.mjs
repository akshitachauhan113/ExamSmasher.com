/**
 * End-to-end browser tests for the restored functionality — run with:
 *   node scripts/e2e-check.mjs [baseUrl] [full|fallback]
 *
 * full     (default): cases 1-10 — keys present, real videos + AI notes
 *   fallback           : cases 11-12 — run against a server whose YOUTUBE_API_KEY
 *                        and GEMINI_API_KEY were cleared; verifies the honest
 *                        fallbacks (search links + rule-engine notes)
 *
 * Uses playwright-core with the SYSTEM browser (msedge/chrome channel) — no
 * browser download. Prints PASS/FAIL per case, exits non-zero on failure.
 */

import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const MODE = process.argv[3] ?? "full";

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/* A realistic previous-year paper whose questions map onto the sample
   syllabus topics (Relations & Functions, Matrices, Integrals, Vectors…). */
const PAPER = `MATHEMATICS - CLASS 12
END SEMESTER EXAMINATION 2023
Time Allowed: 3 Hours
Maximum Marks: 80

1. Define an equivalence relation with the help of an example. Show that the relation R on the set of integers defined by R = {(a, b) : a - b is divisible by 3} is an equivalence relation. [4]

2. Let f: R to R be defined by f(x) = 3x + 2. Show that f is one-one and onto. Find the inverse of f. [4]

3. Find the principal value of cos inverse of minus half. State the domain and range of inverse trigonometric functions. [4]

4. Using elementary row operations, solve the system of equations x + 2y + 3z = 6, 2x + 3y + z = 4, 3x + y + 2z = 7. [6]

5. Using properties of determinants, prove that the determinant with rows 1 1 1, x y z, x2 y2 z2 equals (x - y)(y - z)(z - x). [4]

6. Find the integral of x sin x with respect to x using integration by parts. [4]

7. Using the first derivative test, find the local maxima and local minima of f(x) = x cube minus 3x. [4]

8. Find the area bounded by the parabola y square = 4x and the line x = 4. [4]

9. Solve the differential equation dy/dx + y = e to the power x. [4]

10. Find the dot product and the cross product of the vectors a = i + 2j - k and b = 2i - j + k. [4]
`;

async function launch() {
  for (const channel of ["msedge", "chrome"]) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch {
      /* try the next system browser */
    }
  }
  throw new Error("No system browser found (tried msedge, chrome)");
}

const tab = (page, name) =>
  page.locator('[role="tablist"][aria-label="Analysis sections"] [role="tab"]', { hasText: name });

async function analyseSample(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Try a sample syllabus" }).click();
  await page.locator('button:has-text("Syllabus analyse karo")').click();
  await page.locator("#analysis").waitFor({ timeout: 60_000 });
  // Step 2 (PYQ papers) shows on the Overview tab — skip it so the per-topic
  // results (search links + video sections) are built right away.
  const skip = page.locator('button:has-text("Skip karo → search links")');
  try {
    await skip.waitFor({ state: "visible", timeout: 8_000 });
    await skip.click();
  } catch {
    /* already past that step (restored analysis) */
  }
}

async function openComplete(page) {
  await tab(page, "Complete Syllabus").click();
  const expandAll = page.locator('button:has-text("Sab expand karo")');
  if (await expandAll.isVisible().catch(() => false)) await expandAll.click();
  await page.locator("section[data-topic-id]").first().waitFor({ timeout: 30_000 });
}

/** Reads every per-topic video section out of the DOM. */
const collectVideos = () =>
  [...document.querySelectorAll("[data-topic-videos]")].map((sec) => {
    const recLink = sec.querySelector('a[aria-label^="Watch on YouTube"]');
    const recImg = sec.querySelector('img[src*="i.ytimg.com"]');
    const meta = recLink?.nextElementSibling?.textContent?.trim() ?? "";
    const chips = [...sec.querySelectorAll(".chip")].map((c) => c.textContent.trim());
    const coverageChip = chips.find((c) => /^≈\d+% syllabus$/.test(c)) ?? null;
    const topicsChip = chips.find((c) => /^\d+\/\d+ topics$/.test(c)) ?? null;
    const recHref = recLink?.href ?? null;
    const others = [...sec.querySelectorAll("[data-video-id]")].map((li) => ({
      id: li.getAttribute("data-video-id"),
      href: li.querySelector('a[href*="youtube.com/watch"]')?.href ?? null,
      thumb: li.querySelector('img[src*="i.ytimg.com"]')?.src ?? null,
    }));
    const fallbackLinks = sec.querySelectorAll('a[href*="youtube.com/results"]').length;
    const fallbackLabel = /YouTube API abhi available nahi|koi suitable lecture nahi mila/.test(
      sec.textContent ?? "",
    );
    return {
      topicId: sec.getAttribute("data-topic-videos"),
      recommended: Boolean(recLink && recImg),
      recId: recHref ? (recHref.match(/[?&]v=([\w-]{6,})/) ?? [])[1] ?? null : null,
      recTitle: recLink?.textContent?.trim() ?? null,
      recHref,
      thumb: recImg?.src ?? null,
      meta,
      coverageChip,
      matched: topicsChip ? Number(topicsChip.split("/")[0]) : 0,
      others,
      fallbackLinks,
      fallbackLabel,
      loading: /Dhoond rahe hain/.test(sec.textContent ?? ""),
    };
  });

async function generateNotesFor(page, topicSection) {
  const topicId = await topicSection.getAttribute("data-topic-id");
  const notesRoot = topicSection.locator(`#topic-notes-${topicId}`);
  await topicSection.locator('button:has-text("View Notes")').click();
  const gen = notesRoot.locator('button:has-text("Generate")').first();
  await gen.waitFor({ timeout: 15_000 });
  await gen.click();
  await notesRoot.locator("h4").first().waitFor({ timeout: 180_000 });
  return notesRoot.evaluate((el) => {
    const headings = [...el.querySelectorAll("h4")].map((h) => h.textContent.trim());
    return {
      headings,
      text: el.textContent ?? "",
      bullets: el.querySelectorAll("li").length,
      cards: el.querySelectorAll("details").length,
      footer: [...el.querySelectorAll("p")].map((p) => p.textContent).join(" | "),
    };
  });
}

const significantWords = (title) =>
  title
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 5);

async function run() {
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1360, height: 940 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));

  try {
    /* ---------------- case 1 · sample syllabus → analysis ---------------- */
    await analyseSample(page);
    await tab(page, "Complete Syllabus").waitFor({ timeout: 15_000 });
    const unitCount = await page.locator("#analysis").locator('text=/\\d+ units? ·/').count();
    await openComplete(page);
    const units = await page.locator("section[data-unit-key]").count();
    const topics = await page.locator("section[data-topic-id]").count();
    record(
      "1. Sample syllabus analysed into units & topics",
      unitCount > 0 && units >= 5 && topics >= 10,
      `units=${units} topics=${topics}`,
    );

    if (MODE === "fallback") {
      return await runFallback(page);
    }

    /* ------------- cases 2-4 · real per-topic videos ------------- */
    await page
      .locator('[data-topic-videos] img[src*="i.ytimg.com"]')
      .first()
      .waitFor({ timeout: 90_000 });
    const videos = await page.evaluate(collectVideos);
    const withRec = videos.filter((v) => v.recommended);
    const first = withRec[0] ?? {};

    const metaParts = (first.meta ?? "").split("·").map((s) => s.trim());
    const durationOk = /\d+:\d{2}(:\d{2})?/.test(first.meta ?? "");
    record(
      "2. Recommended video has REAL thumbnail/title/channel/duration/link",
      Boolean(
        first.recommended &&
          first.recId &&
          first.recTitle &&
          first.recTitle.length > 8 &&
          first.thumb?.includes("i.ytimg.com/vi/") &&
          first.recHref?.includes("youtube.com/watch?v=") &&
          metaParts[0]?.length > 0 &&
          (durationOk || (first.meta ?? "").includes("—")) &&
          first.coverageChip,
      ),
      `title="${(first.recTitle ?? "").slice(0, 55)}…" channel=${metaParts[0] ?? "-"} meta="${(first.meta ?? "").slice(0, 60)}" chip=${first.coverageChip ?? "-"}`,
    );

    const altCount = withRec.reduce((n, v) => n + v.others.length, 0);
    const othersWithMeta = withRec.every((v) =>
      v.others.every((o) => o.href?.includes("youtube.com/watch") && o.thumb?.includes("i.ytimg.com")),
    );
    record(
      "3. Multiple alternative videos with real metadata",
      withRec.length >= 3 && altCount >= 3 && othersWithMeta,
      `topicsWithVideo=${withRec.length} alternatives=${altCount} allReal=${othersWithMeta}`,
    );

    const allIds = videos.flatMap((v) => [v.recId, ...v.others.map((o) => o.id)]).filter(Boolean);
    const dupes = allIds.filter((id, i) => allIds.indexOf(id) !== i);
    const relevant = withRec.filter((v) => v.matched >= 1).length;
    record(
      "4. Topic-relevant (syllabus match) + no duplicate video across topics",
      dupes.length === 0 && relevant >= 3,
      `ids=${allIds.length} dupes=${dupes.length} topicsWithMatchedTitle=${relevant}/${withRec.length}`,
    );

    /* ---------------- case 5 · action bar: preview player ---------------- */
    try {
      const firstTopic = page.locator("section[data-topic-id]").filter({ has: page.locator("[data-topic-videos] img") }).first();
      const watchBtn = firstTopic.locator('button:has-text("Watch recommended video")');
      await watchBtn.waitFor({ timeout: 30_000 });
      const watchEnabled = await watchBtn.isEnabled();
      await watchBtn.click();
      await page.locator('iframe[src*="youtube.com/embed/"]').waitFor({ timeout: 15_000 });
      const embed = await page.locator('iframe[src*="youtube.com/embed/"]').getAttribute("src");
      await page.locator('button[aria-label="Close player"]').click();
      await page.locator('iframe[src*="youtube.com/embed/"]').waitFor({ state: "detached", timeout: 10_000 });
      const othersBtn = firstTopic.locator('button:has-text("View other videos")');
      const othersEnabled = await othersBtn.isEnabled().catch(() => false);
      record(
        "5. Action bar: Watch recommended → in-app player opens & closes; Other videos enabled",
        watchEnabled && embed?.includes("/embed/") && othersEnabled,
        `embed=${embed?.slice(0, 60)} othersEnabled=${othersEnabled}`,
      );
    } catch (err) {
      record("5. Action bar: Watch recommended → in-app player opens & closes; Other videos enabled", false, String(err).slice(0, 160));
    }

    /* ---------------- case 6 · PYQ upload → plan → topic badge ---------------- */
    let pyqTopicId = null;
    try {
      const paperFile = path.join(os.tmpdir(), "examsmasher-pyq-sample.txt");
      fs.writeFileSync(paperFile, PAPER, "utf8");
      await tab(page, "PYQ Analysis").click();
      await page.locator('input[aria-label="Upload previous-year papers"]').setInputFiles(paperFile);
      await page.locator('button:has-text("Read questions")').click();
      const readSpan = page.locator('text=/\\d+ questions read/');
      await readSpan.waitFor({ timeout: 60_000 });
      const readText = (await readSpan.first().textContent()) ?? "";
      const qCount = Number((readText.match(/(\d+) questions read/) ?? [])[1] ?? 0);
      await page.locator('button:has-text("Build exam plan")').click();
      await page.locator('button:has-text("Rebuild plan")').waitFor({ timeout: 90_000 });

      await openComplete(page);
      const badge = page.locator('button:has-text("past question")').first();
      await badge.waitFor({ timeout: 20_000 });
      pyqTopicId = await badge.evaluate((btn) => btn.closest("[data-topic-id]")?.getAttribute("data-topic-id"));
      record(
        "6. PYQ paper parsed → exam plan built → past questions attached to a topic",
        qCount >= 8 && Boolean(pyqTopicId),
        `questions=${qCount} pyqTopic=${pyqTopicId ?? "-"}`,
      );
    } catch (err) {
      record("6. PYQ paper parsed → exam plan built → past questions attached to a topic", false, String(err).slice(0, 200));
    }

    /* ---------------- case 7 · notes for 3 topics (12-element) ---------------- */
    const topicSections = page.locator("section[data-topic-id]");
    const noteSummaries = [];
    for (let i = 0; i < 3; i += 1) {
      try {
        const section = topicSections.nth(i);
        const title = ((await section.locator("h3").first().textContent()) ?? "").trim();
        const bundle = await generateNotesFor(page, section);
        const detailed = bundle.headings.filter(
          (h) => !/Fast revision bullets|Flashcards/i.test(h),
        );
        const words = significantWords(title);
        const topicSpecific = words.some((w) => bundle.text.toLowerCase().includes(w));
        const hasRevision = detailed.some((h) => /revision/i.test(h));
        const hasExam = detailed.some((h) => /exam|sawaal/i.test(h));
        const hasIntro = detailed.some((h) => /introduction|shuruwat/i.test(h));
        const pyqQuoted =
          pyqTopicId && (await section.getAttribute("data-topic-id")) === pyqTopicId
            ? /past paper/i.test(bundle.text)
            : null;
        const ok =
          detailed.length >= 8 &&
          bundle.text.length >= 1800 &&
          hasRevision &&
          hasExam &&
          hasIntro &&
          topicSpecific &&
          bundle.bullets >= 4 &&
          bundle.cards >= 3 &&
          (pyqQuoted === null || pyqQuoted === true);
        noteSummaries.push(
          `#${i + 1} "${title}": sections=${detailed.length} chars=${bundle.text.length} pyq=${pyqQuoted ?? "n/a"}`,
        );
        if (!ok) noteSummaries.push(`    headings=[${detailed.join(" | ")}] specific=${topicSpecific}`);
        if (i === 0) record(`7.${i + 1}. Topic notes: ≥8 real elements, topic-specific${pyqTopicId ? ", PYQ quoted" : ""}`, ok, noteSummaries.at(-1));
        else record(`7.${i + 1}. Topic notes: ≥8 real elements, topic-specific`, ok, noteSummaries.at(-1));
      } catch (err) {
        record(`7.${i + 1}. Topic notes: ≥8 real elements, topic-specific`, false, String(err).slice(0, 200));
      }
    }

    /* ---------------- case 8 · mark completed + refresh persistence ---------------- */
    let preReloadCompleted = false;
    try {
      const t3 = topicSections.nth(3);
      await t3.locator('button:has-text("Mark as completed")').click();
      await t3.locator('button:has-text("Completed")').waitFor({ timeout: 10_000 });
      preReloadCompleted = true;
    } catch (err) {
      record("8a. Mark as completed toggles", false, String(err).slice(0, 120));
    }

    try {
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator("#analysis").waitFor({ timeout: 60_000 });
      await openComplete(page);

      const t3 = topicSections.nth(3);
      const stillCompleted = await t3.locator('button:has-text("Completed")').isVisible().catch(() => false);

      // Notes restored from localStorage WITHOUT pressing Generate.
      const topic0 = topicSections.first();
      const topicId0 = await topic0.getAttribute("data-topic-id");
      const notesRoot = topic0.locator(`#topic-notes-${topicId0}`);
      await topic0.locator('button:has-text("View Notes")').click();
      await notesRoot.locator("h4").first().waitFor({ timeout: 15_000 });
      const restoredHeadings = await notesRoot.locator("h4").count();
      const footerOk = await notesRoot.evaluate((el) =>
        /server par likha|Browser AI model se likha|Rule engine se bana/.test(el.textContent ?? ""),
      );

      // Videos restored from the client cache.
      const cachedEntries = await page.evaluate(() => {
        try {
          const store = JSON.parse(localStorage.getItem("es-topic-videos-v1") ?? "{}");
          return Object.values(store).reduce((n, e) => n + Object.keys(e.byTopic ?? {}).length, 0);
        } catch {
          return 0;
        }
      });
      await page
        .locator('[data-topic-videos] img[src*="i.ytimg.com"]')
        .first()
        .waitFor({ timeout: 60_000 });

      record(
        "8. Refresh: progress ✓, saved notes (no regenerate) + cached videos restored",
        preReloadCompleted && stillCompleted && restoredHeadings >= 9 && footerOk && cachedEntries >= 1,
        `completed=${stillCompleted} savedSections=${restoredHeadings} footer=${footerOk} cachedTopics=${cachedEntries}`,
      );
    } catch (err) {
      record("8. Refresh: progress ✓, saved notes (no regenerate) + cached videos restored", false, String(err).slice(0, 200));
    }

    /* ---------------- case 9 · both playlists (regression) ---------------- */
    try {
      await tab(page, "Video Playlists").click();
      const boardTabs = page.locator('[role="tablist"][aria-label="Playlist type"] [role="tab"]');
      const labels = (await boardTabs.allTextContents()).map((t) => t.trim());
      const hasBoth = labels.some((l) => l.includes("Complete Syllabus Playlist")) &&
        labels.some((l) => l.includes("Smart Exam Playlist"));

      await page
        .locator('[role="tablist"][aria-label="Playlist type"] [role="tab"]', { hasText: "Complete Syllabus Playlist" })
        .click();
      await page.locator('img[src*="i.ytimg.com"]').first().waitFor({ timeout: 90_000 });
      const completeVideos = await page.locator('[data-video-id], a[href*="youtube.com/watch"]').count();

      await page
        .locator('[role="tablist"][aria-label="Playlist type"] [role="tab"]', { hasText: "Smart Exam Playlist" })
        .click();
      await page.locator('img[src*="i.ytimg.com"]').first().waitFor({ timeout: 90_000 });
      const smartVideos = await page.locator('[data-video-id], a[href*="youtube.com/watch"]').count();

      record(
        "9. Video Playlists: Complete Syllabus + Smart Exam tabs both render real videos",
        hasBoth && completeVideos > 0 && smartVideos > 0,
        `tabs=[${labels.join(" / ")}] complete=${completeVideos} smart=${smartVideos}`,
      );
    } catch (err) {
      record("9. Video Playlists: Complete Syllabus + Smart Exam tabs both render real videos", false, String(err).slice(0, 200));
    }

    /* ---------------- case 10 · no uncaught page errors ---------------- */
    record(
      "10. No uncaught page errors during the run",
      pageErrors.length === 0,
      pageErrors.length > 0 ? pageErrors.slice(0, 2).map((e) => e.slice(0, 140)).join(" || ") : "clean",
    );
  } catch (err) {
    record("run aborted before completion", false, String(err).slice(0, 300));
  } finally {
    await browser.close();
  }
}

/* ---------- fallback mode: no YOUTUBE/GEMINI key on the server ---------- */
async function runFallback(page) {
  try {
    await page
      .locator("[data-topic-videos]")
      .first()
      .waitFor({ timeout: 90_000 });
    await page
      .waitForFunction(
        () =>
          [...document.querySelectorAll("[data-topic-videos]")].some(
            (s) =>
              /YouTube API abhi available nahi|koi suitable lecture nahi mila/.test(s.textContent ?? "") ||
              s.querySelector('a[href*="youtube.com/results"]'),
          ),
        undefined,
        { timeout: 90_000 },
      );
    const videos = await page.evaluate(collectVideos);
    const withRec = videos.filter((v) => v.recommended);
    const fallbackLinks = videos.reduce((n, v) => n + v.fallbackLinks, 0);
    const labelled = videos.filter((v) => v.fallbackLabel).length;
    record(
      "11. No YouTube key → honest labelled fallback, NO fake video cards",
      withRec.length === 0 && fallbackLinks >= 2 && labelled >= 1,
      `fakeCards=${withRec.length} fallbackLinks=${fallbackLinks} labelledSections=${labelled} reasonShown=${videos.some((v) => /key set nahi/.test("")) || labelled >= 1}`,
    );

    const topic0 = page.locator("section[data-topic-id]").first();
    const topicId0 = await topic0.getAttribute("data-topic-id");
    const notesRoot = topic0.locator(`#topic-notes-${topicId0}`);
    await topic0.locator('button:has-text("View Notes")').click();
    const gen = notesRoot.locator('button:has-text("Generate")').first();
    await gen.waitFor({ timeout: 15_000 });
    await gen.click();
    await notesRoot.locator("h4").first().waitFor({ timeout: 120_000 });
    const bundle = await notesRoot.evaluate((el) => {
      const headings = [...el.querySelectorAll("h4")].map((h) => h.textContent.trim());
      const text = el.textContent ?? "";
      return {
        detailed: headings.filter((h) => !/Fast revision bullets|Flashcards/i.test(h)).length,
        chars: text.length,
        rulesLabel: /Rule engine se bana/.test(text),
        claimsServerAi: /server par likha/.test(text),
        claimsBrowserAi: /Browser AI model se likha/.test(text),
      };
    });
    record(
      "12. No Gemini key → transparent rule-engine notes (no AI claim), real content",
      bundle.detailed >= 7 && bundle.chars >= 1500 && bundle.rulesLabel && !bundle.claimsServerAi && !bundle.claimsBrowserAi,
      `sections=${bundle.detailed} chars=${bundle.chars} rulesLabel=${bundle.rulesLabel} claimsServerAi=${bundle.claimsServerAi} claimsBrowserAi=${bundle.claimsBrowserAi}`,
    );
  } catch (err) {
    record("fallback run aborted", false, String(err).slice(0, 300));
  } finally {
    await (await page.context().browser()).close();
  }
}

await run();

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed (${MODE} mode)`);
process.exit(failed === 0 ? 0 : 1);
