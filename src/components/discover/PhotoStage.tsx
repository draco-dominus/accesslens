"use client";

import { useEffect, useRef, useState } from "react";
import type { NormalizedBox } from "@/lib/spatial";
import { Close } from "../ui/Icons";
import { IridescentEdge } from "../ui/primitives";

/**
 * The scanned photo, in the page's normal flow: nothing floats over it. Tap to open it full screen with
 * pinch / double-tap zoom.
 *
 * Markers are drawn ONLY from validated spatial evidence (see lib/spatial.ts). Today the analysis has no
 * coordinates, so none are drawn — positions are never invented from descriptions.
 */

export type PhotoMarker = { number: number; box: NormalizedBox };

const DEFAULT_RATIO = 3 / 4;

export function ScanPhoto({
  photo,
  alt,
  emptyText,
  processing = false,
  markers = [],
  maxHeight = "58cqh",
  onOpen,
}: {
  photo?: string;
  alt: string;
  emptyText: string;
  processing?: boolean;
  markers?: PhotoMarker[];
  /** CSS length capping the photo's height (it keeps its own proportions). */
  maxHeight?: string;
  onOpen?: () => void;
}) {
  const [ratio, setRatio] = useState(DEFAULT_RATIO);
  if (!photo) {
    return (
      <div className="grid aspect-[4/3] w-full place-items-center rounded-[28px] bg-surface-2 px-8 text-center text-[14px] leading-snug text-muted">
        {emptyText}
      </div>
    );
  }
  const frame = (
    <span className="relative block size-full">
      {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
      <img
        src={photo}
        alt={alt}
        onLoad={(e) => e.currentTarget.naturalWidth && setRatio(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)}
        className="block size-full object-contain"
        style={{ viewTransitionName: "scan-photo" }}
      />
      <Markers markers={markers} />
      {processing && <span aria-hidden className="scan-sweep pointer-events-none absolute inset-0" />}
      <IridescentEdge active={processing} ring={2.5} bloom={18} speed={5} />
    </span>
  );
  const style = { aspectRatio: ratio, width: `min(100%, calc(${maxHeight} * ${ratio}))` };
  return onOpen ? (
    <button type="button" onClick={onOpen} aria-label={`${alt}. Open full screen`} className="pressable relative mx-auto block overflow-hidden rounded-[28px] bg-black" style={style}>
      {frame}
    </button>
  ) : (
    <div className="relative mx-auto overflow-hidden rounded-[28px] bg-black" style={style}>
      {frame}
    </div>
  );
}

/** Small numbered outlines at validated positions only. */
function Markers({ markers }: { markers: PhotoMarker[] }) {
  if (!markers.length) return null;
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      {markers.map((m, i) => (
        <span
          key={i}
          className="absolute rounded-[6px] border-2 border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
          style={{ left: `${m.box.x * 100}%`, top: `${m.box.y * 100}%`, width: `${m.box.width * 100}%`, height: `${m.box.height * 100}%` }}
        >
          <span className="absolute -top-2.5 -left-2.5 grid size-5 place-items-center rounded-full bg-white text-[11px] font-bold text-black shadow">{m.number}</span>
        </span>
      ))}
    </span>
  );
}

const MAX_ZOOM = 4;
type View = { scale: number; x: number; y: number };
const IDENTITY: View = { scale: 1, x: 0, y: 0 };

/** Full-screen photo with pinch, drag and double-tap zoom. Close returns to where the user was. */
export function PhotoViewer({ photo, alt, markers = [], onClose }: { photo: string; alt: string; markers?: PhotoMarker[]; onClose: () => void }) {
  const stage = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState<View>(IDENTITY);
  const [gesturing, setGesturing] = useState(false);
  const [ratio, setRatio] = useState(DEFAULT_RATIO);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const lastTap = useRef(0);

  useEffect(() => {
    closeBtn.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const clamp = (v: View): View => {
    const el = stage.current;
    const scale = Math.min(MAX_ZOOM, Math.max(1, v.scale));
    if (!el || scale === 1) return IDENTITY;
    const mx = ((scale - 1) * el.clientWidth) / 2, my = ((scale - 1) * el.clientHeight) / 2;
    return { scale, x: Math.max(-mx, Math.min(mx, v.x)), y: Math.max(-my, Math.min(my, v.y)) };
  };

  const onPointerDown = (e: React.PointerEvent) => {
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
        const r = stage.current!.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        setView((v) => (v.scale > 1 ? IDENTITY : clamp({ scale: 2.5, x: -dx * 1.5, y: -dy * 1.5 })));
        lastTap.current = 0;
      } else lastTap.current = now;
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label={alt} data-theme="dark" className="animate-screen-in absolute inset-0 z-[60] bg-black text-white">
      <div
        ref={stage}
        className="absolute inset-x-0 top-[calc(var(--safe-top)+60px)] bottom-[calc(var(--safe-bottom)+64px)] grid touch-none place-items-center overflow-hidden"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className={`relative max-h-full max-w-full ${gesturing ? "" : "transition-transform duration-300 ease-[var(--ease-ios)]"}`}
          style={{ aspectRatio: ratio, width: `min(100%, calc((100cqh - var(--safe-top) - var(--safe-bottom) - 124px) * ${ratio}))`, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
          <img src={photo} alt={alt} draggable={false} onLoad={(e) => e.currentTarget.naturalWidth && setRatio(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)} className="block size-full object-contain select-none" />
          <Markers markers={markers} />
        </div>
      </div>
      <div className="absolute inset-x-0 top-[calc(var(--safe-top)+6px)] flex items-center justify-between px-4">
        <button ref={closeBtn} type="button" onClick={onClose} aria-label="Close photo" className="pressable grid size-11 place-items-center rounded-full bg-white/12 backdrop-blur-xl">
          <Close size={19} />
        </button>
        {view.scale > 1 && (
          <button type="button" onClick={() => setView(IDENTITY)} className="pressable min-h-11 rounded-full bg-white/12 px-4 text-[14px] font-semibold backdrop-blur-xl">
            Reset zoom
          </button>
        )}
      </div>
      <p className="absolute inset-x-0 bottom-[calc(var(--safe-bottom)+18px)] text-center text-[13px] text-white/70">Pinch or double-tap to zoom</p>
    </div>
  );
}
