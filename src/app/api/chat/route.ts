import { generateText, getLlmConfig } from "@/lib/llm";
import { buildChatPrompt } from "@/lib/prompts";
import type { ChatMessage, ChatResponse } from "@/lib/types";

const MAX_MESSAGE_CHARS = 2000;

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    message?: unknown;
    history?: ChatMessage[];
    subject?: unknown;
    topics?: Array<{ title?: unknown; description?: unknown }>;
    syllabus?: unknown;
  } | null;

  const message =
    typeof body?.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE_CHARS) : "";
  if (!message) {
    return Response.json(
      { ok: false, error: "Type a message first." },
      { status: 400 },
    );
  }

  const config = getLlmConfig();
  if (!config) {
    return Response.json(
      {
        ok: false,
        error: "Chat needs an AI key. Open “API Keys” in the header and add GEMINI_API_KEY.",
      },
      { status: 503 },
    );
  }

  const history: ChatMessage[] = (Array.isArray(body?.history) ? body.history : [])
    .filter(
      (m): m is ChatMessage =>
        Boolean(m) &&
        (m.role === "user" || m.role === "assistant") &&
        typeof m.content === "string" &&
        m.content.trim().length > 0,
    )
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 800) }));

  const { system, prompt } = buildChatPrompt({
    message,
    history,
    subject: typeof body?.subject === "string" ? body.subject.slice(0, 80) : undefined,
    topics: (Array.isArray(body?.topics) ? body.topics : [])
      .filter((t) => t && typeof t.title === "string" && t.title.trim())
      .slice(0, 40)
      .map((t) => ({
        title: String(t.title).slice(0, 140),
        description: typeof t.description === "string" ? t.description.slice(0, 200) : undefined,
      })),
    syllabus: typeof body?.syllabus === "string" ? body.syllabus.slice(0, 3000) : undefined,
  });

  try {
    const reply = (await generateText(prompt, {
      system,
      temperature: 0.5,
      maxOutputTokens: 1500,
      timeoutMs: 45_000,
    })).trim();

    if (!reply) {
      return Response.json(
        { ok: false, error: "The AI gave an empty answer — try again." },
        { status: 502 },
      );
    }

    const json: ChatResponse = { ok: true, reply };
    return Response.json(json);
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Chat failed." },
      { status: 502 },
    );
  }
}
