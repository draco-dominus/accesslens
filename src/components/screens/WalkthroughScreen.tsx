"use client";

import { useState } from "react";
import type { useWalkthrough } from "@/hooks/useWalkthrough";
import { progressLine, scanMood, stepLabel, walkthroughSummary } from "@/lib/session/lumi";
import type { Session, TrackedFinding } from "@/lib/session/types";
import { Sidekick } from "../lumi/Sidekick";
import { ChevronRight, Moon, Scan, Sun } from "../ui/Icons";
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
  onRestart,
}: {
  wt: Walkthrough;
  theme: Theme;
  onToggleTheme: () => void;
  onScan: () => void;
  onOpenScan: (scanId: string, findingId?: string) => void;
  onRestart: () => void;
}) {
  const session = wt.session;
  const [confirmRestart, setConfirmRestart] = useState(false);
  if (!session) return null;

  const summary = walkthroughSummary(session);
  const finished = session.finishedAt !== null;
  const doneScans = summary.scans;
  const open = summary.unresolved.length + summary.needsVerification.length;

  const groups: { title: string; items: TrackedFinding[] }[] = [
    { title: "Still open", items: summary.unresolved },
    { title: "Needs an in-person check", items: summary.needsVerification },
    { title: "Appears improved", items: summary.improved },
  ];

  return (
    <div className="no-scrollbar h-full overflow-y-auto bg-bg px-4 pt-[calc(var(--safe-top)+62px)] pb-[calc(var(--safe-bottom)+20px)] text-fg">
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-2.5">
          <h1 className="text-[30px] leading-none font-semibold tracking-[-0.035em]">Walkthrough</h1>
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
              ["Areas", summary.areas],
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
        {wt.restored && (
          <p className="mt-3 rounded-2xl bg-surface-2 px-3 py-2 text-[13px] leading-snug">
            This walkthrough was restored after a reload. Findings are kept, but photos aren’t, so earlier spots can’t be compared
            automatically. Scan them again to re-check.
          </p>
        )}
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

      {/* Scans in order */}
      {session.scans.length > 0 && (
        <>
          <h2 className="mt-7 mb-2.5 px-1 text-[13px] font-semibold tracking-[0.04em] text-muted uppercase">Scans · {session.scans.length}</h2>
          <ol className="space-y-3">
            {session.scans.map((sc) => {
              const thumb = wt.media[sc.id]?.thumbUrl ?? wt.media[sc.id]?.imageUrl;
              const related = sc.relations.filter((r) => r.sameArea === "yes" || (r.decidedBy === "user" && r.sameArea !== "no"));
              const touched = sc.events.filter((e) => e.kind === "new_finding").length;
              const status =
                sc.step === "done"
                  ? [
                      touched ? `${touched} new` : "Nothing new",
                      related.length ? `same area as scan ${related.map((r) => session.scans.find((x) => x.id === r.scanId)?.number).join(", ")}` : null,
                      sc.pendingRevisit.length ? "waiting for your answer" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  : sc.step === "error"
                    ? "Couldn’t finish"
                    : `${stepLabel(sc.step)}…`;
              return (
                <li key={sc.id}>
                  <button
                    type="button"
                    onClick={() => onOpenScan(sc.id)}
                    className="pressable flex w-full items-center gap-3.5 rounded-[24px] bg-surface p-3.5 text-left shadow-[var(--shadow-soft)]"
                  >
                    <span className="relative size-14 shrink-0 overflow-hidden rounded-[16px] bg-surface-2">
                      {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
                      {thumb ? <img src={thumb} alt="" className="size-full object-cover" /> : <Scan size={20} className="m-auto mt-[18px] text-muted" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-[17px] leading-snug font-semibold tracking-[-0.015em]">Scan {sc.number}</span>
                        <span aria-hidden>
                          <Sidekick mood={scanMood(sc)} size={22} halo={false} float={false} />
                        </span>
                      </span>
                      <span className="block text-[14px] leading-snug text-muted">{status}</span>
                      {sc.analysis && <span className="mt-0.5 line-clamp-1 block text-[13px] text-muted">{sc.analysis.sceneSummary}</span>}
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
            <Button className="w-full" onClick={wt.finish} disabled={!doneScans}>
              Finish walkthrough
            </Button>
            <Button variant="secondary" className="w-full" onClick={onScan} icon={<Scan size={19} />}>
              {doneScans ? "Scan again" : "Start scanning"}
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
  const last = session.scans.find((s) => s.id === finding.lastSeenScanId);
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
            <span>
              Scan {first?.number}
              {last && last.id !== first?.id ? ` → ${last.number}` : ""}
            </span>
          </span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-muted" />
      </button>
    </li>
  );
}
