"use client";

import { useRef, useState } from "react";
import { findingCaptionForScan } from "@/lib/session/lumi";
import type { Session, TrackedFinding } from "@/lib/session/types";
import { ChevronRight } from "../ui/Icons";
import { BarrierIcon } from "../ui/Needs";
import { IridescentEdge } from "../ui/primitives";

/**
 * Image-first view of a scan. The photo is the centerpiece; findings connect to it through:
 *  - a rail of finding chips over the photo (tap → that finding's evidence caption + its card), and
 *  - an evidence caption quoting the AI's own described location and what it saw.
 * There are deliberately NO boxes or markers on the image: the backend returns no coordinates, and
 * drawing guessed regions would look like computer vision we don't have. People can inspect the
 * evidence themselves with pinch / double-tap zoom and pan, or the zoom buttons (no gesture required).
 */

const MAX_ZOOM = 4;
type View = { scale: number; x: number; y: number };
const IDENTITY: View = { scale: 1, x: 0, y: 0 };

export function PhotoStage({
  photo,
  alt,
  emptyText,
  processing,
  session,
  scanId,
  findings,
  selectedId,
  onSelect,
  onOpenDetails,
  compact = false,
  bottom,
}: {
  photo?: string;
  alt: string;
  emptyText: string;
  processing: boolean;
  session: Session;
  scanId: string;
  findings: TrackedFinding[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Open the full Finding Details screen. */
  onOpenDetails?: (id: string) => void;
  /** Little photo visible (sheet fully raised): hide references, zoom and caption. */
  compact?: boolean;
  /** Space taken by the sheet below (CSS length); the photo fits above it. */
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
  const selected = findings.find((f) => f.id === selectedId);
  const selectedCaption = selected ? findingCaptionForScan(session, scanId, selected) : null;

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
        const el = stage.current!;
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        setView((v) => (v.scale > 1 ? IDENTITY : clamp({ scale: 2.5, x: -dx * 1.5, y: -dy * 1.5 })));
        lastTap.current = 0;
      } else lastTap.current = now;
    }
  };

  return (
    <div
      className="absolute inset-x-1.5 top-1.5 overflow-hidden rounded-[44px] bg-[#0b0b0c] transition-[bottom] duration-[520ms] ease-[var(--ease-ios)] sm:rounded-[42px]"
      style={{ bottom: `calc(${bottom} - 28px)` }}
    >
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
          <p className="absolute inset-x-8 top-[40%] text-center text-[14px] text-white/70">{emptyText}</p>
        )}
      </div>
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.5),transparent_22%,transparent_70%,rgba(0,0,0,0.55))]" />
      {/* Focus: the photo dims softly while one finding is being explored. */}
      <div aria-hidden className={`pointer-events-none absolute inset-0 bg-black/30 transition-opacity duration-500 ${selectedCaption && !compact ? "opacity-100" : "opacity-0"}`} />
      {/* Analysis in progress: a soft light sweep. It marks activity only; it never implies detections. */}
      {processing && photo && <div aria-hidden className="scan-sweep pointer-events-none absolute inset-0" />}
      <IridescentEdge active={processing} ring={2.5} bloom={22} speed={5} />

      {/* Evidence caption for the selected finding, linked to its reference below. Words only: nothing is
          drawn on the image, because no coordinates exist. */}
      {selectedCaption && selected && !compact && (
        <div className="absolute inset-x-3 bottom-[92px]" aria-live="polite">
          <div key={selected.id} className="animate-rise-in rounded-[22px] border border-white/15 bg-black/65 px-4 pt-3 pb-2.5 text-white backdrop-blur-xl">
            <p className="text-[13px] font-semibold text-white/80">{selectedCaption.label}</p>
            <p className="mt-0.5 line-clamp-3 text-[15px] leading-snug">{selectedCaption.text}</p>
            {onOpenDetails && (
              <button
                type="button"
                onClick={() => onOpenDetails(selected.id)}
                className="pressable mt-2 inline-flex min-h-10 items-center gap-1 rounded-full bg-white px-3.5 text-[14px] font-semibold text-black"
              >
                Details <ChevronRight size={16} />
              </button>
            )}
          </div>
          {/* Notch pointing down to the selected reference. */}
          <span aria-hidden className="ml-7 block size-3 -translate-y-1.5 rotate-45 border-r border-b border-white/15 bg-black/65" />
        </div>
      )}

      {/* Zoom controls: an alternative to pinch/double-tap. */}
      {photo && !compact && !selectedCaption && (
        <div className="absolute right-3 bottom-[76px] flex flex-col gap-1.5" role="group" aria-label="Photo zoom">
          <ZoomButton label="Zoom in" onClick={() => zoomBy(1.6)} disabled={view.scale >= MAX_ZOOM}>
            +
          </ZoomButton>
          <ZoomButton label="Zoom out" onClick={() => zoomBy(1 / 1.6)} disabled={view.scale <= 1}>
            −
          </ZoomButton>
          {view.scale > 1 && (
            <ZoomButton label="Reset zoom" onClick={() => setView(IDENTITY)}>
              1×
            </ZoomButton>
          )}
        </div>
      )}

      {/* Numbered finding references: linked to the findings, not placed on the image. */}
      {findings.length > 0 && !compact && (
        <div className="absolute inset-x-0 bottom-9 px-3">
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto pr-3" role="group" aria-label="Finding references in this photo">
            {findings.map((f) => {
              const on = f.id === selectedId;
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={on}
                  aria-label={`Finding ${f.number}: ${f.details.title}${on ? ", selected" : ""}`}
                  onClick={() => onSelect(on ? null : f.id)}
                  className={`pressable relative flex min-h-11 max-w-[80%] shrink-0 items-center gap-2 rounded-full border py-1.5 pr-3.5 pl-1.5 text-[14px] font-semibold backdrop-blur-xl transition-colors duration-300 ${on ? "border-white bg-white text-black" : "border-white/20 bg-black/55 text-white"}`}
                >
                  {on && <span key={`focus-${f.id}`} aria-hidden className="ref-focus pointer-events-none absolute inset-0 rounded-full" />}
                  <span className={`grid size-7 shrink-0 place-items-center rounded-full text-[13px] font-bold ${on ? "bg-black text-white" : "bg-white/15"}`}>{f.number}</span>
                  <BarrierIcon type={f.details.barrierType} size={15} className="shrink-0 opacity-80" />
                  <span className="truncate">{f.details.title}</span>
                </button>
              );
            })}
          </div>
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
      className="pressable grid size-11 place-items-center rounded-full border border-white/20 bg-black/50 text-[18px] font-semibold text-white backdrop-blur-xl disabled:opacity-35"
    >
      {children}
    </button>
  );
}
