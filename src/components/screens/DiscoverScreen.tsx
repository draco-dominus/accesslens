"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { useWalkthrough } from "@/hooks/useWalkthrough";
import { findingsForScan, lineUpSuggestion, lumiMessagesForScan, scanMood } from "@/lib/session/lumi";
import { isOpen, type FindingEvent, type Scan, type TrackedFinding } from "@/lib/session/types";
import { activeStageSummary, StageChecklist, TimingBreakdown, useTicker } from "../lumi/ScanProgress";
import { Sidekick, type LumiMood } from "../lumi/Sidekick";
import { BeforeAfter } from "../ui/BeforeAfter";
import { Chat, ChevronDown, ChevronRight, Layers, Rescan } from "../ui/Icons";
import { activeMood, BottomSheet, Button, IridescentEdge, SidekickCapsule } from "../ui/primitives";
import { AiBadge, ConfidenceTag, StatusTag, TypeTag } from "../ui/Tags";
import type { Theme } from "../app/AccessLensApp";

type Walkthrough = ReturnType<typeof useWalkthrough>;

const SCOPE_NOTE =
  "Lumi flags potential barriers it can see in your photos. A photo can’t confirm that a space is accessible or meets any standard. Check in person.";

/**
 * Discover (adapted from the prototype's Discover screen): the scanned photo with Lumi's findings in a
 * bottom sheet. Unlike the prototype, there are no image markers — the backend doesn't return
 * coordinates, so locations are described in words instead of being invented.
 */
export function DiscoverScreen({
  wt,
  scan,
  fresh,
  theme,
  selectedFindingId,
  onSelectFinding,
  onAsk,
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
  onSelectFinding: (id: string | null) => void;
  onAsk: (findingId: string) => void;
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

  const [expanded, setExpanded] = useState(Boolean(selectedFindingId));
  const tick = useTicker(processing, 1000);
  // Developer timing breakdown: open the app with ?timing=1 (this screen only renders client-side).
  const [showTiming] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("timing"));
  const cardRefs = useRef<Record<string, HTMLLIElement | null>>({});

  // Open the sheet once results arrive for a fresh scan, and when arriving with a finding selected.
  const doneNow = scan.step === "done";
  const prevDone = useRef(doneNow);
  useEffect(() => {
    if (fresh && doneNow && !prevDone.current && items.length > 0) setExpanded(true);
    prevDone.current = doneNow;
  }, [doneNow, fresh, items.length]);
  useEffect(() => {
    if (selectedFindingId) window.setTimeout(() => cardRefs.current[selectedFindingId]?.scrollIntoView({ block: "start", behavior: "smooth" }), 560);
  }, [selectedFindingId]);

  const mood: LumiMood = checking ? "thinking" : selectedFindingId ? "speaking" : scanMood(scan);
  const pick = (id: string) => onSelectFinding(selectedFindingId === id ? null : id);
  const nudge = lineUpSuggestion(session, scan.id);

  const newCount = items.filter((i) => i.role === "new").length;
  const updatedCount = items.length - newCount;

  return (
    <div data-theme="dark" className="relative h-full overflow-hidden bg-black text-fg">
      {/* The scanned photo */}
      <div className="absolute inset-x-1.5 top-1.5 bottom-[40%] overflow-hidden rounded-[44px] bg-[#0b0b0c] sm:rounded-[42px]">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- local blob URL
          <img
            src={photo}
            alt={`Scan ${scan.number}${scan.analysis ? `: ${scan.analysis.sceneSummary}` : ""}`}
            className={`absolute inset-0 size-full object-contain transition-transform duration-[1600ms] ease-[var(--ease-ios)] ${processing ? "scale-[1.02]" : "scale-100"}`}
          />
        ) : (
          <p className="absolute inset-x-8 top-[40%] text-center text-[14px] text-white/70">
            {wt.restored ? "Photos aren’t kept after the page reloads. Findings are still saved." : "Preparing photo…"}
          </p>
        )}
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.55),transparent_28%)]" />
        <IridescentEdge active={processing || Boolean(checking)} ring={2.5} bloom={22} speed={5} />
      </div>

      {/* Lumi while working */}
      {(processing || checking) && (
        <div className="absolute inset-x-0 top-[calc(var(--safe-top)+58px)] z-10 flex justify-center px-4">
          <SidekickCapsule
            mood="thinking"
            title={checking ? "Re-checking the earlier finding…" : `${activeStageSummary(scan).title}…`}
            detail={
              checking
                ? undefined
                : `${activeStageSummary(scan).detail ? `${activeStageSummary(scan).detail}. ` : ""}${Math.max(0, Math.round((tick - scan.createdAt) / 1000))}s so far · you can keep scanning.`
            }
          />
        </div>
      )}

      <div data-theme={theme} className="pointer-events-none absolute inset-0 z-20 text-fg">
        <BottomSheet
          className="pointer-events-auto"
          expanded={expanded}
          onExpandedChange={setExpanded}
          peek="42%"
          full="calc(100% - var(--safe-top) - 62px)"
          label={`Scan ${scan.number} findings`}
        >
          <div className="no-scrollbar flex-1 overflow-y-auto overscroll-contain pb-10">
            {/* Lumi leads */}
            <div className="px-5 pb-3" aria-live="polite">
              <div className="flex items-start gap-3">
                <Sidekick mood={processing ? "thinking" : mood} size={52} halo={activeMood(processing ? "thinking" : mood)} />
                <div className="min-w-0 flex-1 pt-0.5">
                  {processing && (
                    <>
                      <p className="text-[17px] leading-snug font-semibold tracking-[-0.015em]">Working on scan {scan.number}</p>
                      <StageChecklist scan={scan} />
                    </>
                  )}
                  {scan.step === "error" && (
                    <>
                      <p className="text-[17px] leading-snug font-semibold tracking-[-0.015em]">I couldn’t finish this scan.</p>
                      <p className="mt-0.5 text-[14px] leading-snug text-muted">{scan.error}</p>
                      <StageChecklist scan={scan} />
                      {!wt.canRetry(scan.id) && (
                        <p className="mt-2 text-[13px] leading-snug text-muted">Trying again won’t help with this photo. Please take a new one.</p>
                      )}
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
                    </>
                  )}
                  {scan.step === "done" && messages.length > 0 && (
                    <>
                      <p className="text-[17px] leading-snug font-semibold tracking-[-0.015em]">{messages[0]}</p>
                      {messages.slice(1).map((m, i) => (
                        <p key={i} className="mt-1 text-[14px] leading-snug text-muted">
                          {m}
                        </p>
                      ))}
                      {nudge && wt.hasImage(scan.id) && (
                        <div className="mt-3 rounded-2xl bg-surface-2 px-3 py-2.5">
                          <p className="text-[14px] leading-snug">{nudge.text}</p>
                          <button
                            type="button"
                            onClick={() => onRecheck(scan.id)}
                            className="pressable mt-2 inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 text-[15px] font-semibold text-on-primary"
                          >
                            <Layers size={17} /> Re-check with Line up
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Revisit questions: automatic matching was unsure */}
              {scan.pendingRevisit.map((earlierId) => (
                <RevisitQuestion
                  key={earlierId}
                  wt={wt}
                  scanId={scan.id}
                  earlierId={earlierId}
                  busy={Boolean(checking)}
                  onOpenScan={onOpenScan}
                />
              ))}

              {scan.step === "done" && (
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
                  <h2 className="min-w-0 text-[15px] leading-snug text-fg">
                    <span className="font-semibold">Scan {scan.number}</span>
                    <span className="text-muted">
                      {" · "}
                      {newCount ? `${newCount} new` : "nothing new"}
                      {updatedCount ? ` · ${updatedCount} re-checked` : ""}
                    </span>
                  </h2>
                  <AiBadge />
                </div>
              )}
            </div>

            <ul className="space-y-3 px-4">
              {items.map(({ finding, role }) => (
                <li
                  key={finding.id}
                  ref={(el) => {
                    cardRefs.current[finding.id] = el;
                  }}
                  className="scroll-mt-2"
                >
                  <FindingCard
                    wt={wt}
                    finding={finding}
                    role={role}
                    scanId={scan.id}
                    open={selectedFindingId === finding.id}
                    onToggle={() => pick(finding.id)}
                    onAsk={() => onAsk(finding.id)}
                    onRecheck={isOpen(finding.status) && wt.hasImage(finding.lastSeenScanId) ? () => onRecheck(finding.lastSeenScanId) : undefined}
                  />
                </li>
              ))}
            </ul>

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
              <div className="mt-5 flex justify-center px-4">
                <Button onClick={onScanAgain} icon={<Rescan size={19} />} className="w-full">
                  Scan again
                </Button>
              </div>
            )}

            <p className="px-7 pt-5 text-center text-[13px] leading-relaxed text-muted">
              {scan.analysis && !scan.analysis.imageUsable ? `${scan.analysis.limitations} ` : ""}
              {SCOPE_NOTE}
            </p>
          </div>
        </BottomSheet>
      </div>
    </div>
  );
}

function RevisitQuestion({
  wt,
  scanId,
  earlierId,
  busy,
  onOpenScan,
}: {
  wt: Walkthrough;
  scanId: string;
  earlierId: string;
  busy: boolean;
  onOpenScan: (id: string) => void;
}) {
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
      <p className="mt-2 text-[13px] leading-snug text-muted">
        If yes, I’ll compare the two photos for the open concerns there. I’ll only mark something improved if the photos clearly show it.
      </p>
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

/** Expandable finding card (prototype's card + "Lumi explains"), filled from real analysis data. */
export function FindingCard({
  wt,
  finding,
  role,
  scanId,
  open,
  onToggle,
  onAsk,
  onRecheck,
}: {
  wt: Walkthrough;
  finding: TrackedFinding;
  role: "new" | "updated";
  scanId: string;
  open: boolean;
  onToggle: () => void;
  onAsk: () => void;
  /** Present when the finding is open and its latest photo is available for Line up. */
  onRecheck?: () => void;
}) {
  const d = finding.details;
  const event = finding.history.filter((h) => h.scanId === scanId).at(-1);
  const subtitle = role === "updated" && event ? event.note : d.locationInImage;
  return (
    <div className={`overflow-hidden rounded-[24px] bg-surface transition-shadow duration-300 ${open ? "shadow-[var(--shadow-float)]" : "shadow-[var(--shadow-soft)]"}`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`finding-${finding.id}`}
        className="flex min-h-[72px] w-full items-start gap-3.5 px-4 py-4 text-left"
      >
        <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full text-[15px] font-bold transition-colors ${open ? "bg-primary text-on-primary" : "bg-surface-2 text-fg"}`}>
          {finding.number}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] leading-snug font-semibold tracking-[-0.015em]">{d.title}</span>
          <span className="mt-1 block text-[15px] leading-snug text-muted">{subtitle}</span>
          <span className="mt-2.5 flex flex-wrap gap-1.5">
            <StatusTag status={finding.status} />
            {role === "new" && <TypeTag type={d.barrierType} />}
          </span>
        </span>
        <ChevronDown size={20} className={`mt-1.5 shrink-0 text-muted transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
      </button>
      {role === "new" && <DuplicatePrompt wt={wt} scanId={scanId} findingId={finding.id} />}
      <div
        id={`finding-${finding.id}`}
        className={`grid transition-[grid-template-rows] duration-[480ms] ease-[var(--ease-ios)] ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
        inert={!open}
      >
        <div className="min-h-0">
          <div className="mx-4 border-t border-line pt-4 pb-5">
            {event?.comparison && <ComparisonBlock wt={wt} finding={finding} event={event} active={open} />}
            <FindingDetails finding={finding} active={open && !event?.comparison} />
            <History wt={wt} finding={finding} />
            <div className="mt-5 flex gap-2">
              <Button size="md" icon={<Chat size={17} />} onClick={onAsk} className="h-12 flex-1">
                Ask Lumi
              </Button>
              {onRecheck && (
                <Button size="md" variant="secondary" icon={<Layers size={17} />} onClick={onRecheck} className="h-12 flex-1">
                  Re-check spot
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Explicit, per-finding duplicate confirmation. Offered only for pairs the engine considers plausible
 * (same type as an earlier finding that a comparison in this scan found still present); never automatic.
 */
function DuplicatePrompt({ wt, scanId, findingId }: { wt: Walkthrough; scanId: string; findingId: string }) {
  const session = wt.session!;
  const pairs = wt.duplicateSuggestions(scanId).filter((p) => p.newFindingId === findingId);
  if (!pairs.length) return null;
  return (
    <div className="mx-4 mb-3 rounded-2xl bg-surface-2 px-3 py-2.5" role="group" aria-label="Possible duplicate">
      <p className="text-[14px] leading-snug">Could this be a barrier we already recorded?</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {pairs.map((p) => {
          const existing = session.findings.find((f) => f.id === p.existingFindingId);
          if (!existing) return null;
          return (
            <button
              key={p.existingFindingId}
              type="button"
              onClick={() => wt.confirmDuplicate(scanId, findingId, p.existingFindingId)}
              className="pressable min-h-11 rounded-full border border-line bg-surface px-4 text-[14px] font-semibold"
            >
              Same as #{existing.number} {existing.details.title}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function FindingDetails({ finding, active }: { finding: TrackedFinding; active: boolean }) {
  const d = finding.details;
  const sections: [string, ReactNode][] = [
    ["What I could see", d.visualEvidence],
    ["Why it could matter", d.potentialImpact],
    [
      "Who might be affected",
      <ul key="who" className="mt-1 list-disc space-y-0.5 pl-5">
        {d.whoMayBeAffected.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>,
    ],
    ["What could help", d.suggestedImprovement],
    [
      "What I can’t tell from a photo",
      <span key="unk" className="flex gap-2.5">
        <span aria-hidden className="mt-[3px] grid size-[18px] shrink-0 place-items-center rounded-full border border-[color-mix(in_srgb,var(--fg)_35%,transparent)] text-[11px] font-bold text-muted">
          ?
        </span>
        <span>{d.uncertainty}</span>
      </span>,
    ],
  ];
  return (
    <div className="flex gap-3">
      <Sidekick mood={active ? "speaking" : "idle"} size={40} halo={active} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="mr-1 text-[13px] font-semibold text-muted">Lumi explains</p>
          <TypeTag type={d.barrierType} />
          <ConfidenceTag confidence={d.confidence} />
        </div>
        <p className="mt-1 text-[13px] text-muted">Location in photo: {d.locationInImage}</p>
        <dl className="mt-3 space-y-4">
          {sections.map(([label, body]) => (
            <div key={label}>
              <dt className="text-[14px] font-semibold tracking-[-0.005em] text-fg">{label}</dt>
              <dd className="mt-1 text-[16px] leading-[1.5] text-fg">{body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

/** Evidence from /api/compare for this finding in this scan, with the two photos it compared. */
function ComparisonBlock({ wt, finding, event, active }: { wt: Walkthrough; finding: TrackedFinding; event: FindingEvent; active: boolean }) {
  const session = wt.session!;
  const c = event.comparison!;
  // The earlier photo is the one /api/compare actually used (recorded on the scan's status event);
  // otherwise the most recent earlier scan where this finding was seen.
  const recorded = session.scans
    .find((s) => s.id === event.scanId)
    ?.events.find((e) => e.kind === "status_change" && e.findingId === finding.id);
  const previous = [...finding.history].reverse().find((h) => h.scanId !== event.scanId && h.status !== "appears_improved");
  const beforeScanId =
    recorded && recorded.kind === "status_change" ? recorded.referenceScanId : (previous?.scanId ?? finding.firstScanId);
  const beforeScan = session.scans.find((s) => s.id === beforeScanId);
  const nowScan = session.scans.find((s) => s.id === event.scanId);
  const beforeUrl = wt.media[beforeScanId]?.imageUrl ?? wt.media[beforeScanId]?.thumbUrl;
  const nowUrl = wt.media[event.scanId]?.imageUrl ?? wt.media[event.scanId]?.thumbUrl;
  const mood: LumiMood = event.status === "appears_improved" ? "happy" : event.status === "needs_verification" ? "unsure" : "concerned";

  return (
    <div className="mb-6">
      <div className="flex gap-3">
        <Sidekick mood={active ? mood : "idle"} size={40} halo={active && activeMood(mood)} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-muted">
            Compared with scan {beforeScan?.number ?? "?"}
          </p>
          <p className="mt-1 text-[16px] leading-[1.5] text-fg">{c.observedChange}</p>
          {event.guardrail && (
            <div className="mt-2 rounded-2xl bg-[color-mix(in_srgb,var(--color-caution)_12%,transparent)] px-3 py-2 text-[14px] leading-snug">
              <p className="font-semibold">Why I’m not sure</p>
              <ul className="mt-1 list-disc pl-5">
                {event.guardrail.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-3 text-[14px] font-semibold">What the photos show</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[15px] leading-snug">
            {c.visualEvidence.map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
          <p className="mt-3 text-[14px] font-semibold">Still uncertain</p>
          <p className="mt-1 text-[15px] leading-snug">{c.remainingUncertainty}</p>
          {event.status === "appears_improved" && (
            <p className="mt-2 text-[13px] leading-snug text-muted">This barrier looks better in these photos. It’s worth confirming in person, and it doesn’t mean the whole space is accessible.</p>
          )}
        </div>
      </div>
      {beforeUrl && nowUrl && (
        <div className="mt-4">
          <BeforeAfter
            earlier={beforeUrl}
            later={nowUrl}
            earlierLabel={`Scan ${beforeScan?.number}, earlier`}
            laterLabel={`Scan ${nowScan?.number}, now`}
          />
        </div>
      )}
    </div>
  );
}

/** Status across scans, from the finding's recorded history. */
export function History({ wt, finding }: { wt: Walkthrough; finding: TrackedFinding }) {
  const session = wt.session!;
  if (finding.history.length < 2) return null;
  return (
    <div className="mt-5">
      <p className="text-[14px] font-semibold text-fg">Across your scans</p>
      <ol className="mt-2 space-y-2 border-l border-line pl-4">
        {finding.history.map((h, i) => {
          const sc = session.scans.find((s) => s.id === h.scanId);
          return (
            <li key={i} className="relative text-[14px] leading-snug">
              <span aria-hidden className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-surface bg-fg" />
              <span className="font-semibold">Scan {sc?.number}</span> · <StatusTag status={h.status} />
              {i > 0 && <span className="mt-1 block text-muted">{h.note}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
