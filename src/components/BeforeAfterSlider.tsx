"use client";

import { useState } from "react";
import type { PickedPhoto } from "./PhotoPicker";

/**
 * Overlay comparison: BEFORE on the left of the divider, AFTER on the right.
 * Controlled by a native range input, so it works with keyboard, touch, and screen readers.
 */
export function BeforeAfterSlider({ before, after }: { before: PickedPhoto; after: PickedPhoto }) {
  const [mode, setMode] = useState<"slider" | "side">("slider");
  const [pos, setPos] = useState(50);

  const ratio = (p: PickedPhoto) => (p.width && p.height ? p.width / p.height : 4 / 3);
  const shapesDiffer = Math.abs(ratio(before) - ratio(after)) > 0.05;

  return (
    <div>
      <div role="group" aria-label="Comparison view" className="mb-2 flex gap-2 text-sm">
        {(["slider", "side"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={`rounded border px-3 py-1 ${mode === m ? "border-blue-700 bg-blue-700 text-white" : "border-zinc-400"}`}
          >
            {m === "slider" ? "Slider" : "Side by side"}
          </button>
        ))}
      </div>

      {mode === "side" ? (
        <div className="grid grid-cols-2 gap-2">
          {[
            { name: "Before", photo: before },
            { name: "After", photo: after },
          ].map(({ name, photo }) => (
            <figure key={name}>
              {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
              <img src={photo.url} alt={`${name} photo`} className="w-full rounded object-contain" />
              <figcaption className="text-center text-sm font-medium">{name}</figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <>
          <div
            className="relative w-full overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800"
            style={{ aspectRatio: String(ratio(before)) }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
            <img src={before.url} alt="Before photo" className="absolute inset-0 h-full w-full object-contain" />
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
            <img
              src={after.url}
              alt="After photo"
              className="absolute inset-0 h-full w-full object-contain"
              style={{ clipPath: `inset(0 0 0 ${pos}%)` }}
            />
            <div aria-hidden className="absolute inset-y-0 w-0.5 bg-white shadow" style={{ left: `${pos}%` }} />
            <span className="absolute left-2 top-2 rounded bg-black/70 px-2 py-0.5 text-xs text-white">Before</span>
            <span className="absolute right-2 top-2 rounded bg-black/70 px-2 py-0.5 text-xs text-white">After</span>
          </div>
          <label className="mt-2 block text-sm">
            <span className="sr-only">Divider position between before and after photos</span>
            <input
              type="range"
              min={0}
              max={100}
              value={pos}
              onChange={(e) => setPos(Number(e.target.value))}
              aria-valuetext={`${pos}% before, ${100 - pos}% after`}
              className="w-full"
            />
          </label>
          {shapesDiffer && (
            <p className="text-xs opacity-70">
              The photos have different shapes, so the overlay won&apos;t line up exactly. Use side by side to compare.
            </p>
          )}
        </>
      )}
    </div>
  );
}
