"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { useWalkthrough } from "@/hooks/useWalkthrough";
import { openFindingsLastSeenIn } from "@/lib/session/engine";
import { isOpen } from "@/lib/session/types";
import type { LumiMood } from "../lumi/Sidekick";
import { Camera, Layers, Photos } from "../ui/Icons";
import { IridescentEdge, SidekickCapsule } from "../ui/primitives";

type Walkthrough = ReturnType<typeof useWalkthrough>;
type CamState = "starting" | "live" | "unavailable" | "denied";

const cameraSupported = () =>
  typeof window !== "undefined" && window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia);

/**
 * Camera-first scan (adapted from the prototype's Scan screen, with a real camera instead of demo views).
 * Live viewfinder when the browser allows it (HTTPS or localhost); otherwise the native camera / photo
 * picker. Every photo goes through the real pipeline (HEIC conversion → analyze → match → compare).
 */
export function ScanScreen({ wt, onCapture }: { wt: Walkthrough; onCapture: (file: File) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const takeInput = useRef<HTMLInputElement>(null);
  const pickInput = useRef<HTMLInputElement>(null);
  const [cam, setCam] = useState<CamState>(() => (cameraSupported() ? "starting" : "unavailable"));
  const [flash, setFlash] = useState(0);
  const [ghostScanId, setGhostScanId] = useState<string | null>(null);

  const session = wt.session;
  const busy = session?.scans.find((s) => s.step !== "done" && s.step !== "error");
  const openCount = session?.findings.filter((f) => isOpen(f.status)).length ?? 0;

  // Earlier photos the user can line up with to re-check an open concern from the same spot.
  const ghostOptions = useMemo(
    () =>
      (session?.scans ?? [])
        .filter((sc) => sc.step === "done" && openFindingsLastSeenIn(session!, sc.id).length > 0)
        .map((sc) => ({ scan: sc, url: wt.media[sc.id]?.imageUrl ?? wt.media[sc.id]?.thumbUrl }))
        .filter((o): o is { scan: typeof o.scan; url: string } => Boolean(o.url))
        .reverse(),
    [session, wt.media],
  );
  const ghost = ghostOptions.find((o) => o.scan.id === ghostScanId);

  useEffect(() => {
    if (!cameraSupported()) return;
    let stream: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1440 } }, audio: false })
      .then(async (s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          await video.current.play().catch(() => {});
        }
        setCam("live");
      })
      .catch((err: DOMException) => setCam(err?.name === "NotAllowedError" ? "denied" : "unavailable"));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const captureFrame = () => {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d")!.drawImage(v, 0, 0);
    setFlash((n) => n + 1);
    canvas.toBlob(
      (blob) => blob && onCapture(new File([blob], `scan-${Date.now()}.jpg`, { type: "image/jpeg" })),
      "image/jpeg",
      0.92,
    );
  };

  const onPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) onCapture(file);
  };

  const live = cam === "live";
  const mood: LumiMood = ghost ? "ready" : busy ? "thinking" : "ready";
  const title = ghost
    ? `Line up with scan ${ghost.scan.number}`
    : busy
      ? `Still looking at scan ${busy.number}`
      : session?.scans.length
        ? "Scan anywhere you like"
        : "Let’s look at this space";
  const detail = ghost
    ? "Stand where you took that photo and match the outline, so I can compare fairly."
    : busy
      ? "You can keep scanning. I’ll get to this one next."
      : openCount
        ? `${openCount} ${openCount === 1 ? "concern is" : "concerns are"} still open. To re-check one, take the photo from the same spot.`
        : "Point at an entrance, walkway or room. I look for steps, blocked paths and things sticking out.";

  return (
    <div data-theme="dark" className="relative h-full bg-black text-fg">
      <input ref={takeInput} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} onChange={onPicked} />
      <input ref={pickInput} type="file" accept="image/*,.heic,.heif" className="sr-only" tabIndex={-1} onChange={onPicked} />

      {/* Viewport */}
      <div className="absolute inset-1.5 overflow-hidden rounded-[44px] bg-[#0b0b0c] sm:rounded-[42px]">
        <video
          ref={video}
          playsInline
          muted
          aria-label="Camera viewfinder"
          className={`absolute inset-0 size-full object-cover transition-opacity duration-500 ${live ? "opacity-100" : "opacity-0"}`}
        />
        {ghost && (
          // eslint-disable-next-line @next/next/no-img-element -- local blob URL
          <img src={ghost.url} alt="" aria-hidden className="pointer-events-none absolute inset-0 size-full object-cover opacity-35 mix-blend-screen" />
        )}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.55),transparent_24%,transparent_55%,rgba(0,0,0,0.8))]" />

        {!live && (
          <div className="absolute inset-x-8 top-[38%] text-center text-[15px] leading-snug text-white/80">
            {cam === "starting" && <p>Starting camera…</p>}
            {cam === "denied" && <p>Camera access is off. You can still take or choose a photo below.</p>}
            {cam === "unavailable" && <p>Take a photo with your camera, or choose one from your library.</p>}
          </div>
        )}

        {live && (
          <div aria-hidden className="pointer-events-none absolute inset-x-[12%] top-[26%] bottom-[30%]">
            {[
              "top-0 left-0 border-t-2 border-l-2 rounded-tl-[22px]",
              "top-0 right-0 border-t-2 border-r-2 rounded-tr-[22px]",
              "bottom-0 left-0 border-b-2 border-l-2 rounded-bl-[22px]",
              "right-0 bottom-0 border-r-2 border-b-2 rounded-br-[22px]",
            ].map((c) => (
              <span key={c} className={`absolute size-9 border-white/85 ${c}`} />
            ))}
          </div>
        )}
        {flash > 0 && <div key={flash} aria-hidden className="animate-flash pointer-events-none absolute inset-0 bg-white" />}
        <IridescentEdge active={Boolean(busy)} ring={2.5} bloom={22} speed={5} />
      </div>

      {/* Lumi guidance */}
      <div className="absolute inset-x-0 top-[calc(var(--safe-top)+58px)] z-10 flex justify-center px-4">
        <SidekickCapsule mood={mood} title={title} detail={detail} />
      </div>

      {/* Controls */}
      <div className="absolute inset-x-0 bottom-[calc(var(--safe-bottom)+12px)] z-10 px-4">
        {ghostOptions.length > 0 && (
          <div className="mx-auto mb-3 w-fit max-w-full">
            <div
              role="radiogroup"
              aria-label="Line up with an earlier photo"
              className="no-scrollbar flex items-center gap-1 overflow-x-auto rounded-full border border-white/15 bg-black/45 p-1 backdrop-blur-xl"
            >
              <span className="flex shrink-0 items-center gap-1 pr-1 pl-2.5 text-[11px] font-semibold tracking-[0.06em] text-white/75 uppercase">
                <Layers size={14} /> Line up
              </span>
              {ghostOptions.map(({ scan, url }) => {
                const on = scan.id === ghostScanId;
                return (
                  <button
                    key={scan.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={`Show scan ${scan.number} as a guide`}
                    onClick={() => setGhostScanId(on ? null : scan.id)}
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
          {live ? "Tap to scan" : "Take or choose a photo"}
        </p>
      </div>
    </div>
  );
}
