# ExamSmasher 🎓 — Syllabus → exam priority → notes, PYQs & study links

Paste a syllabus and ExamSmasher tells you what to study **in the order that earns marks**: it splits the syllabus into topics, reads your old question papers to tag every topic **Must / Might / Can skip**, then hands you YouTube search links, notes and solved PYQs for each topic — all on one page.

```
Syllabus text  →  topics  →  your old papers → Must / Might / Can skip
                                    ↓
              per-topic search links + notes + solved PYQs + practice
```

## No API keys. At all.

Everything runs in your browser:

- **Rule-based engine** (`src/lib/engine/rules/`) — instant, offline, always works. A real parser and scorer built from your own text, not a placeholder.
- **Optional browser AI** (`src/lib/ai/`) — `SmolLM2-360M-Instruct` downloaded once from Hugging Face and run locally on WebGPU (or WASM fallback). It upgrades the writing-heavy features (notes, answers, chat, quiz).

The header chip reports the honest state: `Rules mode`, `AI loading… 42%`, or `AI ready · WebGPU`. The UI never claims a model answered when the rule engine did — every result carries a `source`.

There is exactly **one** server route left: `POST /api/extract`, which reads an uploaded `.pdf` / `.docx` / `.txt` / photo of a syllabus (PDF and DOCX locally, photos via on-device Tesseract OCR). No key, no data leaves the machine.

## Features

- **📎 File upload** — drop a `.pdf`, `.docx`, `.txt/.md` or a photo of your syllabus; PDFs/docx are parsed on the server, photos are read by on-device OCR.
- **AI syllabus breakdown** — chapters become crisp study topics with importance, difficulty, estimated time and a chapter label. Bigger syllabi automatically produce more topics.
- **🎯 PYQ importance (Step 2)** — upload old question papers; the parser reads the printed questions, maps each one to a syllabus topic and computes Must / Might / Can skip from the *real* trend. No papers? Skip the step and importance comes from the syllabus analysis instead.
- **✅ Solved PYQs** — every past question gets an answer framework built from your own syllabus wording, plus an Easy/Medium/Hard tag and a mark-based structure.
- **📝 Notes** — per-topic notes and a "whole syllabus as one document" panel, in Hinglish or English, with LaTeX maths rendering.
- **🧠 Practice** — quiz generator, mock test paper built to match your real paper's pattern, and PYQ practice where you write your answer before revealing the model answer.
- **💬 AI study coach** — floating chat that knows your subject, topics, syllabus and past questions.
- **🗓️ Study plan** — a day-by-day plan with a progress bar, exported as Markdown.
- **✅ To-do list** — your own tasks, saved on your device.
- **🎬 Honest YouTube search links** — no YouTube API, no ranking, no invented titles or view counts. Each link opens YouTube's own results page for a query built from your syllabus wording.
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
  components/                Form, exam mode, topic panels, notes, quiz, chat, modals
  hooks/
    useStudiedTopics.ts      localStorage-backed "topics I have studied" store
    useTodoList.ts           localStorage-backed to-do list
  lib/
    engine/                  THE entry point every component calls
      index.ts               feature facade: rules first, model optional
      ai.ts                  prompts + re-normalisation for the browser model
      rules/                 deterministic builders (syllabus, pyq, notes, quiz…)
    ai/                      in-browser model plumbing
      model.ts               lazy loader (WebGPU → WASM), progress, caching
      run.ts                 withAi(): model when ready, rules otherwise
      generate.ts            text/JSON generation with timeouts
      status.ts              single source of truth for the chip
    exam.ts                  paper signals, bands, expected questions
    exporters.ts             Markdown / CSV export
    markdown.ts, math.ts     safe Markdown renderer + KaTeX maths
```

## How it works

| Step | What happens |
| --- | --- |
| **1 · Syllabus** | `analyzeSyllabus` → rule parser splits units into topics (model may upgrade it). |
| **2 · PYQ importance** | Papers are parsed verbatim (numbered questions, marks, sections), mapped to topics, and `exam.ts` counts the real trend into Must / Might / Can skip. Every number shown afterwards is counted from your papers. |
| **3 · Links + notes** | Search links, notes, quizzes and answers are built in the plan's order (must-do first), each using the exam's own wording. |

Every feature is a pair: a rule-based builder that always works, and — for most features — a model writer. `withAi` decides which one ran, and the result's `source` is shown to the student.

## Scripts

```bash
npm run dev     # development server
npm run build   # production build
npm run start   # serve the production build
npm run lint    # eslint
```

## Notes & limits

- **File reading needs no keys**: `.txt/.md`, PDF and DOCX are parsed on the server, and photos go through on-device Tesseract OCR (~15 MB language data, downloaded once and cached).
- **The browser model is optional.** If it cannot load (no WebAssembly/WebGPU, blocked CDN, offline), the chip says `Rules mode` and every feature still answers — built from your own text and labelled as such.
- **Nothing is sent anywhere.** There is no backend AI call, no analytics, no YouTube API. Search links open YouTube's own results page.
- Progress ticks and to-dos live in `localStorage` per browser — clear them with **Reset progress** in the results toolbar.
- Rule-engine answers are frameworks built from your syllabus wording, not textbook keys — use them as a structure, then fill in what you know.
