# ExamSmasher 🎓 — Syllabus → exam priority → notes, PYQs & study links

Paste a syllabus and ExamSmasher tells you what to study **in the order that earns marks**: it splits the syllabus into topics, reads your old question papers to tag every topic **Must / Might / Can skip**, then hands you real recommended videos, notes and solved PYQs for each topic — all on one page.

```
Syllabus text  →  topics  →  your old papers → Must / Might / Can skip
                                    ↓
              per-topic videos + 12-section notes + solved PYQs + practice
```

## Nothing to configure. Two optional upgrades.

Everything works with **zero** keys — the rule-based engine always answers:

- **Rule-based engine** (`src/lib/engine/rules/`) — instant, offline, always works. A real parser and scorer built from your own text, not a placeholder.
- **Optional browser AI** (`src/lib/ai/`) — `SmolLM2-360M-Instruct` downloaded once from Hugging Face and run locally on WebGPU (or WASM fallback). It upgrades the writing-heavy features (notes, answers, chat, quiz).

Copy `.env.local` from `.env.example` only if you want the two server-side upgrades:

| Key | Unlocks | Without it |
| --- | --- | --- |
| `YOUTUBE_API_KEY` | Real video discovery — titles, channels, durations, views, thumbnails from the YouTube Data API, for both the playlists and every topic card | Honest YouTube **search links** (the UI says why) |
| `GEMINI_API_KEY` | `POST /api/notes` writes the full 12-section notes with a server-side model | In-browser model if loaded, else the rule engine |

Both keys are read by **server routes only** and never reach the browser. Failures are honest: the route returns `ok:false` + a reason, the client falls back, and the panel footer always says which engine actually wrote the copy.

The header chip reports the honest state: `Rules mode`, `AI loading… 42%`, or `AI ready · WebGPU`. The UI never claims a model answered when the rule engine did — every result carries a `source` (and a `via` when it came from the server).

Server routes, all optional to configure:

- `POST /api/extract` — reads an uploaded `.pdf` / `.docx` / `.txt` / photo of a syllabus (PDF and DOCX locally, photos via on-device Tesseract OCR). No key.
- `POST /api/videos` — real YouTube metadata for search queries built from your syllabus wording.
- `POST /api/playlists` — checks whether an existing full-course playlist genuinely covers your syllabus.
- `POST /api/notes` — 12-section topic notes or a whole-syllabus / single-unit Markdown document.

## Features

- **📎 File upload** — drop a `.pdf`, `.docx`, `.txt/.md` or a photo of your syllabus; PDFs/docx are parsed on the server, photos are read by on-device OCR.
- **AI syllabus breakdown** — chapters become crisp study topics with importance, difficulty, estimated time and a chapter label. Bigger syllabi automatically produce more topics.
- **🎯 PYQ importance (Step 2)** — upload old question papers; the parser reads the printed questions, maps each one to a syllabus topic and computes Must / Might / Can skip from the *real* trend. No papers? Skip the step and importance comes from the syllabus analysis instead.
- **✅ Solved PYQs** — every past question gets an answer framework built from your own syllabus wording, plus an Easy/Medium/Hard tag and a mark-based structure.
- **📝 Notes** — the full 12-section structure per topic (introduction, easy explanation, definitions, key points, examples, features, pros/cons, differences, exam questions, short answers, long answers, revision summary), plus a "whole syllabus as one document" panel that can be scoped to **one unit**, in Hinglish or English, with LaTeX maths rendering. Saved locally, so a refresh brings them straight back.
- **🧠 Practice** — quiz generator, mock test paper built to match your real paper's pattern, and PYQ practice where you write your answer before revealing the model answer.
- **💬 AI study coach** — floating chat that knows your subject, topics, syllabus and past questions.
- **🗓️ Study plan** — a day-by-day plan with a progress bar, exported as Markdown.
- **✅ To-do list** — your own tasks, saved on your device.
- **🎬 Real videos, honestly labelled** — with `YOUTUBE_API_KEY` each topic card gets one recommended lecture plus alternatives (real title, channel, duration, views, thumbnail) previewable in-app, de-duplicated across cards, with an honest search-link fallback when discovery is unavailable. Without the key you get YouTube's own results-page links — no invented titles or view counts, ever.
- **📊 Coverage report** — which topics your papers never asked about, so gaps are visible.
- **16 languages** for search wording — English, **Hinglish (default)**, Hindi, Urdu, Bengali, Tamil, Telugu, Spanish, French, German, Portuguese, Arabic, Japanese, Chinese, Russian, Turkish.
- **Study tools** — copy the list, export Markdown or CSV, tick topics as you study (progress saved in the browser).
- **Light / dark theme**, fully responsive.

## Setup

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. That's the whole setup — no keys, no accounts.

> The optional browser model (~270 MB first time) starts downloading in the background as soon as the page opens and is cached by the browser afterwards. The rule engine answers immediately whether or not it arrives.

## Project structure

```
src/
  app/
    page.tsx                 Main UI — the three-step flow
    layout.tsx               Fonts, theme bootstrap, metadata
    globals.css              Design tokens (light/dark) + shared styles
    api/
      extract/route.ts       uploaded file → syllabus text (pdf/docx/OCR)
      videos/route.ts        syllabus queries → real YouTube metadata (optional key)
      playlists/route.ts     does this full-course playlist cover the syllabus?
      notes/route.ts         server-side model → 12-section notes / one document
  components/                Form, exam mode, topic panels, notes, quiz, chat, modals
  hooks/
    useStudiedTopics.ts      localStorage-backed "topics I have studied" store
    useTodoList.ts           localStorage-backed to-do list
  lib/
    engine/                  THE entry point every component calls
      index.ts               feature facade: server → model → rules, with fallbacks
      ai.ts                  prompts for the browser model
      rules/                 deterministic builders (syllabus, pyq, notes, quiz…)
    ai/                      in-browser model plumbing
      model.ts               lazy loader (WebGPU → WASM), progress, caching
      run.ts                 withAi(): model when ready, rules otherwise
      generate.ts            text/JSON generation with timeouts
      status.ts              single source of truth for the chip
    notesNormalize.ts        shared section/card caps for both notes writers
    topicVideoBatch.ts       batches per-topic video lookups, de-dupes across cards
    exam.ts                  paper signals, bands, expected questions
    exporters.ts             Markdown / CSV export
    markdown.ts, math.ts     safe Markdown renderer + KaTeX maths
```

## How it works

| Step | What happens |
| --- | --- |
| **1 · Syllabus** | `analyzeSyllabus` → rule parser splits units into topics (model may upgrade it). |
| **2 · PYQ importance** | Papers are parsed verbatim (numbered questions, marks, sections), mapped to topics, and `exam.ts` counts the real trend into Must / Might / Can skip. Every number shown afterwards is counted from your papers. |
| **3 · Videos + notes** | Real videos (or honest search links), 12-section notes, quizzes and answers are built in the plan's order (must-do first), each using the exam's own wording. |

Every feature is a chain that always ends in a working answer: the server-side model when a key is configured → the in-browser model when it has loaded → the rule builder. `source` (and `via: "server"` when the site's own model wrote it) is shown to the student, so nobody mistakes a restructured syllabus for an AI explanation.

## Scripts

```bash
npm run dev     # development server
npm run build   # production build
npm run start   # serve the production build
npm run lint    # eslint

node scripts/api-check.mjs [baseUrl]   # API smoke test: /api/videos + /api/notes (costs a few model calls)
node scripts/ui-check.mjs [baseUrl]    # browser smoke test: analyse → topic cards → videos → notes
node scripts/e2e-check.mjs [baseUrl] [full|fallback]   # 12-case browser suite (keys present / keys cleared)
node scripts/gemini-probe.mjs          # times each candidate model on the notes prompt
```

## Notes & limits

- **File reading needs no keys**: `.txt/.md`, PDF and DOCX are parsed on the server, and photos go through on-device Tesseract OCR (~15 MB language data, downloaded once and cached).
- **The browser model is optional.** If it cannot load (no WebAssembly/WebGPU, blocked CDN, offline), the chip says `Rules mode` and every feature still answers — built from your own text and labelled as such.
- **Nothing leaves the machine by default.** With no keys set there is no AI call and no YouTube API: search links open YouTube's own results page. Adding `GEMINI_API_KEY` / `YOUTUBE_API_KEY` is opt-in, and those keys stay in server routes — there is no analytics and no upload of your syllabus anywhere else.
- Video quota is finite (100 units per search, 10,000/day by default), so results are cached on both server and client, and a quota miss falls back to search links rather than an error.
- Progress ticks and to-dos live in `localStorage` per browser — clear them with **Reset progress** in the results toolbar.
- Rule-engine answers are frameworks built from your syllabus wording, not textbook keys — use them as a structure, then fill in what you know.
