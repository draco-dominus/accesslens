"use client";

import { useState } from "react";
import type { useWalkthrough } from "@/hooks/useWalkthrough";
import { canFinish } from "@/lib/session/engine";
import { areaOf, areas, recheckOutcome } from "@/lib/session/areas";
import { progressLine, scanActivity, walkthroughSummary } from "@/lib/session/lumi";
import { isOpen, type Session, type TrackedFinding } from "@/lib/session/types";
import { Sidekick } from "../lumi/Sidekick";
import { ChevronRight, Document, Moon, Scan, Sun } from "../ui/Icons";
import { Button, GlassIconButton } from "../ui/primitives";
import { AiBadge, StatusTag } from "../ui/Tags";
import type { Theme } from "../app/AccessLensApp";

type Walkthrough = ReturnType<typeof useWalkthrough>;

/** Walkthrough review (adapted from the prototype), built from the real session. */
export function WalkthroughScreen({
  wt,
  theme,
  onToggleTheme,
  onScan,
  onOpenScan,
  onReport,
  onRestart,
}: {
  wt: Walkthrough;
  theme: Theme;
  onToggleTheme: () => void;
  onScan: () => void;
  onOpenScan: (scanId: string, findingId?: string) => void;
  onReport: () => void;
  onRestart: () => void;
}) {
  const session = wt.session;
  const [confirmRestart, setConfirmRestart] = useState(false);
  if (!session) return null;

  const summary = walkthroughSummary(session);
  const finished = session.finishedAt !== null;
  const doneScans = summary.scans;
  const open = summary.unresolved.length + summary.needsVerification.length;
  // Never finish while a scan is queued/processing or an earlier spot is being re-checked.
  const busyScan = session.scans.find((sc) => (sc.step !== "done" && sc.step !== "error") || wt.checking[sc.id] || wt.retryingAny(sc.id));
  const finishable = canFinish(session) && !busyScan;

  const areaList = areas(session);
  const groups: { title: string; items: TrackedFinding[] }[] = [
    { title: "Still open", items: summary.unresolved },
    { title: "Needs an in-person check", items: summary.needsVerification },
    { title: "Appears improved", items: summary.improved },
  ];

  return (
    <div className="no-scrollbar h-full overflow-y-auto bg-bg px-4 pt-[calc(var(--safe-top)+62px)] pb-[calc(var(--safe-bottom)+20px)] text-fg">
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-2.5">
          <h1 className="text-[30px] leading-none font-semibold tracking-[-0.035em]">Review</h1>
          {doneScans > 0 && <AiBadge />}
        </div>
        <GlassIconButton onClick={onToggleTheme} aria-label={theme === "dark" ? "Switch to light appearance" : "Switch to dark appearance"}>
          {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
        </GlassIconButton>
      </div>

      {/* Lumi's summary */}
      <section className="mt-4 rounded-[28px] bg-surface p-5 shadow-[var(--shadow-soft)]" aria-live="polite">
        <div className="flex items-start gap-4">
          <Sidekick mood={finished ? "celebrate" : doneScans ? "speaking" : "ready"} size={64} />
          <div className="min-w-0 flex-1">
            <p className="text-[18px] leading-snug font-semibold tracking-[-0.02em]">
              {finished ? "Nice exploring! Here’s what we noticed together." : progressLine(session)}
            </p>
            {doneScans > 0 && (
              <div className="mt-1.5 space-y-1 text-[15px] leading-snug text-muted">
                {summary.lines.map((l) => (
                  <p key={l}>{l}</p>
                ))}
              </div>
            )}
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-4 divide-x divide-line rounded-2xl bg-surface-2 py-3 text-center">
          {(
            [
              ["Scans", doneScans],
              ["Areas", areaList.length],
              ["Open", open],
              ["Improved", summary.improved.length],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="flex flex-col-reverse px-1">
              <dt className="mt-1 text-[12px] font-medium text-muted">{k}</dt>
              <dd className="text-[20px] leading-none font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        {wt.restored && wt.photoRestore === "loading" && (
          <p className="mt-3 rounded-2xl bg-surface-2 px-3 py-2 text-[13px] leading-snug">
            Restoring this inspection’s photos from this device…
          </p>
        )}
        {wt.restored && wt.photoRestore === "ready" && wt.restoredPhotoCount > 0 && <p className="mt-3 rounded-2xl bg-surface-2 px-3 py-2 text-[13px] leading-snug">This inspection and {wt.restoredPhotoCount === 1 ? "1 locally saved photo was" : `${wt.restoredPhotoCount} locally saved photos were`} restored on this device.</p>}
        {wt.restored && wt.photoRestore === "ready" && wt.restoredPhotoCount === 0 && <p className="mt-3 rounded-2xl bg-surface-2 px-3 py-2 text-[13px] leading-snug">The finding notes were restored, but no saved photos were available on this device.</p>}
        {wt.photoStorageWarning && <p className="mt-3 rounded-2xl bg-surface-2 px-3 py-2 text-[13px] leading-snug">{wt.photoStorageWarning}</p>}
      </section>

      {/* Concerns by status */}
      {groups.map(
        (g) =>
          g.items.length > 0 && (
            <section key={g.title}>
              <h2 className="mt-7 mb-2.5 px-1 text-[13px] font-semibold tracking-[0.04em] text-muted uppercase">
                {g.title} · {g.items.length}
              </h2>
              <ul className="overflow-hidden rounded-[24px] bg-surface shadow-[var(--shadow-soft)]">
                {g.items.map((f) => (
                  <FindingRow key={f.id} wt={wt} session={session} finding={f} onOpen={() => onOpenScan(f.lastSeenScanId, f.id)} />
                ))}
              </ul>
            </section>
          ),
      )}

      {/* Areas, in the order they were first scanned; re-checks sit with their area. */}
      {areaList.length > 0 && (
        <>
          <h2 className="mt-7 mb-2.5 px-1 text-[13px] font-semibold tracking-[0.04em] text-muted uppercase">Areas · {areaList.length}</h2>
          <ol className="space-y-3">
            {areaList.map((area) => {
              const latest = area.scans.at(-1)!;
              const first = area.scans[0];
              const thumb = wt.media[latest.id]?.thumbUrl ?? wt.media[latest.id]?.imageUrl ?? wt.media[first.id]?.thumbUrl ?? wt.media[first.id]?.imageUrl;
              const ids = new Set(area.scans.map((sc) => sc.id));
              const areaFindings = session.findings.filter((f) => ids.has(f.firstScanId));
              const openHere = areaFindings.filter((f) => isOpen(f.status)).length;
              const improvedHere = areaFindings.filter((f) => f.status === "appears_improved").length;
              // Re-checks filed with this area (a rejected re-check starts its own area instead).
              const rechecks = area.scans.filter((sc) => sc !== first && sc.lineUpScanId).length;
              const unmatched = recheckOutcome(first) === "rejected" ? session.scans.find((sc) => sc.id === first.lineUpScanId) : undefined;
              const working = area.scans.find((sc) => sc.step !== "done" && sc.step !== "error");
              const failed = area.scans.some((sc) => sc.step === "error");
              const status = working
                ? `${scanActivity(working).title}…`
                : [
                    areaFindings.length ? `${areaFindings.length} ${areaFindings.length === 1 ? "finding" : "findings"}` : "No findings",
                    openHere ? `${openHere} open` : null,
                    improvedHere ? `${improvedHere} appear improved` : null,
                    rechecks ? `re-checked ${rechecks === 1 ? "once" : `${rechecks} times`}` : null,
                    unmatched ? `re-check didn’t match Area ${areaOf(session, unmatched.id)?.number ?? "?"}` : null,
                    failed ? "a scan didn’t finish" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ");
              return (
                <li key={area.key}>
                  <button
                    type="button"
                    onClick={() => onOpenScan(latest.id)}
                    className="pressable flex w-full items-center gap-3.5 rounded-[24px] bg-surface p-3.5 text-left shadow-[var(--shadow-soft)]"
                  >
                    <span className="relative size-16 shrink-0 overflow-hidden rounded-[16px] bg-surface-2">
                      {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
                      {thumb ? <img src={thumb} alt="" className="size-full object-cover" /> : <Scan size={20} className="m-auto mt-[22px] text-muted" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[17px] leading-snug font-semibold tracking-[-0.015em]">Area {area.number}</span>
                      <span className="block text-[14px] leading-snug text-muted">{status}</span>
                      {first.analysis && <span className="mt-0.5 line-clamp-1 block text-[13px] text-muted">{first.analysis.sceneSummary}</span>}
                    </span>
                    <ChevronRight size={18} className="shrink-0 text-muted" />
                  </button>
                </li>
              );
            })}
          </ol>
        </>
      )}

      <div className="mt-6 space-y-2">
        <Button className="w-full" onClick={onReport} icon={<Document size={19} />} disabled={!session.scans.some((sc) => sc.step === "done")}>
          Download report
        </Button>
        {finished ? (
          <>
            <Button
              className="w-full"
              onClick={() => {
                wt.resume();
                onScan();
              }}
              icon={<Scan size={19} />}
            >
              Keep exploring
            </Button>
            <Button variant="secondary" className="w-full" onClick={() => setConfirmRestart(true)}>
              Start a new walkthrough
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" className="w-full" onClick={wt.finish} disabled={!finishable}>
              Finish walkthrough
            </Button>
            {busyScan && (
              <p className="px-4 text-center text-[13px] leading-snug text-muted" aria-live="polite">
                Lumi is still working on scan {busyScan.number}. You can finish once it’s done.
              </p>
            )}
            <Button variant="secondary" className="w-full" onClick={onScan} icon={<Scan size={19} />}>
              {doneScans ? "Scan new area" : "Start scanning"}
            </Button>
            <p className="px-4 text-center text-[13px] leading-snug text-muted">You can keep scanning after you finish.</p>
          </>
        )}
        {confirmRestart && (
          <div role="alertdialog" aria-labelledby="restart-title" className="rounded-[24px] bg-surface p-4 shadow-[var(--shadow-float)]">
            <p id="restart-title" className="text-[15px] leading-snug font-semibold">
              Start over? This clears this walkthrough’s findings and photos from this device.
            </p>
            <div className="mt-3 flex gap-2">
              <Button size="md" className="flex-1" onClick={onRestart}>
                Start over
              </Button>
              <Button size="md" variant="secondary" className="flex-1" onClick={() => setConfirmRestart(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
      <p className="mt-6 px-4 text-center text-[12px] leading-relaxed text-muted">
        AI observations from your photos. They flag potential barriers to review; they aren’t a compliance assessment and can’t confirm a space
        is accessible.
      </p>
    </div>
  );
}

function FindingRow({ wt, session, finding, onOpen }: { wt: Walkthrough; session: Session; finding: TrackedFinding; onOpen: () => void }) {
  const first = session.scans.find((s) => s.id === finding.firstScanId);
  const thumb = wt.media[finding.lastSeenScanId]?.thumbUrl ?? wt.media[finding.lastSeenScanId]?.imageUrl;
  return (
    <li className="border-b border-line last:border-b-0">
      <button type="button" onClick={onOpen} className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2">
        <span className="relative size-10 shrink-0 overflow-hidden rounded-[12px] bg-surface-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
          {thumb && <img src={thumb} alt="" className="size-full object-cover" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] leading-snug font-medium">
            #{finding.number} {finding.details.title}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[13px] text-muted">
            <StatusTag status={finding.status} />
            <span>Area {areaOf(session, finding.firstScanId)?.number ?? first?.number}</span>
          </span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-muted" />
      </button>
    </li>
  );
}
