# ExamSmasher 🎓 — Syllabus → Best Video Analysis

Paste a syllabus, and ExamSmasher returns a topic-by-topic map of the **best YouTube explainer videos** for it — matched by actual video content, ranked with a transparent score, in your chosen language (English by default).

```
Syllabus text  →  AI splits it into topics  →  YouTube search per topic
              →  transcript + metadata content match  →  AI ranks candidates
              →  left: topics | right: best videos
```

## Features

- **📎 File upload** — drop a `.pdf`, `.docx`, `.txt/.md` or even a **photo of your syllabus**; the server reads it and fills the syllabus box. PDFs/docx are parsed locally, images are transcribed by the AI.
- **AI syllabus breakdown** — chapters become crisp, searchable study topics with importance, difficulty and estimated time.
- **Real content matching** — not just the title: captions/transcripts are downloaded for the top candidates and checked against the topic's keywords, then an AI reads the excerpts and scores each video.
- **▶️ Watch inside the app** — clicking a video opens an embedded player right there; "Open on YouTube" is one click away.
- **✅ Checklist tracking** — tick topics as you study them. The sidebar shows "syllabus covered X%", how many topics are left and the remaining watch time. Progress is saved in your browser.
- **"Already studied" awareness** — topics you tick are skipped on re-match (no wasted API quota), excluded from the AI study plan and marked in exports.
- **Transparent scoring** — every video shows a 0–100 score, a reason chip ("Covers 5/5 keywords", "Transcript confirms the topic", "Trusted educator: Khan Academy") and an AI one-line summary.
- **16 languages** — English, **Hinglish (default)**, Hindi, Urdu, Bengali, Tamil, Telugu, Spanish, French, German, Portuguese, Arabic, Japanese, Chinese, Russian, Turkish.
- **Study tools** — copy the list, export Markdown or CSV, and generate a day-by-day AI study plan with your top-picked videos.
- **Light / dark theme**, fully responsive.

## Setup (about 5 minutes — both keys are FREE)

### 1. Install & run

```bash
npm install
npm run dev
```

Open http://localhost:3000

### 2. Get a YouTube Data API key (free — 10,000 units/day)

1. Open <https://console.cloud.google.com/apis/library/youtube.googleapis.com>
2. Click **Enable**, then go to **Credentials → Create credentials → API key**
3. Restrict it later if you like (HTTP referrers for localhost).

### 3. Get a Gemini API key (free tier)

1. Open <https://aistudio.google.com/apikey>
2. **Create API key** → copy it.
   *(Prefer OpenAI? Set `OPENAI_API_KEY` instead and leave Gemini empty.)*

### 4. Add both keys

Copy `.env.example` to `.env.local` and fill it in:

```bash
YOUTUBE_API_KEY=your_youtube_key
GEMINI_API_KEY=your_gemini_key
```

Restart the dev server. The header chip will show `AI: gemini · YouTube ✓`.

> The app also tells you exactly this on a banner if a key is missing — nothing fails silently.

## How the ranking works

Each topic is scored on two axes and blended:

| Axis | Signals |
| --- | --- |
| **Relevance (58%)** | topic keywords found in the title, description, and the video's transcript; penalty for "full course" dumps |
| **Quality (42%)** | log-scaled views, like ratio, comment ratio, ideal duration (3–30 min), recency, captions, trusted-educator bonus |

The top 12 candidates (after the fast pass) are then sent to the AI **with transcript excerpts**, which returns a 0–100 verdict per video. Final score = 50% deterministic + 50% AI. If the AI or transcript fetch is unavailable, ranking still works on metadata alone — the UI always shows which path was used.

## Project structure

```
src/
  app/
    page.tsx               Main UI (form + two-column results)
    layout.tsx             Fonts, theme bootstrap, metadata
    globals.css            Design tokens (light/dark) + shared styles
    api/
      analyze/route.ts     syllabus  → topics (AI)
      extract/route.ts     uploaded file → syllabus text (pdf/docx/image)
      videos/route.ts      topic    → ranked videos (YouTube + AI)
      plan/route.ts        topics   → markdown study plan (AI)
      health/route.ts      key status for the setup banner
  components/              Form, dropzone, sidebar, topic panels, player, modal
  hooks/
    useStudiedTopics.ts    localStorage-backed "topics I have studied" store
  lib/
    llm.ts                 Gemini / OpenAI wrapper (JSON mode)
    prompts.ts             All AI prompts
    youtube.ts             Search, video details, transcript download
    videos.ts              Per-topic pipeline (search → transcript → AI rank)
    scoring.ts             Deterministic relevance + quality scoring
    channels.ts            Trusted-educator list
    exporters.ts           Markdown / CSV export
    markdown.ts            Tiny safe Markdown renderer
```

## API quota notes

- YouTube **search.list** costs 100 units per query, **videos.list** costs 1. Default daily quota is 10,000 units — roughly 50 full analyses. Results are cached in memory for 20 minutes, so re-clicking is free.
- Raise the topic cap in `src/app/api/analyze/route.ts` (`maxTopics`, 3–20) if you want longer syllabi.

## Scripts

```bash
npm run dev     # development server
npm run build   # production build
npm run start   # serve the production build
npm run lint    # eslint
```

## Notes & limits

- **Images need an AI key** (Gemini reads the photo). PDFs and DOCX files are parsed locally, so they work without one.
- Transcript download is best-effort: YouTube has no official transcript API, so captions are read from the public watch page first and then via public caption proxies (Piped/Invidious). When none of them answer, the app falls back to title/description matching and labels it **"metadata match"**.
- Progress ticks live in `localStorage` per browser — clear them with **Reset progress** in the results toolbar.
- Scores are a study aid, not gospel — always skim the first 2 minutes of a video before committing.
