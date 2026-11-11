/**
 * End-to-end UI smoke test for the per-topic surface — run with:
 *   node scripts/ui-check.mjs [baseUrl]
 *
 * Drives a real browser (Edge/Chrome channel via playwright-core, no browser
 * download needed) through the whole student flow and checks the parts that
 * only exist at runtime:
 *   1. sample syllabus → analyse → Complete Syllabus → all units expanded
 *   2. every topic card renders the four actions (notes / watch / others / tick)
 *   3. real videos arrive from /api/videos (or the honest search-link fallback)
 *   4. "View Notes" opens notes from /api/notes and the footer names the engine
 *   5. Study Space → one unit selected → /api/notes document scope renders
 *   6. no uncaught page errors anywhere in the run
 *
 * Prints PASS/FAIL per case and exits non-zero if anything failed.
 */

import { chromium } from "playwright-core";

const BASE = process.argv[2] ?? "http://localhost:3000";
const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

const pageErrors = [];
const apiCalls = [];

const browser = await chromium.launch({ channel: "msedge" });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

page.on("pageerror", (err) => pageErrors.push(String(err).slice(0, 200)));
page.on("response", (res) => {
  const url = res.url();
  if (url.includes("/api/")) {
    apiCalls.push({ path: new URL(url).pathname, status: res.status() });
  }
});

/** Clicks the first matching button; returns false when it never appears. */
async function click(text, timeout = 15_000) {
  const locator = page.getByRole("button", { name: text }).first();
  try {
    await locator.waitFor({ state: "visible", timeout });
    const label = (await locator.innerText()).replace(/\s+/g, " ").trim();
    await locator.click();
    console.log(`· clicked "${label}"`);
    return true;
  } catch {
    console.log(`· could not click ${text}`);
    return false;
  }
}

/** The analysis board is a role=tablist — click a tab by name, never a button. */
async function clickTab(text, timeout = 15_000) {
  const locator = page.getByRole("tab", { name: text }).first();
  try {
    await locator.waitFor({ state: "visible", timeout });
    const label = (await locator.innerText()).replace(/\s+/g, " ").trim();
    await locator.click();
    console.log(`· opened tab "${label}"`);
    return true;
  } catch {
    console.log(`· could not open tab ${text}`);
    return false;
  }
}

/** Everything a student could click right now — the first thing to check. */
async function visibleButtons(limit = 40) {
  const names = await page.getByRole("button").allInnerTexts();
  return names.map((n) => n.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, limit);
}

try {
  /* 0 · a clean browser — no cached analysis from an earlier run. */
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });

  /* 1 · analyse the sample syllabus. */
  await click(/Try a sample syllabus/);
  await click(/Syllabus analyse karo/, 20_000);

  // Step 2 is the papers step — skip it exactly the way a student would.
  const skipped = await click(/Skip karo/, 25_000);

  // The skip already opens Complete Syllabus; open it explicitly if it did not
  // (anchored regex: the playlists board has a similarly named tab).
  await clickTab(/^Complete Syllabus(\s*\d+)?$/, 20_000);
  await click(/Sab expand karo/, 20_000);

  const appeared = await page
    .waitForSelector('section[id^="topic-"]', { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) {
    console.log("· buttons now:", (await visibleButtons()).join(" | "));
    const text = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
    console.log("· on screen:", text.slice(0, 700));
    await page.screenshot({ path: "scripts/ui-check-failure.png" });
  }
  const panels = await page.locator('section[id^="topic-"]').count();
  record("topic cards render", panels > 0, `${panels} topic panel(s)${skipped ? ", PYQ step skipped" : ""}`);
  if (panels === 0) throw new Error("stopping here — later steps need a topic card");

  /* 2 · the four per-topic actions on the first card. */
  const first = page.locator('section[id^="topic-"]').first();
  const actionNames = ["View Notes", "Watch recommended video", "View other videos", "Mark as completed"];
  const found = [];
  for (const name of actionNames) {
    found.push((await first.getByRole("button", { name: new RegExp(name) }).count()) > 0);
  }
  record(
    "four per-topic actions present",
    found.every(Boolean),
    `${found.filter(Boolean).length}/4 (${actionNames.filter((_, i) => found[i]).join(", ")})`,
  );

  /* 3 · real videos — wait for the batched /api/videos call to answer. */
  const videosCall = await page
    .waitForResponse((res) => res.url().includes("/api/videos") && res.status() < 500, {
      timeout: 30_000,
    })
    .catch(() => null);
  const videosStatus = videosCall?.status() ?? 0;
  await page.waitForTimeout(1_500); // let the cards paint
  const thumbs = await page.locator('section[id^="topic-"] img[src*="ytimg"]').count();
  const searchLinks = await page.locator('section[id^="topic-"] a[href*="youtube.com/results"]').count();
  record(
    "videos: real cards or honest search links",
    thumbs > 0 || searchLinks > 0,
    `/api/videos ${videosStatus || "not called"} → ${thumbs} thumbnail(s), ${searchLinks} search link(s)`,
  );

  /* 4 · open this topic's notes, then generate — deliberately an explicit
     click: 12 panels must never fire 12 model calls on their own. */
  const panel = first.locator('[id^="topic-notes-"]').first();
  const notesOpened = await first
    .getByRole("button", { name: /View Notes/ })
    .first()
    .click()
    .then(() => true)
    .catch(() => false);
  await panel.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});

  // Register the listener BEFORE generating, so the response cannot be missed.
  const notesPromise = page
    .waitForResponse(
      (res) => res.url().includes("/api/notes") && res.request().method() === "POST",
      { timeout: 60_000 },
    )
    .catch(() => null);
  await panel
    .getByRole("button", { name: /^Generate/ })
    .first()
    .click()
    .then(() => console.log("· clicked Generate"))
    .catch(() => console.log("· no Generate button"));
  const notesCall = await notesPromise;
  const notesStatus = notesCall?.status() ?? 0;

  // Content: either the model's sections or the rule engine's — both render.
  await panel
    .locator("section")
    .first()
    .waitFor({ state: "visible", timeout: 45_000 })
    .catch(() => {});
  const sectionCount = await panel.locator("section").count();
  const footer = (await panel.locator("p").last().innerText().catch(() => "")).trim();
  record(
    "topic notes open with content",
    notesOpened && sectionCount > 0,
    `POST /api/notes → ${notesStatus || "n/a"}, ${sectionCount} section(s), footer="${footer.slice(0, 70)}"`,
  );

  /* 5 · whole-syllabus notes scoped to ONE unit (Study Space). */
  await click(/My Study Space/, 15_000);
  const scope = page.getByLabel("Notes scope").first();
  await scope.waitFor({ state: "visible", timeout: 20_000 });
  const options = await scope.locator("option").allInnerTexts();
  const unit = options.find((option) => option && !/^Poora syllabus$/.test(option.trim()));
  await scope.selectOption({ label: unit });
  console.log(`· scope = ${unit}`);

  const docPromise = page
    .waitForResponse(
      (res) => res.url().includes("/api/notes") && res.request().method() === "POST",
      { timeout: 120_000 },
    )
    .catch(() => null);
  await page
    .getByRole("button", { name: /Notes banao|Dobara banao/ })
    .first()
    .click()
    .then(() => console.log("· clicked Notes banao"))
    .catch(() => console.log("· no Notes banao button"));
  const docCall = await docPromise;

  const article = page.locator("article.plan-markdown").first();
  await article.waitFor({ state: "visible", timeout: 60_000 }).catch(() => {});
  const docText = (await article.innerText().catch(() => "")).trim();
  record(
    "unit-scoped document notes render",
    docText.length > 300,
    `POST /api/notes → ${docCall?.status() ?? "n/a"}, scope="${unit}", ${docText.length} chars of markdown`,
  );

  /* 6 · nothing crashed while all of that happened. */
  record("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | ") || "clean");
} catch (err) {
  // Earlier cases already recorded the specifics — don't double-report.
  if (results.every((r) => r.pass)) record("flow completed", false, String(err).slice(0, 240));
} finally {
  await browser.close();
}

const calls = apiCalls.map((c) => `${c.path}:${c.status}`).join(" ");
console.log(`\nAPI calls — ${calls || "none"}`);
const failed = results.filter((r) => !r.pass).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
