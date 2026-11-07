"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Columns, Compare as CompareIcon } from "./Icons";

/**
 * Earlier vs. later scan (adapted from the prototype's BeforeAfter). The backend gives no image
 * coordinates, so there's no zoom to a "point of interest": both photos are shown whole
 * (object-contain), exactly as the AI compared them. Slider + side-by-side for people who can't drag.
 */
export function BeforeAfter({
  earlier,
  later,
  earlierLabel,
  laterLabel,
}: {
  earlier: string;
  later: string;
  earlierLabel: string;
  laterLabel: string;
}) {
  const [mode, setMode] = useState<"slider" | "side">("slider");
  const [pos, setPos] = useState(50);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[14px] font-semibold text-fg">Earlier and now</p>
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
        <div className="relative aspect-[3/4] overflow-hidden rounded-[20px] bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
          <img src={earlier} alt={earlierLabel} className="absolute inset-0 size-full object-contain" />
          <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${pos}%)` }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
            <img src={later} alt={laterLabel} className="absolute inset-0 size-full object-contain" />
          </div>
          <Tag className="left-2.5">Earlier</Tag>
          <Tag className="right-2.5">Now</Tag>
          <div aria-hidden className="pointer-events-none absolute inset-y-0" style={{ left: `${pos}%` }}>
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
            value={pos}
            onChange={(e) => setPos(Number(e.target.value))}
            aria-label="Comparison divider"
            aria-valuetext={`${pos}% earlier scan, ${100 - pos}% latest scan`}
            className="peer absolute inset-0 size-full cursor-ew-resize opacity-0"
          />
          <div className="pointer-events-none absolute inset-0 rounded-[20px] ring-white peer-focus-visible:ring-2 peer-focus-visible:ring-inset" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["Earlier", earlier, earlierLabel],
              ["Now", later, laterLabel],
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
    <span className={`absolute top-2.5 rounded-full bg-black/55 px-2.5 py-1 text-[12px] font-semibold text-white backdrop-blur-xl ${className}`}>
      {children}
    </span>
  );
}
