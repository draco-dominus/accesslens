"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Apple-style bottom sheet with three detents.
 *  - Drag the handle or the header; release snaps to the nearest detent, or one step in the direction
 *    of a quick flick. Rubber-band resistance past the lowest/highest detent.
 *  - Scroll handoff: pulling down on content that's scrolled to the top shrinks the sheet; pushing up on
 *    a lowered sheet raises it before the content scrolls.
 *  - Keyboard: the handle is a button (Enter toggles, ↑/↓ step through detents).
 *  - Motion uses CSS transitions, so the global reduced-motion rule applies.
 */

export type Detent = "peek" | "half" | "full";
const ORDER: Detent[] = ["peek", "half", "full"];
const FLICK = 0.45; // px/ms
const TAP_SLOP = 6; // px

export function Sheet({
  detent,
  onDetentChange,
  heights,
  label,
  header,
  children,
  className = "",
  contentRef,
}: {
  detent: Detent;
  onDetentChange: (d: Detent) => void;
  /** CSS length for each detent (e.g. "34%", "calc(100% - 120px)"). */
  heights: Record<Detent, string>;
  label: string;
  header?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Receives the scrollable content element (e.g. to scroll a card into view within the sheet only). */
  contentRef?: (el: HTMLDivElement | null) => void;
}) {
  const probes = useRef<Record<Detent, HTMLDivElement | null>>({ peek: null, half: null, full: null });
  const content = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(0); // + = down (shorter)
  const [dragging, setDragging] = useState(false);
  const gesture = useRef<{ y0: number; samples: { y: number; t: number }[]; moved: boolean } | null>(null);
  const justDragged = useRef(false); // suppresses the click that follows a drag

  const px = useCallback((d: Detent) => probes.current[d]?.offsetHeight ?? 0, []);

  const resist = useCallback(
    (dy: number) => {
      const cur = px(detent);
      const next = cur - dy;
      const lo = px("peek"), hi = px("full");
      if (next > hi) return cur - (hi + (next - hi) * 0.25);
      if (next < lo) return cur - (lo - (lo - next) * 0.25);
      return dy;
    },
    [detent, px],
  );

  const begin = (y: number) => {
    gesture.current = { y0: y, samples: [{ y, t: performance.now() }], moved: false };
  };
  const move = (y: number) => {
    const g = gesture.current;
    if (!g) return;
    const dy = y - g.y0;
    if (Math.abs(dy) > TAP_SLOP) g.moved = true;
    g.samples.push({ y, t: performance.now() });
    if (g.samples.length > 6) g.samples.shift();
    if (g.moved) {
      setDragging(true);
      setDrag(resist(dy));
    }
  };
  const end = (): boolean => {
    const g = gesture.current;
    gesture.current = null;
    setDragging(false);
    if (!g || !g.moved) {
      setDrag(0);
      return false;
    }
    justDragged.current = true;
    setTimeout(() => (justDragged.current = false), 0);
    const a = g.samples[0], b = g.samples.at(-1)!;
    const v = (b.y - a.y) / Math.max(1, b.t - a.t); // + = down
    const height = px(detent) - (b.y - g.y0);
    const i = ORDER.indexOf(detent);
    let target: Detent;
    if (v > FLICK) target = ORDER[Math.max(0, i - 1)];
    else if (v < -FLICK) target = ORDER[Math.min(ORDER.length - 1, i + 1)];
    else target = ORDER.reduce((best, d) => (Math.abs(px(d) - height) < Math.abs(px(best) - height) ? d : best), detent);
    setDrag(0);
    if (target !== detent) onDetentChange(target);
    return true;
  };

  // Scroll handoff on the content (native listeners: touchmove must be cancelable).
  useEffect(() => {
    const el = content.current;
    if (!el) return;
    let startY = 0;
    let owning = false;
    const onStart = (e: TouchEvent) => {
      startY = e.touches[0].clientY;
      owning = false;
    };
    const onMove = (e: TouchEvent) => {
      const y = e.touches[0].clientY;
      const dy = y - startY;
      if (!owning) {
        const atTop = el.scrollTop <= 0;
        const pullDown = dy > TAP_SLOP && atTop && detent !== "peek";
        const pushUp = dy < -TAP_SLOP && detent !== "full";
        if (pullDown || pushUp) {
          owning = true;
          begin(startY);
        }
      }
      if (owning) {
        e.preventDefault();
        move(y);
      }
    };
    const onEnd = () => {
      if (owning) end();
      owning = false;
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  });

  const step = (dir: 1 | -1) => {
    const i = ORDER.indexOf(detent);
    onDetentChange(ORDER[Math.max(0, Math.min(ORDER.length - 1, i + dir))]);
  };

  const dragProps = {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      begin(e.clientY);
    },
    onPointerMove: (e: React.PointerEvent) => {
      move(e.clientY);
      // Capture only once it's really a drag, so taps on buttons in the header still click them.
      const el = e.currentTarget as HTMLElement;
      if (gesture.current?.moved && !el.hasPointerCapture(e.pointerId)) el.setPointerCapture(e.pointerId);
    },
    onPointerUp: () => end(),
    onPointerCancel: () => end(),
  };

  return (
    <>
      {ORDER.map((d) => (
        <div
          key={d}
          aria-hidden
          ref={(el) => {
            probes.current[d] = el;
          }}
          className="pointer-events-none invisible absolute bottom-0 left-0 w-0"
          style={{ height: heights[d] }}
        />
      ))}
      <section
        aria-label={label}
        className={`absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-[34px] border border-b-0 border-glass-line bg-[var(--sheet)] shadow-[0_-12px_48px_-12px_rgba(0,0,0,0.35)] backdrop-blur-2xl backdrop-saturate-150 ${dragging ? "" : "transition-[height] duration-[520ms] ease-[var(--ease-ios)]"} ${className}`}
        style={{ height: `calc(${heights[detent]} - ${drag}px)` }}
      >
        <div {...dragProps} className="shrink-0 cursor-grab touch-none select-none active:cursor-grabbing">
          <button
            type="button"
            aria-label={`${label}: ${detent === "full" ? "fully open" : detent === "half" ? "half open" : "collapsed"}. Tap to ${detent === "full" ? "lower" : "raise"}.`}
            onClick={() => {
              if (justDragged.current) return;
              onDetentChange(detent === "full" ? "half" : detent === "peek" ? "half" : "full");
            }}
            onKeyDown={(e) => {
              if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
              e.preventDefault();
              step(e.key === "ArrowUp" ? 1 : -1);
            }}
            className="flex h-8 w-full items-center justify-center"
          >
            <span className="h-[5px] w-10 rounded-full bg-[color-mix(in_srgb,var(--fg)_30%,transparent)]" />
          </button>
          {header}
        </div>
        <div
          ref={(el) => {
            content.current = el;
            contentRef?.(el);
          }}
          className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain"
        >
          {children}
        </div>
      </section>
    </>
  );
}
