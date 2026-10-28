"use client";

import { useSyncExternalStore } from "react";
import { MoonIcon, SunIcon } from "./Icons";

/**
 * The theme lives on <html data-theme>, set before hydration by an inline
 * script. We read it with useSyncExternalStore so the server and client HTML
 * always agree, and refresh the button whenever the attribute changes.
 */
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  if (!observer && typeof MutationObserver !== "undefined") {
    observer = new MutationObserver(() => {
      listeners.forEach((l) => l());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  }

  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): string {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function getServerSnapshot(): string {
  return "light";
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("es-theme", next);
    } catch {
      /* storage can be blocked; the visual toggle still works */
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      className="btn-ghost grid h-10 w-10 place-items-center"
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
