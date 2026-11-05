"use client";

import type { CSSProperties } from "react";
import { Home, LayoutGrid, ListVideo, Settings } from "lucide-react";

/** Where the student currently is. One route, four views — no page reloads. */
export type AppView = "home" | "space" | "playlists" | "settings";

interface NavItem {
  id: AppView;
  label: string;
  shortLabel: string;
  Icon: typeof Home;
}

const ITEMS: NavItem[] = [
  { id: "home", label: "Home", shortLabel: "Home", Icon: Home },
  { id: "space", label: "My Study Space", shortLabel: "Space", Icon: LayoutGrid },
  { id: "playlists", label: "My Playlists", shortLabel: "Playlists", Icon: ListVideo },
  { id: "settings", label: "Settings", shortLabel: "Settings", Icon: Settings },
];

function activeStyle(active: boolean): CSSProperties {
  return active
    ? {
        background: "color-mix(in srgb, var(--brand) 12%, transparent)",
        color: "var(--brand)",
      }
    : { color: "var(--muted)" };
}

/** Desktop: a small pill row inside the header. */
export function SiteNav({ view, onChange }: { view: AppView; onChange: (v: AppView) => void }) {
  return (
    <nav className="hidden items-center gap-1 md:flex" aria-label="Main navigation">
      {ITEMS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-current={view === id ? "page" : undefined}
          className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold transition-colors"
          style={activeStyle(view === id)}
        >
          <Icon width={15} height={15} strokeWidth={2.2} />
          {label}
        </button>
      ))}
    </nav>
  );
}

/** Mobile: a compact fixed bottom bar (four items, icon + label). */
export function BottomNav({ view, onChange }: { view: AppView; onChange: (v: AppView) => void }) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--line)] backdrop-blur-md md:hidden"
      style={{
        background: "color-mix(in srgb, var(--bg) 92%, transparent)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
      aria-label="Main navigation"
    >
      <div className="grid grid-cols-4">
        {ITEMS.map(({ id, shortLabel, Icon }) => {
          const active = view === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              aria-current={active ? "page" : undefined}
              className="flex flex-col items-center gap-0.5 px-1 py-2.5 text-[0.62rem] font-bold transition-colors"
              style={{ color: active ? "var(--brand)" : "var(--muted)" }}
            >
              <Icon width={19} height={19} strokeWidth={active ? 2.4 : 2} />
              {shortLabel}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
