"use client";

import { useEffect, useState } from "react";
import { useTodoList } from "@/hooks/useTodoList";
import { CheckIcon, CloseIcon, ListIcon, PlusIcon, TrashIcon } from "./Icons";

interface TodoPanelProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Simple persistent to-do list.
 *
 * Students keep their own tasks here ("Revise Unit 3", "Solve 2023 paper").
 * Progress lives in localStorage so it survives reloads and works offline.
 */
export function TodoPanel({ open, onClose }: TodoPanelProps) {
  const { todos, add, toggle, remove, clearDone } = useTodoList();
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;

  const doneCount = todos.filter((t) => t.done).length;
  const total = todos.length;
  const pct = total === 0 ? 0 : Math.round((doneCount / total) * 100);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    add(draft);
    setDraft("");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="To-do list"
    >
      <div
        className="card flex max-h-[82vh] w-full max-w-md flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header
          className="flex items-center justify-between gap-3 border-b px-5 py-4"
          style={{ borderColor: "var(--line)" }}
        >
          <div className="flex items-center gap-2">
            <ListIcon width={18} height={18} />
            <div>
              <h2 className="text-base font-extrabold">✅ My to-do list</h2>
              <p className="text-xs text-[var(--muted)]">
                {total === 0
                  ? "Tasks are saved on this device."
                  : `${doneCount}/${total} done · ${pct}%`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close to-do list"
            className="btn-ghost grid h-9 w-9 place-items-center"
          >
            <CloseIcon width={16} height={16} />
          </button>
        </header>

        {/* Add task */}
        <form
          onSubmit={submit}
          className="flex items-center gap-2 border-b px-4 py-3"
          style={{ borderColor: "var(--line)" }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a task — e.g. Solve 2023 paper"
            maxLength={200}
            className="min-w-0 flex-1 rounded-xl border bg-transparent px-3 py-2 text-sm outline-none"
            style={{ borderColor: "var(--line)" }}
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            aria-label="Add task"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl transition-opacity disabled:opacity-40"
            style={{ background: "var(--brand)", color: "var(--brand-contrast, #fff)" }}
          >
            <PlusIcon width={16} height={16} />
          </button>
        </form>

        {/* Progress bar */}
        {total > 0 && (
          <div className="px-4 pt-3">
            <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, background: "var(--good)" }}
              />
            </div>
          </div>
        )}

        {/* Task list */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {total === 0 && (
            <p className="py-6 text-center text-sm leading-relaxed text-[var(--muted)]">
              No tasks yet. Add what you want to finish today — revision, practice papers,
              weak topics.
            </p>
          )}

          <ul className="space-y-2">
            {todos.map((todo) => (
              <li
                key={todo.id}
                className="flex items-start gap-2.5 rounded-xl border px-3 py-2.5"
                style={{
                  borderColor: todo.done
                    ? "color-mix(in srgb, var(--good) 45%, var(--line))"
                    : "var(--line)",
                  background: todo.done ? "color-mix(in srgb, var(--good) 8%, transparent)" : "transparent",
                }}
              >
                <button
                  type="button"
                  onClick={() => toggle(todo.id)}
                  aria-label={todo.done ? "Mark as not done" : "Mark as done"}
                  className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors"
                  style={{
                    borderColor: todo.done ? "var(--good)" : "var(--line)",
                    background: todo.done ? "var(--good)" : "transparent",
                    color: "#fff",
                  }}
                >
                  {todo.done && <CheckIcon width={12} height={12} />}
                </button>
                <span
                  className={`min-w-0 flex-1 break-words text-sm leading-relaxed ${
                    todo.done ? "text-[var(--muted)] line-through" : ""
                  }`}
                >
                  {todo.text}
                </span>
                <button
                  type="button"
                  onClick={() => remove(todo.id)}
                  aria-label="Delete task"
                  className="mt-0.5 shrink-0 text-[var(--muted)] transition-colors hover:text-[var(--bad)]"
                >
                  <TrashIcon width={15} height={15} />
                </button>
              </li>
            ))}
          </ul>
        </div>

        {doneCount > 0 && (
          <footer
            className="flex justify-end border-t px-4 py-3"
            style={{ borderColor: "var(--line)" }}
          >
            <button
              type="button"
              onClick={clearDone}
              className="flex items-center gap-1.5 text-xs font-bold text-[var(--muted)] hover:text-[var(--text)]"
            >
              <TrashIcon width={13} height={13} /> Clear completed
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}
