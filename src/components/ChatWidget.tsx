"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage, Topic } from "@/lib/types";
import { ChatIcon, CloseIcon, SendIcon, SparklesIcon } from "./Icons";

const STORAGE_KEY = "es-chat-v1";
const MAX_HISTORY = 30;

interface ChatWidgetProps {
  subject: string;
  topics: Topic[];
  /** Raw syllabus (truncated server-side) so answers stay inside the course. */
  syllabus: string;
}

function loadHistory(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (m): m is ChatMessage => {
          const msg = m as Partial<ChatMessage>;
          return (
            (msg?.role === "user" || msg?.role === "assistant") &&
            typeof msg?.content === "string" &&
            msg.content.trim().length > 0
          );
        },
      )
      .slice(-MAX_HISTORY)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  } catch {
    return [];
  }
}

function saveHistory(messages: ChatMessage[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_HISTORY)));
  } catch {
    /* storage blocked — history just won't persist */
  }
}

const QUICK_PROMPTS = [
  "Explain the hardest topic here",
  "Make a 3-day revision sprint",
  "What should I study tonight (30 min)?",
  "Give me 5 practice questions",
];

/**
 * Floating AI study coach.
 *
 * Knows the student's subject, extracted topics and syllabus, so answers are
 * grounded in their actual course instead of generic advice.
 */
export function ChatWidget({ subject, topics, syllabus }: ChatWidgetProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load persisted chat on mount. This must run after hydration (localStorage
  // does not exist during SSR), so an effect is the right place here.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate mount-time read of an external system
  useEffect(() => setMessages(loadHistory()), []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending, open]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const send = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || sending) return;

    const next: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setError(null);
    setSending(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: content,
          history: next.slice(0, -1),
          subject,
          topics: topics.map((t) => ({ title: t.title, description: t.description })),
          syllabus,
        }),
      });
      const json = (await response.json().catch(() => null)) as
        | { ok: boolean; reply?: string; error?: string }
        | null;

      const withReply: ChatMessage[] = json?.ok && json.reply
        ? [...next, { role: "assistant", content: json.reply }]
        : next;
      setMessages(withReply);
      saveHistory(withReply);
      if (!json?.ok) setError(json?.error ?? "The coach could not reply — try again.");
    } catch {
      setMessages(next);
      saveHistory(next);
      setError("Network error — check your connection.");
    } finally {
      setSending(false);
    }
  };

  const clearChat = () => {
    setMessages([]);
    saveHistory([]);
    setError(null);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <>
      {/* Floating toggle button */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close AI coach" : "Open AI coach"}
        className="fixed bottom-5 right-5 z-40 grid h-14 w-14 place-items-center rounded-full shadow-2xl transition-transform hover:scale-105"
        style={{ background: "var(--brand)", color: "var(--brand-contrast, #fff)" }}
      >
        {open ? <CloseIcon width={20} height={20} /> : <ChatIcon width={22} height={22} />}
      </button>

      {open && (
        <div
          className="card fixed bottom-24 right-5 z-40 flex max-h-[72vh] w-[min(420px,calc(100vw-2.5rem))] flex-col overflow-hidden shadow-2xl"
          role="dialog"
          aria-label="AI study coach"
        >
          <header
            className="flex items-center justify-between gap-2 border-b px-4 py-3"
            style={{ borderColor: "var(--line)" }}
          >
            <div className="flex items-center gap-2">
              <span style={{ color: "var(--brand)" }}>
                <SparklesIcon width={17} height={17} />
              </span>
              <div>
                <h3 className="text-sm font-extrabold">AI study coach</h3>
                <p className="text-[0.68rem] text-[var(--muted)]">
                  {subject || "Ask anything about your syllabus"}
                </p>
              </div>
            </div>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={clearChat}
                className="text-[0.68rem] font-bold text-[var(--muted)] hover:text-[var(--text)]"
              >
                Clear
              </button>
            )}
          </header>

          <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-xs leading-relaxed text-[var(--muted)]">
                  {topics.length > 0
                    ? `I know your ${topics.length} topics. Ask me anything — doubts, revision order, or "explain like I'm 5".`
                    : "Ask me anything about studying, doubts, or revision strategy."}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => void send(prompt)}
                      className="chip text-left transition-colors hover:border-[var(--brand)]"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message, i) => (
              <div
                key={i}
                className={`max-w-[92%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-[0.82rem] leading-relaxed ${
                  message.role === "user" ? "ml-auto" : ""
                }`}
                style={
                  message.role === "user"
                    ? { background: "var(--brand)", color: "var(--brand-contrast, #fff)" }
                    : { background: "var(--surface-2)", color: "var(--text)" }
                }
              >
                {message.content}
              </div>
            ))}

            {sending && (
              <div
                className="w-20 rounded-2xl px-3 py-2.5"
                style={{ background: "var(--surface-2)" }}
              >
                <div className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--muted)]"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </div>
              </div>
            )}

            {error && (
              <p className="text-xs" style={{ color: "var(--bad)" }}>
                {error}
              </p>
            )}
          </div>

          <div className="border-t px-3 py-2.5" style={{ borderColor: "var(--line)" }}>
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Ask a doubt… (Enter to send)"
                rows={1}
                className="max-h-28 min-h-[38px] flex-1 resize-none rounded-xl border bg-transparent px-3 py-2 text-sm outline-none"
                style={{ borderColor: "var(--line)" }}
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={sending || !input.trim()}
                aria-label="Send message"
                className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-xl transition-opacity disabled:opacity-40"
                style={{ background: "var(--brand)", color: "var(--brand-contrast, #fff)" }}
              >
                <SendIcon width={16} height={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
