"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { useWalkthrough } from "@/hooks/useWalkthrough";
import { fitContain, type Size } from "@/lib/fit";
import { areaOf, areas } from "@/lib/session/areas";
import { openFindingsLastSeenIn } from "@/lib/session/engine";
import { scanActivity } from "@/lib/session/lumi";
import type { LumiMood } from "../lumi/Sidekick";
import { Camera, Layers, Photos } from "../ui/Icons";
import { IridescentEdge, SidekickCapsule } from "../ui/primitives";

type Walkthrough = ReturnType<typeof useWalkthrough>;
type CamState = "starting" | "live" | "unavailable" | "denied";

const cameraSupported = () =>
  typeof window !== "undefined" && window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia);

/** Until the camera reports its size, assume a typical phone sensor in portrait. */
const DEFAULT_FRAME: Size = { w: 3, h: 4 };

/**
 * Camera-first scan (adapted from the prototype's Scan screen).
 *
 * What you see is what gets analyzed: the viewfinder is a "capture frame" with the camera stream's exact
 * aspect ratio, fitted (never cropped or stretched) between Lumi's guidance and the controls. The captured
 * photo is the full camera frame — the same field of view shown in the frame. The Line-up guide is drawn in
 * the same frame with the same fit, so aligning to it aligns the actual photo.
 *
 * Without a live camera (no HTTPS / permission denied) the native camera or photo picker is used, and
 * the Line-up photo is shown as a reference instead of an overlay.
 *
 * Two explicit modes, chosen before the camera opens:
 *  - Scan new area (default): plain capture. No Line up, no comparison.
 *  - Re-check (recheckScanId): the earlier photo is the Line-up guide and the capture is compared with it.
 */
export function ScanScreen({
  wt,
  onCapture,
  recheckScanId,
}: {
  wt: Walkthrough;
  onCapture: (file: File, lineUpScanId?: string) => void;
  /** Re-check mode: the earlier scan whose photo this capture is lined up with and compared against. */
  recheckScanId?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const takeInput = useRef<HTMLInputElement>(null);
  const pickInput = useRef<HTMLInputElement>(null);
  const [cam, setCam] = useState<CamState>(() => (cameraSupported() ? "starting" : "unavailable"));
  const [flash, setFlash] = useState(0);
  // Re-check mode only: the outline of the earlier photo can be hidden, but the target stays.
  const [outline, setOutline] = useState(true);
  const [areaSize, setAreaSize] = useState<Size | null>(null);
  const [videoSize, setVideoSize] = useState<Size | null>(null);
  const [ghostSize, setGhostSize] = useState<Size | null>(null);

  const session = wt.session;
  const busy = session?.scans.find((s) => s.step !== "done" && s.step !== "error");

  // Re-check target: the earlier photo and the open concerns it shows.
  const target = useMemo(() => {
    const scan = recheckScanId ? session?.scans.find((sc) => sc.id === recheckScanId) : undefined;
    const url = scan ? (wt.media[scan.id]?.imageUrl ?? wt.media[scan.id]?.thumbUrl) : undefined;
    return scan && url ? { scan, url, findings: openFindingsLastSeenIn(session!, scan.id), area: areaOf(session!, scan.id)?.number ?? scan.number } : null;
  }, [recheckScanId, session, wt.media]);
  const ghost = target && outline ? target : null;
  const newArea = (session?.scans.length ? areas(session).length : 0) + 1;

  // Space available for the capture frame (between the guidance capsule and the controls).
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setAreaSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!cameraSupported()) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    const v = video.current;
    // The stream's real size (it changes if the phone rotates).
    const onSize = () => v && v.videoWidth && setVideoSize({ w: v.videoWidth, h: v.videoHeight });
    v?.addEventListener("loadedmetadata", onSize);
    v?.addEventListener("resize", onSize);
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
      .then(async (s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (v) {
          v.srcObject = s;
          await v.play().catch(() => {});
          onSize();
        }
        setCam("live");
      })
      .catch((err: DOMException) => setCam(err?.name === "NotAllowedError" ? "denied" : "unavailable"));
    return () => {
      cancelled = true;
      v?.removeEventListener("loadedmetadata", onSize);
      v?.removeEventListener("resize", onSize);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const live = cam === "live" && Boolean(videoSize);
  const frameMedia = live ? videoSize! : ghost && ghostSize ? ghostSize : DEFAULT_FRAME;
  const frame = areaSize ? fitContain(areaSize, frameMedia) : null;

  /** Capture the full camera frame — exactly the field of view shown in the capture frame. */
  const captureFrame = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d")!.drawImage(v, 0, 0, canvas.width, canvas.height);
    setFlash((n) => n + 1);
    canvas.toBlob(
      (blob) => blob && onCapture(new File([blob], `scan-${Date.now()}.jpg`, { type: "image/jpeg" }), target?.scan.id),
      "image/jpeg",
      0.92,
    );
  };

  const onPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) onCapture(file, target?.scan.id);
  };

  const targetWhat = target?.findings[0]?.details.title.toLowerCase();
  const mood: LumiMood = target ? "ready" : busy ? "thinking" : "ready";
  const title = target
    ? `Re-check Area ${target.area}`
    : session?.scans.length
      ? `Scan Area ${newArea}`
      : "Let’s look at this space";
  const detail = target
    ? live && outline
      ? `Match the faint outline of your earlier photo, then tap the shutter. I’ll compare ${targetWhat ?? "its findings"}.`
      : `Stand where you took the earlier photo. I’ll compare ${targetWhat ?? "its findings"}.`
    : busy
      ? `${scanActivity(busy).title}. You can keep scanning; photos are queued.`
      : "Point at an entrance, walkway or room. I look for steps, blocked paths and things sticking out.";

  return (
    <div data-theme="dark" className="relative h-full bg-black text-fg">
      <input ref={takeInput} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} onChange={onPicked} />
      <input ref={pickInput} type="file" accept="image/*,.heic,.heif" className="sr-only" tabIndex={-1} onChange={onPicked} />

      <div className="absolute inset-1.5 overflow-hidden rounded-[44px] bg-[#0b0b0c] sm:rounded-[42px]">
        {/* Space for the capture frame: below Lumi's capsule, above the controls. */}
        <div
          ref={area}
          className="absolute inset-x-2 top-[calc(var(--safe-top)+124px)] bottom-[calc(var(--safe-bottom)+148px)]"
        >
          <div
            className="absolute overflow-hidden rounded-[26px] bg-black ring-1 ring-white/25 transition-[width,height,left,top] duration-300"
            style={{
              ...(frame ? { left: frame.left, top: frame.top, width: frame.width, height: frame.height } : { inset: 0, opacity: 0 }),
              // Morphs into the photo on the findings screen (see globals.css).
              viewTransitionName: "scan-photo",
            }}
          >
            <video
              ref={video}
              playsInline
              muted
              aria-label="Camera viewfinder. The full frame shown is what will be analyzed."
              className={`absolute inset-0 size-full object-contain transition-opacity duration-500 ${live ? "opacity-100" : "opacity-0"}`}
            />
            {ghost && (
              // eslint-disable-next-line @next/next/no-img-element -- local blob URL
              <img
                src={ghost.url}
                alt=""
                aria-hidden
                onLoad={(e) => setGhostSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                className={`pointer-events-none absolute inset-0 size-full object-contain ${live ? "opacity-35 mix-blend-screen" : "opacity-70"}`}
              />
            )}
            {!live && (
              <div className="absolute inset-x-6 top-1/2 -translate-y-1/2 text-center text-[15px] leading-snug text-white/85 [text-shadow:0_1px_8px_rgba(0,0,0,0.8)]">
                {cam === "starting" && <p>Starting camera…</p>}
                {cam === "denied" && <p>Camera access is off. You can still take or choose a photo below.</p>}
                {cam === "unavailable" && !ghost && <p>{target ? "Take the photo from where the earlier one was taken." : "Take a photo with your camera, or choose one from your library."}</p>}
              </div>
            )}
            {flash > 0 && <div key={flash} aria-hidden className="animate-flash pointer-events-none absolute inset-0 bg-white" />}
            <IridescentEdge active={Boolean(busy)} ring={2} bloom={14} speed={5} />
          </div>
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[calc(var(--safe-top)+124px)] bg-[linear-gradient(to_bottom,rgba(0,0,0,0.55),transparent)]" />
      </div>

      {/* Lumi guidance */}
      <div className="absolute inset-x-0 top-[calc(var(--safe-top)+58px)] z-10 flex justify-center px-4">
        <SidekickCapsule mood={mood} title={title} detail={detail} />
      </div>

      {/* Controls */}
      <div className="absolute inset-x-0 bottom-[calc(var(--safe-bottom)+12px)] z-10 px-4">
        <div className="mt-2 flex items-start justify-center gap-8">
          <ControlButton label="Library" onClick={() => pickInput.current?.click()} ariaLabel="Choose a photo from your library">
            <Photos size={21} />
          </ControlButton>
          <button
            type="button"
            onClick={live ? captureFrame : () => takeInput.current?.click()}
            aria-label={live ? "Take photo and scan" : "Open camera to take a photo"}
            className="pressable relative grid size-[76px] place-items-center rounded-full border-[3px] border-white/90"
          >
            <IridescentEdge active={Boolean(busy)} ring={3} bloom={12} speed={2.4} />
            {live ? <span className="block size-[60px] rounded-full bg-white" /> : <Camera size={30} className="text-white" />}
          </button>
          {target ? (
            <ControlButton
              label="Outline"
              onClick={() => setOutline((v) => !v)}
              ariaLabel={outline ? `Hide the outline of the earlier photo (still re-checking Area ${target.area})` : "Show the outline of the earlier photo"}
              active={outline}
            >
              <Layers size={21} />
            </ControlButton>
          ) : (
            <span className="w-12" aria-hidden />
          )}
        </div>
        <p className="mt-2 text-center text-[13px] font-medium text-white/85" aria-hidden>
          {target ? `Re-checking Area ${target.area} · ${live ? "tap to capture" : "take or choose a photo"}` : live ? "Tap to scan a new area" : "Take or choose a photo"}
        </p>
      </div>
    </div>
  );
}

/** Side control in the capture bar: same shape and glass for Library and Line up. */
function ControlButton({
  label,
  ariaLabel,
  onClick,
  children,
  active = false,
  expanded,
  badge = false,
}: {
  label: string;
  ariaLabel: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
  expanded?: boolean;
  badge?: boolean;
}) {
  return (
    <div className="flex w-14 flex-col items-center gap-1">
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        aria-expanded={expanded}
        className={`pressable relative grid size-12 place-items-center rounded-full border backdrop-blur-xl ${active ? "border-white bg-white text-black" : "border-white/20 bg-white/10 text-white"}`}
      >
        {children}
        {badge && <span aria-hidden className="absolute top-0.5 right-0.5 size-2.5 rounded-full border-2 border-black bg-white" />}
      </button>
      <span aria-hidden className="text-[11px] font-medium text-white/75">
        {label}
      </span>
    </div>
  );
}
