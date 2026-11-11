/** Direct Gemini probe: time each candidate model on the topic-notes prompt. */
import fs from "node:fs";

const env = fs.readFileSync(".env.local", "utf8");
const key = env.match(/^GEMINI_API_KEY=(.*)$/m)?.[1]?.trim();
if (!key) {
  console.log("no GEMINI_API_KEY");
  process.exit(1);
}

const prompt = `You are an expert exam-notes writer. Write study notes for ONE syllabus topic.
Return ONLY this JSON shape:
{"detailed":[{"heading":"...","paragraphs":["..."]}],"notes":[{"heading":"...","bullets":["..."]}],"cards":[{"q":"...","a":"..."}]}
detailed: EXACTLY these 12 sections in order: 1 "Topic introduction" 2 "Detailed explanation (easy language)" 3 "Important definitions" 4 "Main concepts and key points" 5 "Examples" 6 "Important features or characteristics" 7 "Advantages and disadvantages" 8 "Differences and comparisons" 9 "Important exam questions" 10 "Exam-ready short answers" 11 "Detailed answers for long questions" 12 "Quick revision summary".
Topic: Thermodynamics. Course: Physics Class 11.
Syllabus: First law of thermodynamics: internal energy, heat and work. Second law: entropy, irreversible processes. Isothermal and adiabatic processes. Carnot engine and its efficiency.
LANGUAGE: easy HINGLISH.`;

const models = ["gemini-3.5-flash-lite", "gemini-flash-latest"];

for (const model of models) {
  const started = Date.now();
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 8192,
            responseMimeType: "application/json",
          },
        }),
        signal: AbortSignal.timeout(60_000),
      },
    );
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      console.log(`${model}: HTTP ${res.status} after ${elapsed}s — ${JSON.stringify(data?.error?.message ?? data).slice(0, 200)}`);
      continue;
    }
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const finish = data?.candidates?.[0]?.finishReason;
    let parsed = null;
    try {
      parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
    } catch {}
    console.log(
      `${model}: OK in ${elapsed}s — finish=${finish} chars=${text.length} sections=${parsed?.detailed?.length ?? "PARSE-FAIL"} usage=${JSON.stringify(data?.usageMetadata ?? {})}`,
    );
    if (parsed?.detailed) console.log(`  headings: ${parsed.detailed.map((s) => s.heading).join(" | ")}`);
  } catch (err) {
    console.log(`${model}: ERROR after ${((Date.now() - started) / 1000).toFixed(1)}s — ${err.name}: ${String(err.message).slice(0, 160)}`);
  }
}
