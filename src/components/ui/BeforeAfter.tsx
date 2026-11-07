"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Columns, Compare as CompareIcon } from "./Icons";

/**
 * Before vs. after photos of the same spot, shown whole (object-contain), exactly as the AI compared them.
 *
 * - Drag anywhere on the photo: horizontal drags move the divider directly; vertical swipes still scroll
 *   the page (touch-action: pan-y). A visually hidden range input keeps it keyboard / VoiceOver operable.
 * - `reveal`: the first time it appears, the "after" photo wipes in once from the right. Skipped with
 *   reduced motion or as soon as the user touches it.
 * - Side-by-side view for people who prefer not to drag.
 */
export function BeforeAfter({
  earlier,
  later,
  earlierLabel,
  laterLabel,
  reveal = false,
}: {
  earlier: string;
  later: string;
  /** Accessible descriptions of each photo (e.g. "Scan 3, before"). */
  earlierLabel: string;
  laterLabel: string;
  reveal?: boolean;
}) {
  const [mode, setMode] = useState<"slider" | "side">("slider");
  // Decided once on mount: reduced motion skips the reveal entirely.
  const [play] = useState(() => reveal && typeof window !== "undefined" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [pos, setPos] = useState(() => (play ? 100 : 50));
  const [animating, setAnimating] = useState(play);
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; active: boolean } | null>(null);

  // One-time reveal: Before fills the frame, then After wipes in to the middle.
  useEffect(() => {
    if (!play) return;
    const t1 = window.setTimeout(() => setPos(50), 450);
    const t2 = window.setTimeout(() => setAnimating(false), 450 + 1100);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [play]);

  const posFrom = (clientX: number) => {
    const r = frame.current!.getBoundingClientRect();
    return Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100));
  };
  const onPointerDown = (e: React.PointerEvent) => {
    setAnimating(false);
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, active: e.pointerType === "mouse" };
    if (e.pointerType === "mouse") {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setPos(posFrom(e.clientX));
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.active) {
      // Decide once: a mostly-horizontal start is a divider drag; otherwise let the page scroll.
      const dx = Math.abs(e.clientX - d.x), dy = Math.abs(e.clientY - d.y);
      if (dx < 6 && dy < 6) return;
      if (dy > dx) {
        drag.current = null;
        return;
      }
      d.active = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    setPos(posFrom(e.clientX));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    // A tap (no drag) moves the divider to that point.
    if (d && !d.active && d.id === e.pointerId) setPos(posFrom(e.clientX));
    drag.current = null;
  };

  const rounded = Math.round(pos);
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-[13px] font-medium text-muted">{mode === "slider" ? "Drag to compare" : "Side by side"}</p>
        <div role="radiogroup" aria-label="Comparison view" className="flex rounded-full bg-surface-2 p-0.5">
          {(
            [
              ["slider", "Slider", CompareIcon],
              ["side", "Side by side", Columns],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={mode === id}
              aria-label={label}
              onClick={() => setMode(id)}
              className={`pressable grid size-11 place-items-center rounded-full transition-colors ${mode === id ? "bg-surface text-fg shadow-[var(--shadow-soft)]" : "text-muted"}`}
            >
              <Icon size={18} />
            </button>
          ))}
        </div>
      </div>

      {mode === "slider" ? (
        <div
          ref={frame}
          className="relative aspect-[3/4] touch-pan-y overflow-hidden rounded-[20px] bg-black select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => (drag.current = null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
          <img src={earlier} alt={earlierLabel} draggable={false} className="absolute inset-0 size-full object-contain" />
          <div
            className={`absolute inset-0 ${animating ? "transition-[clip-path] duration-[1100ms] ease-[cubic-bezier(0.22,1,0.36,1)]" : ""}`}
            style={{ clipPath: `inset(0 0 0 ${pos}%)` }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
            <img src={later} alt={laterLabel} draggable={false} className="absolute inset-0 size-full object-contain" />
          </div>
          <Tag className="left-2.5">Before</Tag>
          <Tag className={`right-2.5 transition-opacity duration-300 ${pos > 88 ? "opacity-0" : "opacity-100"}`}>After</Tag>
          <div
            aria-hidden
            className={`pointer-events-none absolute inset-y-0 ${animating ? "transition-[left] duration-[1100ms] ease-[cubic-bezier(0.22,1,0.36,1)]" : ""}`}
            style={{ left: `${pos}%` }}
          >
            <div className="absolute inset-y-0 -left-px w-0.5 bg-white shadow-[0_0_10px_rgba(0,0,0,0.5)]" />
            <div className="absolute top-1/2 left-0 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/40 bg-white/25 text-white backdrop-blur-xl">
              <span className="flex -space-x-1">
                <ChevronLeft size={15} strokeWidth={2.4} />
                <ChevronRight size={15} strokeWidth={2.4} />
              </span>
            </div>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={rounded}
            onChange={(e) => {
              setAnimating(false);
              setPos(Number(e.target.value));
            }}
            aria-label="Comparison divider: left shows before, right shows after"
            aria-valuetext={`${rounded}% before, ${100 - rounded}% after`}
            className="peer sr-only"
          />
          <div className="pointer-events-none absolute inset-0 rounded-[20px] ring-white peer-focus-visible:ring-2 peer-focus-visible:ring-inset" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["Before", earlier, earlierLabel],
              ["After", later, laterLabel],
            ] as const
          ).map(([label, src, alt]) => (
            <figure key={label}>
              <div className="relative aspect-[3/4] overflow-hidden rounded-[16px] bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
                <img src={src} alt={alt} className="absolute inset-0 size-full object-contain" />
              </div>
              <figcaption className="mt-1.5 text-center text-[13px] font-semibold text-fg">{label}</figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}

function Tag({ children, className = "" }: { children: string; className?: string }) {
  return (
    <span className={`pointer-events-none absolute top-2.5 rounded-full bg-black/55 px-2.5 py-1 text-[12px] font-semibold text-white backdrop-blur-xl ${className}`}>
      {children}
    </span>
  );
}
