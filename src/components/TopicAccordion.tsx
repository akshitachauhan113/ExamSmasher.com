"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { Topic } from "@/lib/types";

/** Accordion group for a topic — its unit/chapter, or a fallback bucket. */
export function unitKeyOf(topic: Topic): string {
  const chapter = topic.chapter?.trim();
  return chapter && chapter.length > 0 ? chapter : "General";
}

interface UnitGroup {
  key: string;
  topics: Topic[];
}

/** Groups topics by unit, keeping the order they came out of the syllabus in. */
function groupByUnit(topics: Topic[]): UnitGroup[] {
  const groups: UnitGroup[] = [];
  const byKey = new Map<string, UnitGroup>();
  for (const topic of topics) {
    const key = unitKeyOf(topic);
    let group = byKey.get(key);
    if (!group) {
      group = { key, topics: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.topics.push(topic);
  }
  return groups;
}

interface TopicAccordionProps {
  topics: Topic[];
  /** Unit keys currently opened. Collapsed by default = compact page. */
  expanded: Set<string>;
  onToggleUnit: (key: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  /** Renders one topic's full panel (search links, notes, PYQ practice…). */
  renderTopic: (topic: Topic, index: number) => ReactNode;
}

/**
 * Units as accordion sections: a one-line summary (topic count + minutes) is
 * always visible, the detail only opens when asked. Nothing is dropped —
 * every topic stays reachable inside its unit.
 */
export function TopicAccordion({
  topics,
  expanded,
  onToggleUnit,
  onExpandAll,
  onCollapseAll,
  renderTopic,
}: TopicAccordionProps) {
  const groups = groupByUnit(topics);
  const indexOf = new Map(topics.map((topic, index) => [topic.id, index]));
  const allOpen = groups.length > 0 && groups.every((g) => expanded.has(g.key));

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[0.7rem] font-extrabold uppercase tracking-wide text-[var(--muted)]">
          {groups.length} unit{groups.length > 1 ? "s" : ""} · {topics.length} topics
        </p>
        <button
          type="button"
          onClick={allOpen ? onCollapseAll : onExpandAll}
          className="text-[0.7rem] font-bold"
          style={{ color: "var(--brand)" }}
        >
          {allOpen ? "Sab band karo" : "Sab expand karo"}
        </button>
      </div>

      <div className="space-y-2.5">
        {groups.map((group) => {
          const open = expanded.has(group.key);
          const minutes = group.topics.reduce((sum, t) => sum + t.estimatedMinutes, 0);
          return (
            <section
              key={group.key}
              className="card overflow-hidden"
              style={{ padding: 0 }}
              data-unit-key={group.key}
            >
              <button
                type="button"
                onClick={() => onToggleUnit(group.key)}
                aria-expanded={open}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--surface-2)]"
              >
                <ChevronDown
                  width={16}
                  height={16}
                  strokeWidth={2.4}
                  style={{
                    color: "var(--brand)",
                    transform: open ? undefined : "rotate(-90deg)",
                    transition: "transform .15s ease",
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-extrabold">{group.key}</span>
                  <span className="mt-0.5 block text-[0.7rem] text-[var(--muted)]">
                    {group.topics.length} topic{group.topics.length > 1 ? "s" : ""} · ~{minutes} min
                  </span>
                </span>
                <span className="chip shrink-0">{open ? "Open" : "Expand"}</span>
              </button>

              {open && (
                <div className="space-y-8 border-t px-4 pb-5 pt-4" style={{ borderColor: "var(--line)" }}>
                  {group.topics.map((topic) =>
                    renderTopic(topic, indexOf.get(topic.id) ?? 0),
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
