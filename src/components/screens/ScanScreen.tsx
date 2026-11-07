"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { useWalkthrough } from "@/hooks/useWalkthrough";
import { fitContain, type Size } from "@/lib/fit";
import { openFindingsLastSeenIn } from "@/lib/session/engine";
import { isOpen } from "@/lib/session/types";
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
 * a selected Line-up photo is shown as a reference instead of an overlay.
 */
export function ScanScreen({
  wt,
  onCapture,
  initialLineUpScanId,
}: {
  wt: Walkthrough;
  onCapture: (file: File, lineUpScanId?: string) => void;
  /** Pre-select an earlier scan to line up with (e.g. from "Re-check this spot"). */
  initialLineUpScanId?: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const takeInput = useRef<HTMLInputElement>(null);
  const pickInput = useRef<HTMLInputElement>(null);
  const [cam, setCam] = useState<CamState>(() => (cameraSupported() ? "starting" : "unavailable"));
  const [flash, setFlash] = useState(0);
  const [ghostScanId, setGhostScanId] = useState<string | null>(initialLineUpScanId ?? null);
  const [areaSize, setAreaSize] = useState<Size | null>(null);
  const [videoSize, setVideoSize] = useState<Size | null>(null);
  const [ghostSize, setGhostSize] = useState<Size | null>(null);

  const session = wt.session;
  const busy = session?.scans.find((s) => s.step !== "done" && s.step !== "error");
  const openCount = session?.findings.filter((f) => isOpen(f.status)).length ?? 0;

  // Earlier photos the user can line up with to re-check an open concern from the same spot.
  const ghostOptions = useMemo(
    () =>
      (session?.scans ?? [])
        .filter((sc) => sc.step === "done" && openFindingsLastSeenIn(session!, sc.id).length > 0)
        .map((sc) => ({
          scan: sc,
          url: wt.media[sc.id]?.imageUrl ?? wt.media[sc.id]?.thumbUrl,
          findings: openFindingsLastSeenIn(session!, sc.id),
        }))
        .filter((o): o is typeof o & { url: string } => Boolean(o.url))
        .reverse(),
    [session, wt.media],
  );
  const ghost = ghostOptions.find((o) => o.scan.id === ghostScanId);

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
      (blob) => blob && onCapture(new File([blob], `scan-${Date.now()}.jpg`, { type: "image/jpeg" }), ghost?.scan.id),
      "image/jpeg",
      0.92,
    );
  };

  const onPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) onCapture(file, ghost?.scan.id);
  };

  const ghostWhat = ghost?.findings[0]?.details.title.toLowerCase();
  const mood: LumiMood = ghost ? "ready" : busy ? "thinking" : "ready";
  const title = ghost
    ? `Line up with scan ${ghost.scan.number}`
    : busy
      ? `Still looking at scan ${busy.number}`
      : session?.scans.length
        ? "Scan anywhere you like"
        : "Let’s look at this space";
  const detail = ghost
    ? live
      ? `Match the faint outline, then tap the shutter. I’ll re-check ${ghostWhat ?? "its findings"} directly.`
      : `Take your photo from where this one was taken. I’ll re-check ${ghostWhat ?? "its findings"} directly.`
    : busy
      ? "You can keep scanning. I’ll get to this one next."
      : ghostOptions.length
        ? `${openCount} ${openCount === 1 ? "concern is" : "concerns are"} still open. Re-checking one? Tap its photo under “Line up”.`
        : "Point at an entrance, walkway or room. I look for steps, blocked paths and things sticking out.";

  return (
    <div data-theme="dark" className="relative h-full bg-black text-fg">
      <input ref={takeInput} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} onChange={onPicked} />
      <input ref={pickInput} type="file" accept="image/*,.heic,.heif" className="sr-only" tabIndex={-1} onChange={onPicked} />

      <div className="absolute inset-1.5 overflow-hidden rounded-[44px] bg-[#0b0b0c] sm:rounded-[42px]">
        {/* Space for the capture frame: below Lumi's capsule, above the controls. */}
        <div
          ref={area}
          className={`absolute inset-x-2 top-[calc(var(--safe-top)+124px)] ${ghostOptions.length ? "bottom-[calc(var(--safe-bottom)+188px)]" : "bottom-[calc(var(--safe-bottom)+132px)]"}`}
        >
          <div
            className="absolute overflow-hidden rounded-[26px] bg-black ring-1 ring-white/25 transition-[width,height,left,top] duration-300"
            style={frame ? { left: frame.left, top: frame.top, width: frame.width, height: frame.height } : { inset: 0, opacity: 0 }}
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
                {cam === "unavailable" && !ghost && <p>Take a photo with your camera, or choose one from your library.</p>}
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
        {ghostOptions.length > 0 && (
          <div className="relative mx-auto mb-3 w-fit max-w-full rounded-full">
            {/* A gentle glow while Line up is useful and unused, so it's noticed; it never blocks scanning. */}
            {!ghost && <IridescentEdge active ring={1.5} bloom={10} speed={4} />}
            <div
              role="radiogroup"
              aria-label="Line up with an earlier photo to re-check its findings"
              className="no-scrollbar relative flex items-center gap-1 overflow-x-auto rounded-full border border-white/15 bg-black/55 p-1 backdrop-blur-xl"
            >
              <span className="flex shrink-0 items-center gap-1 pr-1 pl-2.5 text-[11px] font-semibold tracking-[0.06em] text-white/80 uppercase">
                <Layers size={14} /> Line up
              </span>
              {ghostOptions.map(({ scan, url, findings }) => {
                const on = scan.id === ghostScanId;
                return (
                  <button
                    key={scan.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={`Line up with scan ${scan.number} to re-check ${findings.map((f) => f.details.title).join(", ")}`}
                    onClick={() => {
                      setGhostSize(null);
                      setGhostScanId(on ? null : scan.id);
                    }}
                    className={`pressable flex min-h-11 shrink-0 items-center gap-1.5 rounded-full py-1 pr-3 pl-1 text-[14px] font-semibold ${on ? "bg-white text-black" : "text-white"}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
                    <img src={url} alt="" className="size-9 rounded-full object-cover" />
                    {scan.number}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-2 flex items-center justify-center gap-8">
          <button
            type="button"
            onClick={() => pickInput.current?.click()}
            aria-label="Choose a photo from your library"
            className="pressable grid size-12 place-items-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur-xl"
          >
            <Photos size={21} />
          </button>
          <button
            type="button"
            onClick={live ? captureFrame : () => takeInput.current?.click()}
            aria-label={live ? "Take photo and scan" : "Open camera to take a photo"}
            className="pressable relative grid size-[76px] place-items-center rounded-full border-[3px] border-white/90"
          >
            <IridescentEdge active={Boolean(busy)} ring={3} bloom={12} speed={2.4} />
            {live ? <span className="block size-[60px] rounded-full bg-white" /> : <Camera size={30} className="text-white" />}
          </button>
          <span className="size-12" aria-hidden />
        </div>
        <p className="mt-2 text-center text-[13px] font-medium text-white/85" aria-hidden>
          {live ? (ghost ? `Lined up with scan ${ghost.scan.number} · tap to scan` : "Tap to scan") : "Take or choose a photo"}
        </p>
      </div>
    </div>
  );
}
