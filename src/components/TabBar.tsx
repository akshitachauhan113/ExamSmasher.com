"use client";

export interface TabItem {
  id: string;
  label: string;
  /** Optional count badge (e.g. "12") shown next to the label. */
  badge?: string;
}

interface TabBarProps {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
  ariaLabel: string;
}

/**
 * One pill-row tab bar, reused by the analysis view and the playlists view.
 * Horizontally scrollable on small screens instead of wrapping into rows.
 */
export function TabBar({ tabs, active, onChange, ariaLabel }: TabBarProps) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className="flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-extrabold transition-colors"
            style={
              isActive
                ? {
                    background: "color-mix(in srgb, var(--brand) 12%, transparent)",
                    color: "var(--brand)",
                    boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--brand) 35%, transparent)",
                  }
                : { background: "var(--surface-2)", color: "var(--muted)" }
            }
          >
            {tab.label}
            {tab.badge !== undefined && (
              <span
                className="rounded-md px-1.5 py-0.5 text-[0.62rem] font-extrabold"
                style={{
                  background: isActive
                    ? "color-mix(in srgb, var(--brand) 18%, transparent)"
                    : "var(--surface)",
                  color: isActive ? "var(--brand)" : "var(--muted)",
                }}
              >
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
