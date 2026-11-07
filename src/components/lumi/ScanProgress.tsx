"use client";

import { useEffect, useState } from "react";
import type { Scan, ScanStage } from "@/lib/session/types";
import { Check } from "../ui/Icons";

/**
 * Truthful scan progress: one row per real processing stage (from the pipeline), with live elapsed time.
 * Nothing here is simulated; a stage only appears once the app actually starts it.
 */

const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;

/** Re-render every `ms` while `active`, for live elapsed times. */
export function useTicker(active: boolean, ms = 250) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return now;
}

/** What Lumi is doing right now, from the active stages. */
export function activeStageSummary(scan: Scan): { title: string; detail?: string } {
  const active = (scan.stages ?? []).filter((s) => s.state === "active");
  if (scan.step === "queued" && !active.length) return { title: "Waiting for the previous scan to finish" };
  if (!active.length) return { title: "Getting started" };
  const [first, ...rest] = active;
  return { title: first.label, detail: rest.length ? `Also: ${rest.map((s) => s.label.toLowerCase()).join("; ")}` : undefined };
}

export function StageChecklist({ scan }: { scan: Scan }) {
  const processing = scan.step !== "done" && scan.step !== "error";
  const now = useTicker(processing);
  const stages = scan.stages ?? [];
  if (!stages.length) return null;
  return (
    <ol className="mt-3 space-y-1.5" aria-label="What Lumi is doing">
      {stages.map((st) => (
        <li key={st.id} className="flex items-center gap-2.5 text-[14px] leading-snug">
          <StageIcon state={st.state} />
          <span className={`min-w-0 flex-1 ${st.state === "active" ? "text-thinking font-semibold" : st.state === "done" ? "text-fg" : "text-muted"}`}>
            {st.label}
            {st.state === "failed" && " — didn’t finish"}
            {st.state === "skipped" && " — skipped"}
          </span>
          <span className="shrink-0 tabular-nums text-[13px] text-muted">{secs((st.endedAt ?? now) - st.startedAt)}</span>
        </li>
      ))}
      {processing && (
        <li className="pt-1 text-[13px] text-muted tabular-nums">Total so far: {secs(now - scan.createdAt)}</li>
      )}
    </ol>
  );
}

function StageIcon({ state }: { state: ScanStage["state"] }) {
  if (state === "done")
    return (
      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-on-primary">
        <Check size={12} strokeWidth={3} />
      </span>
    );
  if (state === "active")
    return (
      <span aria-hidden className="relative grid size-5 shrink-0 place-items-center">
        <span className="iri-conic absolute inset-0 animate-spin rounded-full [mask:radial-gradient(circle,transparent_55%,#000_56%)]" />
      </span>
    );
  return <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded-full border border-line text-[11px] text-muted">{state === "failed" ? "!" : "–"}</span>;
}

/**
 * Developer timing breakdown (open the app with ?timing=1). Per stage: total round trip, server time,
 * AI time, model/attempts, and the estimated network share (round trip − server time).
 */
export function TimingBreakdown({ scan }: { scan: Scan }) {
  const now = useTicker(!scan.doneAt, 1000);
  const stages = scan.stages ?? [];
  if (!stages.length) return null;
  const total = (scan.doneAt ?? now) - scan.createdAt;
  return (
    <details className="mx-4 mt-3 rounded-[20px] bg-surface px-4 py-3 text-[13px] shadow-[var(--shadow-soft)]" open>
      <summary className="cursor-pointer font-semibold">Timing · {secs(total)} from capture to result</summary>
      <table className="mt-2 w-full tabular-nums">
        <thead className="text-left text-muted">
          <tr>
            <th className="font-medium">Stage</th>
            <th className="text-right font-medium">Wall</th>
            <th className="text-right font-medium">Server</th>
            <th className="text-right font-medium">AI</th>
            <th className="text-right font-medium">Net</th>
          </tr>
        </thead>
        <tbody>
          {stages.map((st) => {
            const wall = st.endedAt ? st.endedAt - st.startedAt : undefined;
            const t = st.timing;
            const net = t?.serverTotalMs !== undefined ? t.clientMs - t.serverTotalMs : undefined;
            return (
              <tr key={st.id} className="border-t border-line align-top">
                <td className="py-1 pr-2">
                  {st.id.startsWith("compare:") ? "compare" : st.id}
                  {t?.ai && <span className="block text-[11px] text-muted">{t.ai}</span>}
                  {st.note && <span className="block text-[11px] text-muted">{st.note}</span>}
                </td>
                <td className="text-right">{wall !== undefined ? secs(wall) : "…"}</td>
                <td className="text-right">{t?.serverTotalMs !== undefined ? secs(t.serverTotalMs) : "–"}</td>
                <td className="text-right">{t?.aiMs !== undefined ? secs(t.aiMs) : "–"}</td>
                <td className="text-right">{net !== undefined ? secs(Math.max(0, net)) : "–"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted">Stages that overlap ran concurrently. “Net” ≈ upload, download and queueing outside the server.</p>
    </details>
  );
}
