"use client";

import { useRef, useState } from "react";
import type { TrackedFinding } from "@/lib/session/types";
import { IridescentEdge } from "../ui/primitives";

/**
 * The scanned photo, unobstructed.
 *
 * Layout guarantees nothing sits on the image: the stage starts below the floating nav and ends above
 * the results sheet, and the numbered finding references + zoom controls live in a narrow gutter BESIDE
 * the image, not on it. There is no caption or text over the photo.
 *
 * References are numbers along the edge, never placed at positions on the image: the analysis returns
 * no coordinates, and arbitrary positions would look like detections we don't have. Selecting one gives
 * quiet feedback (the number enlarges and pulses once, the frame glows briefly); the finding's name is
 * shown in the sheet, below the photo.
 */

const MAX_ZOOM = 4;
type View = { scale: number; x: number; y: number };
const IDENTITY: View = { scale: 1, x: 0, y: 0 };

export function PhotoStage({
  photo,
  alt,
  emptyText,
  processing,
  findings,
  selectedId,
  onSelect,
  compact = false,
  bottom,
}: {
  photo?: string;
  alt: string;
  emptyText: string;
  processing: boolean;
  findings: TrackedFinding[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Sheet fully raised (little photo visible): hide the gutter. */
  compact?: boolean;
  /** Space taken by the sheet below (CSS length); the photo ends above it. */
  bottom: string;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(IDENTITY);
  const [gesturing, setGesturing] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const lastTap = useRef(0);

  const clamp = (v: View): View => {
    const el = stage.current;
    const scale = Math.min(MAX_ZOOM, Math.max(1, v.scale));
    if (!el || scale === 1) return IDENTITY;
    const mx = ((scale - 1) * el.clientWidth) / 2, my = ((scale - 1) * el.clientHeight) / 2;
    return { scale, x: Math.max(-mx, Math.min(mx, v.x)), y: Math.max(-my, Math.min(my, v.y)) };
  };
  const zoomBy = (factor: number) => setView((v) => clamp({ ...v, scale: v.scale * factor }));

  const onPointerDown = (e: React.PointerEvent) => {
    if (!photo) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: view.scale };
    }
    setGesturing(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      setView((v) => clamp({ ...v, scale: (pinch.current!.scale * dist) / pinch.current!.dist }));
    } else if (pointers.current.size === 1 && view.scale > 1) {
      setView((v) => clamp({ ...v, x: v.x + e.clientX - prev.x, y: v.y + e.clientY - prev.y }));
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) {
      setGesturing(false);
      const now = performance.now();
      if (now - lastTap.current < 280) {
        // Double tap: zoom to 2.5× around the tap, or back out.
        const r = stage.current!.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        setView((v) => (v.scale > 1 ? IDENTITY : clamp({ scale: 2.5, x: -dx * 1.5, y: -dy * 1.5 })));
        lastTap.current = 0;
      } else lastTap.current = now;
    }
  };

  const showGutter = !compact && (findings.length > 0 || Boolean(photo));

  return (
    <div
      className="absolute inset-x-1.5 flex gap-1.5 transition-[bottom] duration-[520ms] ease-[var(--ease-ios)]"
      style={{ top: "calc(var(--safe-top) + 60px)", bottom: `calc(${bottom} + 8px)` }}
    >
      {/* Image area: nothing is layered on top of the photo. */}
      <div className="relative min-w-0 flex-1 overflow-hidden rounded-[30px] bg-[#0b0b0c]">
        <div
          ref={stage}
          className="absolute inset-0 touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- local blob URL
            <img
              src={photo}
              alt={alt}
              draggable={false}
              style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`, viewTransitionName: "scan-photo" }}
              className={`absolute inset-0 size-full object-contain select-none ${gesturing ? "" : "transition-transform duration-300 ease-[var(--ease-ios)]"}`}
            />
          ) : (
            <p className="absolute inset-x-6 top-[42%] text-center text-[14px] text-white/70">{emptyText}</p>
          )}
        </div>
        {/* Analysis in progress: a soft light sweep — activity only, never detections. */}
        {processing && photo && <div aria-hidden className="scan-sweep pointer-events-none absolute inset-0" />}
        <IridescentEdge active={processing} ring={2.5} bloom={18} speed={5} />
        {/* Quiet selection feedback: the frame glows once. Border only; the image stays clear. */}
        {selectedId && <div key={selectedId} aria-hidden className="photo-focus pointer-events-none absolute inset-0 rounded-[30px]" />}
      </div>

      {/* Edge gutter: numbered references (not positioned on the image) + zoom. */}
      {showGutter && (
        <div className="flex w-11 shrink-0 flex-col items-center gap-1.5 py-1">
          <div className="no-scrollbar flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto" role="group" aria-label="Finding references">
            {findings.map((f) => {
              const on = f.id === selectedId;
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={on}
                  aria-label={`Finding ${f.number}: ${f.details.title}${on ? ", selected" : ""}`}
                  onClick={() => onSelect(on ? null : f.id)}
                  className={`pressable relative grid size-11 shrink-0 place-items-center rounded-full border text-[15px] font-bold transition-[background-color,color,transform] duration-300 ${on ? "scale-105 border-white bg-white text-black" : "border-white/20 bg-white/10 text-white"}`}
                >
                  {on && <span key={`focus-${f.id}`} aria-hidden className="ref-focus pointer-events-none absolute inset-0 rounded-full" />}
                  {f.number}
                </button>
              );
            })}
          </div>
          {photo && (
            // One toggle keeps the gutter short enough for several references on small phones;
            // pinch and double-tap zoom work too.
            <div className="flex shrink-0 flex-col" role="group" aria-label="Photo zoom">
              {view.scale > 1 ? (
                <ZoomButton label="Reset zoom" onClick={() => setView(IDENTITY)}>
                  1×
                </ZoomButton>
              ) : (
                <ZoomButton label="Zoom in" onClick={() => zoomBy(2)}>
                  +
                </ZoomButton>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ZoomButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="pressable grid size-11 place-items-center rounded-full border border-white/20 bg-white/10 text-[16px] font-semibold text-white disabled:opacity-35"
    >
      {children}
    </button>
  );
}
