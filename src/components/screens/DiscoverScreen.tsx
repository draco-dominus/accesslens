"use client";

import { useEffect, useRef, useState } from "react";
import { retryKey, type useWalkthrough } from "@/hooks/useWalkthrough";
import { findingsForScan, lineUpSuggestion, lumiMessagesForScan, scanActivity, scanMood } from "@/lib/session/lumi";
import { isOpen, type Scan } from "@/lib/session/types";
import { FindingCard } from "../discover/FindingCard";
import { PhotoStage } from "../discover/PhotoStage";
import { StageChecklist, TimingBreakdown, useTicker } from "../lumi/ScanProgress";
import { Sidekick, type LumiMood } from "../lumi/Sidekick";
import { TrustSheet } from "../trust/TrustPanel";
import { ChevronDown, ChevronRight, Info, Layers, Rescan } from "../ui/Icons";
import { activeMood, Button } from "../ui/primitives";
import { Sheet, type Detent } from "../ui/Sheet";
import { AiBadge } from "../ui/Tags";
import type { Theme } from "../app/AccessLensApp";

type Walkthrough = ReturnType<typeof useWalkthrough>;

/** Sheet detents: the photo always keeps the space above the sheet. */
const HEIGHTS: Record<Detent, string> = {
  peek: "max(30%, 210px)",
  half: "56%",
  full: "calc(100% - var(--safe-top) - 62px)",
};

/**
 * Discover: the scanned photo is the centerpiece; Lumi and the findings live in a three-detent sheet.
 * Findings connect to the photo through the rail of chips on the photo and "Show in photo" — never via
 * invented boxes or markers (the backend returns no coordinates).
 */
export function DiscoverScreen({
  wt,
  scan,
  fresh,
  theme,
  selectedFindingId,
  initialAskId,
  onSelectFinding,
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
  /** Open Ask Lumi for this finding on arrival. */
  initialAskId?: string | null;
  onSelectFinding: (id: string | null) => void;
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

  const [detent, setDetent] = useState<Detent>(() => (initialAskId ? "full" : selectedFindingId || (!processing && items.length) ? "half" : "peek"));
  const [askingId, setAskingId] = useState<string | null>(initialAskId ?? null);
  const [trustOpen, setTrustOpen] = useState(false);
  const tick = useTicker(processing, 1000);
  // Developer timing breakdown: open the app with ?timing=1 (this screen only renders client-side).
  const [showTiming] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("timing"));
  const cardRefs = useRef<Record<string, HTMLLIElement | null>>({});

  // Raise the sheet when results arrive for a fresh scan.
  const doneNow = scan.step === "done";
  const prevDone = useRef(doneNow);
  useEffect(() => {
    if (fresh && doneNow && !prevDone.current) setDetent(items.length ? "half" : "peek");
    prevDone.current = doneNow;
  }, [doneNow, fresh, items.length]);

  const sheetContent = useRef<HTMLDivElement | null>(null);
  /**
   * Scroll a card to the top of the SHEET only. (scrollIntoView would also scroll every ancestor,
   * including the overflow-hidden device frame, shifting the whole app.)
   */
  const scrollToCard = (id: string) =>
    window.setTimeout(() => {
      const box = sheetContent.current, card = cardRefs.current[id];
      if (!box || !card) return;
      const top = card.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 12;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      box.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
    }, 380);
  useEffect(() => {
    if (selectedFindingId) scrollToCard(selectedFindingId);
  }, [selectedFindingId]);

  /** Select from the photo rail: open the card, keep the photo visible. */
  const selectFromPhoto = (id: string | null) => {
    onSelectFinding(id);
    if (id) setDetent((d) => (d === "full" ? "half" : d === "peek" ? "half" : d));
  };
  const toggleCard = (id: string) => onSelectFinding(selectedFindingId === id ? null : id);
  const showInPhoto = (id: string) => {
    onSelectFinding(id);
    setDetent("peek");
  };
  const setAsk = (id: string, on: boolean) => {
    setAskingId(on ? id : null);
    if (on) {
      setDetent("full");
      scrollToCard(id);
    }
  };

  const mood: LumiMood = checking || processing ? "thinking" : askingId ? "speaking" : scanMood(scan);
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
          ) : scan.step === "done" ? (
            <div className="mt-1 flex items-center gap-2">
              <span className="text-[13px] text-muted">
                Scan {scan.number} · {newCount ? `${newCount} new` : "nothing new"}
                {updatedCount ? ` · ${updatedCount} re-checked` : ""}
              </span>
              <AiBadge />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );

  return (
    <div data-theme="dark" className="relative h-full overflow-hidden bg-black text-fg">
      <PhotoStage
        photo={photo}
        alt={`Scan ${scan.number}${scan.analysis ? `: ${scan.analysis.sceneSummary}` : ""}`}
        emptyText={wt.restored ? "Photos aren’t kept after the page reloads. Findings are still saved." : "Preparing photo…"}
        processing={processing || Boolean(checking)}
        session={session}
        scanId={scan.id}
        findings={items.map((i) => i.finding)}
        selectedId={selectedFindingId}
        onSelect={selectFromPhoto}
        bottom={HEIGHTS[detent]}
      />

      <div data-theme={theme} className="pointer-events-none absolute inset-0 z-20 text-fg [&>*]:pointer-events-auto">
        <Sheet
          detent={detent}
          onDetentChange={setDetent}
          heights={HEIGHTS}
          label={`Scan ${scan.number} findings`}
          header={header}
          contentRef={(el) => {
            sheetContent.current = el;
          }}
        >
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

              {scan.step === "done" && messages.length > 1 && (
                <div className="space-y-1 pl-[56px]">
                  {messages.slice(1).map((m, i) => (
                    <p key={i} className="text-[14px] leading-snug text-muted">
                      {m}
                    </p>
                  ))}
                </div>
              )}

              {scan.step === "done" && nudge && wt.hasImage(scan.id) && (
                <div className="mt-3 flex items-center gap-3 rounded-[20px] bg-surface-2 px-3.5 py-3">
                  <Layers size={20} className="shrink-0 text-muted" />
                  <p className="min-w-0 flex-1 text-[14px] leading-snug">{nudge.text}</p>
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

            {items.length > 0 && (
              <ul className="mt-4 space-y-3 px-4">
                {items.map(({ finding, role }) => (
                  <li
                    key={finding.id}
                    ref={(el) => {
                      cardRefs.current[finding.id] = el;
                    }}
                    className="scroll-mt-3"
                  >
                    <FindingCard
                      wt={wt}
                      finding={finding}
                      role={role}
                      scanId={scan.id}
                      open={selectedFindingId === finding.id}
                      asking={askingId === finding.id}
                      onToggle={() => toggleCard(finding.id)}
                      onAskChange={(on) => setAsk(finding.id, on)}
                      onShowInPhoto={photo ? () => showInPhoto(finding.id) : undefined}
                      onRecheck={isOpen(finding.status) && wt.hasImage(finding.lastSeenScanId) ? () => onRecheck(finding.lastSeenScanId) : undefined}
                    />
                  </li>
                ))}
              </ul>
            )}

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
              <button
                type="button"
                onClick={() => setTrustOpen(true)}
                className="pressable mt-1 inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-muted underline-offset-2 hover:underline"
              >
                <Info size={15} /> About these results
              </button>
              <p className="text-[12px] leading-relaxed text-muted">Potential barriers from photos only. Not an accessibility assessment or certification.</p>
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
