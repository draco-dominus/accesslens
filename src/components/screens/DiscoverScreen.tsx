"use client";

import { useEffect, useRef, useState } from "react";
import { retryKey, type useWalkthrough } from "@/hooks/useWalkthrough";
import { findingsForScan, findingCaptionForScan, lineUpSuggestion, lumiMessagesForScan, scanActivity, scanMood, STATUS_LABEL } from "@/lib/session/lumi";
import { isOpen, type Scan, type TrackedFinding } from "@/lib/session/types";
import { comparisonPhotos } from "../discover/FindingParts";
import { PhotoStage } from "../discover/PhotoStage";
import { StageChecklist, TimingBreakdown, useTicker } from "../lumi/ScanProgress";
import { Sidekick, type LumiMood } from "../lumi/Sidekick";
import { TrustSheet } from "../trust/TrustPanel";
import { ChevronDown, ChevronRight, Compare, Info, Layers, Rescan } from "../ui/Icons";
import { BarrierIcon, NeedMarks } from "../ui/Needs";
import { activeMood, Button } from "../ui/primitives";
import { Sheet, type Detent } from "../ui/Sheet";
import { AiBadge, StatusIcon, StatusTag } from "../ui/Tags";
import type { Theme } from "../app/AccessLensApp";

type Walkthrough = ReturnType<typeof useWalkthrough>;

/** Sheet detents: the photo always keeps the space above the sheet. */
const HEIGHTS: Record<Detent, string> = {
  peek: "max(30%, 210px)",
  half: "52%",
  full: "calc(100% - var(--safe-top) - 62px)",
};

/**
 * Inspect: the scanned photo is the centerpiece. Findings are numbered references on the photo and
 * concise one-line rows below; tapping a finding opens its own Finding Details screen. After a re-check,
 * a Before & after entry leads straight to the comparison. No boxes or markers are drawn on the photo:
 * the backend returns no coordinates.
 */
export function DiscoverScreen({
  wt,
  scan,
  fresh,
  theme,
  selectedFindingId,
  focusOnArrival = false,
  onSelectFinding,
  onOpenFinding,
  onOpenScan,
  onScanAgain,
  onRecheck,
  onOpenWalkthrough,
}: {
  wt: Walkthrough;
  scan: Scan;
  fresh: boolean;
  theme: Theme;
  selectedFindingId: string | null;
  /** Arrived via "Show in photo": give the photo the room. */
  focusOnArrival?: boolean;
  onSelectFinding: (id: string | null) => void;
  /** Open Finding Details (optionally at a section, e.g. the before/after comparison). */
  onOpenFinding: (findingId: string, section?: "compare") => void;
  onOpenScan: (scanId: string, findingId?: string) => void;
  onScanAgain: () => void;
  /** Open the camera lined up with an earlier scan, to re-check its findings from the same spot. */
  onRecheck: (scanId: string) => void;
  onOpenWalkthrough: () => void;
}) {
  const session = wt.session!;
  const processing = scan.step !== "done" && scan.step !== "error";
  const media = wt.media[scan.id];
  const photo = media?.imageUrl ?? media?.thumbUrl;
  const messages = scan.step === "done" ? lumiMessagesForScan(session, scan.id) : [];
  const items = findingsForScan(session, scan.id);
  const otherOpen = session.findings.filter((f) => isOpen(f.status) && !items.some((i) => i.finding.id === f.id));
  const checking = wt.checking[scan.id];
  const manualOptions = scan.step === "done" && !checking && wt.hasImage(scan.id) ? wt.manualRevisitOptions(scan.id).filter((o) => !scan.pendingRevisit.includes(o.id)) : [];
  const nudge = lineUpSuggestion(session, scan.id);
  // Findings compared in THIS scan: their before/after is the headline result of a re-check.
  const compared = items
    .map((i) => ({ finding: i.finding, event: i.finding.history.filter((h) => h.scanId === scan.id).at(-1) }))
    .filter((x): x is { finding: TrackedFinding; event: NonNullable<typeof x.event> } => Boolean(x.event?.comparison));

  const [detent, setDetent] = useState<Detent>(() => (focusOnArrival ? "peek" : selectedFindingId || (!processing && items.length) ? "half" : "peek"));
  const [trustOpen, setTrustOpen] = useState(false);
  const tick = useTicker(processing, 1000);
  // Developer timing breakdown: open the app with ?timing=1 (this screen only renders client-side).
  const [showTiming] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("timing"));

  // Raise the sheet when results arrive for a fresh scan.
  const doneNow = scan.step === "done";
  const prevDone = useRef(doneNow);
  useEffect(() => {
    if (fresh && doneNow && !prevDone.current) setDetent(items.length ? "half" : "peek");
    prevDone.current = doneNow;
  }, [doneNow, fresh, items.length]);

  /** Select a reference on the photo: the photo gets the room, the caption explains it. */
  const selectFromPhoto = (id: string | null) => {
    onSelectFinding(id);
    if (id) setDetent("peek");
  };

  const mood: LumiMood = checking || processing ? "thinking" : scanMood(scan);
  const selected = items.find((i) => i.finding.id === selectedFindingId)?.finding;
  const activity = scanActivity(scan);
  const newCount = items.filter((i) => i.role === "new").length;
  const updatedCount = items.length - newCount;
  const headline = checking
    ? "Re-checking the earlier finding…"
    : processing
      ? `${activity.title}…`
      : scan.step === "error"
        ? "I couldn’t finish this scan."
        : (messages[0] ?? "Done.");

  const header = (
    <div className="px-5 pb-3" aria-live="polite">
      <div className="flex items-start gap-3">
        <Sidekick mood={mood} size={44} halo={activeMood(mood)} />
        <div className="min-w-0 flex-1 pt-0.5">
          <p className={`line-clamp-2 text-[16px] leading-snug font-semibold tracking-[-0.015em] ${processing || checking ? "text-thinking" : ""}`}>{headline}</p>
          {processing ? (
            <p className="mt-0.5 text-[13px] text-muted tabular-nums">
              {activity.detail ? `${activity.detail} · ` : ""}
              {Math.max(0, Math.round((tick - scan.createdAt) / 1000))}s · you can keep scanning
            </p>
          ) : scan.step === "done" && selected ? null : scan.step === "done" ? (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[13px] whitespace-nowrap text-muted">
                Scan {scan.number} · {newCount ? `${newCount} new` : "nothing new"}
                {updatedCount ? ` · ${updatedCount} re\u2011checked` : ""}
              </span>
              <AiBadge />
            </div>
          ) : null}
        </div>
      </div>
      {/* The selected reference, named here — below the photo, never on it. */}
      {selected && scan.step === "done" && (
        <div key={selected.id} className="animate-rise-in mt-3 flex items-center gap-2.5 rounded-[18px] bg-surface-2 py-1.5 pr-1.5 pl-2.5" aria-live="polite">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-[14px] font-bold text-on-primary">{selected.number}</span>
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{selected.details.title}</span>
          <button
            type="button"
            onClick={() => onOpenFinding(selected.id)}
            className="pressable flex min-h-10 shrink-0 items-center gap-0.5 rounded-full bg-primary px-3.5 text-[14px] font-semibold text-on-primary"
          >
            Details <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div data-theme="dark" className="relative h-full overflow-hidden bg-black text-fg">
      <PhotoStage
        photo={photo}
        alt={`Scan ${scan.number}${scan.analysis ? `: ${scan.analysis.sceneSummary}` : ""}`}
        emptyText={wt.photoRestore === "loading" ? "Restoring this photo from your device…" : wt.restored ? "This photo could not be restored. The finding notes are still available." : "Preparing photo…"}
        processing={processing || Boolean(checking)}
        findings={items.map((i) => i.finding)}
        selectedId={selectedFindingId}
        onSelect={selectFromPhoto}
        compact={detent === "full"}
        bottom={HEIGHTS[detent]}
      />

      <div data-theme={theme} className="pointer-events-none absolute inset-0 z-20 text-fg [&>*]:pointer-events-auto">
        <Sheet detent={detent} onDetentChange={setDetent} heights={HEIGHTS} label={`Scan ${scan.number} results`} header={header}>
          <div className="pb-10">
            <div className="px-5">
              {processing && <StageChecklist scan={scan} />}

              {scan.step === "error" && (
                <div className="pl-[56px]">
                  <p className="text-[14px] leading-snug text-muted">{scan.error}</p>
                  <StageChecklist scan={scan} />
                  {!wt.canRetry(scan.id) && <p className="mt-2 text-[13px] leading-snug text-muted">Trying again won’t help with this photo. Please take a new one.</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {wt.canRetry(scan.id) && (
                      <Button size="md" onClick={() => wt.retryScan(scan.id)} icon={<Rescan size={17} />}>
                        Try again
                      </Button>
                    )}
                    <Button size="md" variant="secondary" onClick={onScanAgain}>
                      Scan again
                    </Button>
                  </div>
                </div>
              )}

            </div>

            {/* Re-check result first: the before/after is one tap away. */}
            {scan.step === "done" &&
              compared.map(({ finding, event }) => (
                <BeforeAfterEntry key={finding.id} wt={wt} finding={finding} event={event} onOpen={() => onOpenFinding(finding.id, "compare")} />
              ))}

            {items.length > 0 && (
              <ul className="mt-3 space-y-2 px-4" aria-label="Findings in this scan">
                {items.map(({ finding }) => (
                  <li key={finding.id}>
                    <FindingRow
                      finding={finding}
                      summary={findingCaptionForScan(session, scan.id, finding)?.label.replace(/^#\d+ · /, "") ?? finding.details.locationInImage}
                      selected={selectedFindingId === finding.id}
                      onOpen={() => onOpenFinding(finding.id)}
                    />
                  </li>
                ))}
              </ul>
            )}

            <div className="px-5">
              {scan.step === "done" && nudge && wt.hasImage(scan.id) && (
                <div className="mt-3 flex items-center gap-3 rounded-[20px] bg-surface-2 px-3.5 py-3">
                  <Layers size={20} className="shrink-0 text-muted" />
                  <p className="min-w-0 flex-1 text-[14px] leading-snug" title={nudge.text}>
                    Moved or fixed it? Re-check from this spot.
                  </p>
                  <button
                    type="button"
                    onClick={() => onRecheck(scan.id)}
                    className="pressable min-h-11 shrink-0 rounded-full bg-primary px-4 text-[14px] font-semibold text-on-primary"
                  >
                    Re-check
                  </button>
                </div>
              )}

              {scan.pendingRevisit.map((earlierId) => (
                <RevisitQuestion key={earlierId} wt={wt} scanId={scan.id} earlierId={earlierId} busy={Boolean(checking)} onOpenScan={onOpenScan} />
              ))}
            </div>

            {scan.step === "done" &&
              (scan.failedComparisons ?? []).map((f) => (
                <FailedComparisonCard key={`${f.findingId}|${f.referenceScanId}`} wt={wt} scanId={scan.id} findingId={f.findingId} referenceScanId={f.referenceScanId} />
              ))}

            {manualOptions.length > 0 && <ManualRevisit wt={wt} scanId={scan.id} options={manualOptions} />}

            {showTiming && <TimingBreakdown scan={scan} />}

            {scan.step === "done" && otherOpen.length > 0 && (
              <button
                type="button"
                onClick={onOpenWalkthrough}
                className="pressable mx-4 mt-3 flex min-h-14 w-[calc(100%-2rem)] items-center gap-3 rounded-[20px] bg-surface px-4 text-left shadow-[var(--shadow-soft)]"
              >
                <span className="min-w-0 flex-1 text-[15px] leading-snug">
                  <span className="font-semibold">
                    {otherOpen.length} {otherOpen.length === 1 ? "concern" : "concerns"} still open
                  </span>
                  <span className="text-muted"> from earlier scans</span>
                </span>
                <ChevronRight size={18} className="shrink-0 text-muted" />
              </button>
            )}

            {scan.step === "done" && (
              <div className="mt-5 px-4">
                <Button onClick={onScanAgain} icon={<Rescan size={19} />} className="w-full">
                  Scan again
                </Button>
              </div>
            )}

            <div className="px-7 pt-5 text-center">
              {scan.analysis && !scan.analysis.imageUsable && <p className="text-[13px] leading-relaxed text-muted">{scan.analysis.limitations}</p>}
              {wt.photoStorageWarning && <p className="mb-2 rounded-2xl bg-surface-2 px-3 py-2 text-[12px] leading-snug text-muted">{wt.photoStorageWarning}</p>}
              <button
                type="button"
                onClick={() => setTrustOpen(true)}
                className="pressable mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-muted underline-offset-2 hover:underline"
              >
                <Info size={15} /> About these results
              </button>
            </div>
          </div>
        </Sheet>
      </div>

      <div data-theme={theme}>
        <TrustSheet open={trustOpen} onClose={() => setTrustOpen(false)} />
      </div>
    </div>
  );
}

/** One line per finding: number, title, need icons, status icon. Tap → Finding Details. */
function FindingRow({ finding, summary, selected, onOpen }: { finding: TrackedFinding; summary: string; selected: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Finding ${finding.number}: ${finding.details.title}. ${STATUS_LABEL[finding.status]}. ${summary}. Open details`}
      className={`pressable flex min-h-14 w-full items-center gap-3 rounded-[20px] bg-surface px-3 text-left shadow-[var(--shadow-soft)] ${selected ? "ring-2 ring-fg" : ""}`}
    >
      <span className={`grid size-8 shrink-0 place-items-center rounded-full text-[14px] font-bold ${selected ? "bg-primary text-on-primary" : "bg-surface-2"}`}>{finding.number}</span>
      <BarrierIcon type={finding.details.barrierType} size={17} className="shrink-0 text-muted" />
      <span className="min-w-0 flex-1 truncate text-[16px] font-semibold tracking-[-0.01em]">{finding.details.title}</span>
      <NeedMarks who={finding.details.whoMayBeAffected} />
      <StatusIcon status={finding.status} />
      <ChevronRight size={17} className="shrink-0 text-muted" />
    </button>
  );
}

/** The re-check result, surfaced first: two thumbnails and the status, opening the comparison. */
function BeforeAfterEntry({ wt, finding, event, onOpen }: { wt: Walkthrough; finding: TrackedFinding; event: NonNullable<TrackedFinding["history"][number]>; onOpen: () => void }) {
  const { beforeScan, nowScan, beforeUrl, nowUrl } = comparisonPhotos(wt, finding, event);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="pressable animate-rise-in mx-4 mt-3 flex w-[calc(100%-2rem)] items-center gap-3 rounded-[22px] bg-surface p-3 text-left shadow-[var(--shadow-float)]"
    >
      <span className="relative flex shrink-0" aria-hidden>
        {[beforeUrl, nowUrl].map((u, i) => (
          <span key={i} className={`block size-14 overflow-hidden rounded-[14px] bg-surface-2 ring-2 ring-surface ${i ? "-ml-4" : ""}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
            {u && <img src={u} alt="" className="size-full object-cover" />}
          </span>
        ))}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-muted">
          <Compare size={15} /> Before & after · scan {beforeScan?.number ?? "?"} → {nowScan?.number ?? "?"}
        </span>
        <span className="mt-0.5 block truncate text-[16px] font-semibold">#{finding.number} {finding.details.title}</span>
        <span className="mt-1 block">
          <StatusTag status={event.status} />
        </span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-muted" />
    </button>
  );
}

/** A comparison that failed: retry just that comparison with the photos already prepared. */
function FailedComparisonCard({ wt, scanId, findingId, referenceScanId }: { wt: Walkthrough; scanId: string; findingId: string; referenceScanId: string }) {
  const session = wt.session!;
  const finding = session.findings.find((f) => f.id === findingId);
  const earlier = session.scans.find((s) => s.id === referenceScanId);
  if (!finding || !earlier) return null;
  const state = wt.comparisonRetries[retryKey(scanId, findingId, referenceScanId)];
  const photosAvailable = wt.hasImage(scanId) && wt.hasImage(referenceScanId);
  return (
    <div className="mx-4 mt-3 rounded-[20px] bg-surface px-4 py-3 shadow-[var(--shadow-soft)]" role="group" aria-label={`Comparison for finding ${finding.number} didn't finish`}>
      <p className="text-[15px] leading-snug">
        <span className="font-semibold">I couldn’t re-check #{finding.number} {finding.details.title}</span>
        <span className="text-muted"> against scan {earlier.number}. Its status hasn’t changed.</span>
      </p>
      <div aria-live="polite">{state?.error && <p className="mt-1 text-[13px] leading-snug text-muted">Still didn’t work: {state.error}</p>}</div>
      {photosAvailable ? (
        <Button size="md" className="mt-2" disabled={state?.busy} onClick={() => wt.retryComparison(scanId, findingId, referenceScanId)} icon={<Rescan size={17} />}>
          {state?.busy ? "Comparing…" : "Try comparison again"}
        </Button>
      ) : (
        <p className="mt-1 text-[13px] leading-snug text-muted">The photos are no longer available. Re-check the spot with Line up instead.</p>
      )}
    </div>
  );
}

function RevisitQuestion({ wt, scanId, earlierId, busy, onOpenScan }: { wt: Walkthrough; scanId: string; earlierId: string; busy: boolean; onOpenScan: (id: string) => void }) {
  const earlier = wt.session!.scans.find((s) => s.id === earlierId);
  if (!earlier) return null;
  const thumb = wt.media[earlierId]?.thumbUrl ?? wt.media[earlierId]?.imageUrl;
  return (
    <div className="mt-3 rounded-[22px] bg-surface p-3.5 shadow-[var(--shadow-soft)]" role="group" aria-label={`Is this the same area as scan ${earlier.number}?`}>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => onOpenScan(earlierId)} className="size-14 shrink-0 overflow-hidden rounded-[14px] bg-surface-2" aria-label={`View scan ${earlier.number}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
          {thumb && <img src={thumb} alt="" className="size-full object-cover" />}
        </button>
        <p className="min-w-0 flex-1 text-[15px] leading-snug font-semibold">Is this the same spot as scan {earlier.number}?</p>
      </div>
      <p className="mt-2 text-[13px] leading-snug text-muted">If yes, I’ll compare the two photos for the open concerns there. I’ll only mark something improved if the photos clearly show it.</p>
      <div className="mt-3 flex gap-2">
        <Button size="md" disabled={busy} onClick={() => wt.confirmRevisit(scanId, earlierId)} className="flex-1">
          Yes, same spot
        </Button>
        <Button size="md" variant="secondary" disabled={busy} onClick={() => wt.declineRevisit(scanId, earlierId)} className="flex-1">
          No, different
        </Button>
      </div>
    </div>
  );
}

function ManualRevisit({ wt, scanId, options }: { wt: Walkthrough; scanId: string; options: Scan[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mx-4 mt-3 rounded-[20px] bg-surface shadow-[var(--shadow-soft)]">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-h-14 w-full items-center gap-3 px-4 text-left">
        <span className="min-w-0 flex-1 text-[15px] leading-snug font-semibold">Re-checking an earlier spot?</span>
        <ChevronDown size={18} className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-line px-4 pt-2 pb-3">
          <p className="mb-2 text-[13px] leading-snug text-muted">Pick the scan this photo revisits and I’ll compare its open concerns.</p>
          <div className="flex flex-wrap gap-2">
            {options.map((o) => {
              const thumb = wt.media[o.id]?.thumbUrl ?? wt.media[o.id]?.imageUrl;
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => wt.confirmRevisit(scanId, o.id)}
                  className="pressable flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface-2 py-1 pr-4 pl-1 text-[14px] font-semibold"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
                  {thumb && <img src={thumb} alt="" className="size-9 rounded-full object-cover" />}
                  Scan {o.number}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
