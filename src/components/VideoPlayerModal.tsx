"use client";

import { useEffect } from "react";
import { CloseIcon, ExternalIcon } from "./Icons";

export interface PlayerVideo {
  id: string;
  title: string;
  channelTitle: string;
}

interface VideoPlayerModalProps {
  video: PlayerVideo | null;
  onClose: () => void;
}

/**
 * Preview a suggested lecture INSIDE ExamSmasher instead of sending the
 * student away — they watch, close, and are exactly where they left off.
 * The "YouTube" button is still there for full-screen watching, and closing
 * (Esc / ✕ / backdrop) returns to the playlists with all progress intact.
 *
 * Restored from the original video-recommendation UI; the player itself is
 * YouTube's own embed of a REAL video id that the API returned.
 */
export function VideoPlayerModal({ video, onClose }: VideoPlayerModalProps) {
  useEffect(() => {
    if (!video) return;
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
  }, [video, onClose]);

  if (!video) return null;

  const embedUrl = `https://www.youtube.com/embed/${video.id}?autoplay=1&rel=0&modestbranding=1&playsinline=1`;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Playing ${video.title}`}
    >
      <div
        className="w-full max-w-4xl overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">{video.title}</p>
            <p className="truncate text-xs text-[var(--muted)]">{video.channelTitle}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <a
              href={`https://www.youtube.com/watch?v=${video.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-ghost flex items-center gap-1.5 px-2.5 py-1.5 text-xs"
              aria-label={`Open on YouTube: ${video.title}`}
            >
              <ExternalIcon width={13} height={13} /> YouTube par kholo
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close player"
              className="btn-ghost grid h-8 w-8 place-items-center"
            >
              <CloseIcon width={15} height={15} />
            </button>
          </div>
        </div>

        <div className="aspect-video w-full bg-black">
          <iframe
            key={video.id}
            src={embedUrl}
            title={video.title}
            className="h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>

        <p className="px-4 py-2.5 text-[0.7rem] text-[var(--muted)]">
          Tip: pause karo, ek step khud solve karo, phir aage badho — tabhi video se real faida
          hoga. Band karke wapas ExamSmasher me hi progress continue karo.
        </p>
      </div>
    </div>
  );
}
