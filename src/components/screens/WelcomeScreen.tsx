"use client";

import { useState } from "react";
import { progressLine } from "@/lib/session/lumi";
import type { Session } from "@/lib/session/types";
import { Sidekick } from "../lumi/Sidekick";
import { TrustSheet } from "../trust/TrustPanel";
import { Chat, ChevronRight, Document, Info, Moon, Pin, Route, Scan, Sun } from "../ui/Icons";
import { Button, GlassIconButton } from "../ui/primitives";
import type { Theme } from "../app/AccessLensApp";

/** App-like home: scanning is primary; the current inspection stays one tap away. */
export function WelcomeScreen({
  session,
  onScan,
  onResume,
  onReview,
  onAsk,
  onReport,
  theme,
  onToggleTheme,
}: {
  session: Session | null;
  onScan: () => void;
  onResume: () => void;
  onReview: () => void;
  onAsk: () => void;
  onReport: () => void;
  theme: Theme;
  onToggleTheme: () => void;
}) {
  const [trustOpen, setTrustOpen] = useState(false);
  const scans = session?.scans.filter((scan) => scan.step === "done").length ?? 0;
  const findings = session?.findings.length ?? 0;
  const hasInspection = Boolean(session && session.scans.length);

  return (
    <div className="relative flex h-full flex-col overflow-y-auto bg-bg px-5 pt-[calc(var(--safe-top)+4px)] pb-[calc(var(--safe-bottom)+18px)] text-fg">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative grid size-7 place-items-center rounded-[10px] bg-primary"><span className="iri-conic size-3 rounded-full" /></span>
          <span className="text-[18px] font-semibold tracking-[-0.025em]">AccessLens</span>
        </div>
        <GlassIconButton onClick={onToggleTheme} aria-label={theme === "dark" ? "Switch to light appearance" : "Switch to dark appearance"}>
          {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
        </GlassIconButton>
      </header>

      <main className="flex flex-1 flex-col justify-center py-7">
        <div className="flex items-center gap-4">
          <Sidekick mood={hasInspection ? findings ? "ready" : "idle" : "welcome"} size={112} />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold tracking-[0.05em] text-muted uppercase">Lumi is ready</p>
            <h1 className="mt-1 text-[32px] leading-[1.06] font-semibold tracking-[-0.04em]">
              {hasInspection ? "Keep inspecting this space." : "Start with what you can see."}
            </h1>
          </div>
        </div>

        {hasInspection && session ? (
          <div className="mt-6 rounded-[24px] bg-surface px-4 py-3.5 shadow-[var(--shadow-soft)]">
            <p className="text-[15px] leading-snug font-semibold">{progressLine(session)}</p>
            <p className="mt-1 text-[13px] text-muted">{scans} completed {scans === 1 ? "scan" : "scans"} · {findings} {findings === 1 ? "finding" : "findings"}</p>
          </div>
        ) : (
          <p className="mt-6 max-w-[34ch] text-[16px] leading-relaxed text-muted">Photograph an entrance, walkway or room. Lumi will flag visible potential barriers and explain what still needs an in-person check.</p>
        )}

        <Button onClick={onScan} className="mt-6 w-full" icon={<Scan size={20} />}>
          Start scanning
        </Button>

        {!hasInspection && (
          <Button onClick={onAsk} variant="secondary" className="mt-2 w-full" icon={<Chat size={19} />}>
            Ask Lumi
          </Button>
        )}

        {hasInspection && (
          <div className="mt-4 overflow-hidden rounded-[24px] bg-surface shadow-[var(--shadow-soft)]">
            <HomeAction icon={<Pin size={19} />} label="Resume inspection" detail="Return to the latest photo" onClick={onResume} />
            <HomeAction icon={<Route size={19} />} label="Review earlier findings" detail="See status across every scan" onClick={onReview} />
            <HomeAction icon={<Chat size={19} />} label="Ask Lumi" detail={findings ? "Ask grounded questions about a finding" : "See what Lumi can explain"} onClick={onAsk} />
            <HomeAction icon={<Document size={19} />} label="View and export inspection" detail="Print or save a photo report" onClick={onReport} />
          </div>
        )}
      </main>

      <button type="button" onClick={() => setTrustOpen(true)} className="pressable mx-auto inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-muted">
        <Info size={15} /> How AccessLens works
      </button>
      <p className="px-4 text-center text-[11.5px] leading-snug text-muted">Potential barriers from photos only. Not an accessibility assessment or certification.</p>

      <TrustSheet open={trustOpen} onClose={() => setTrustOpen(false)} title="How AccessLens works" />
    </div>
  );
}

function HomeAction({ icon, label, detail, onClick }: { icon: React.ReactNode; label: string; detail: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="pressable flex min-h-[66px] w-full items-center gap-3 border-b border-line px-4 py-3 text-left last:border-b-0 hover:bg-surface-2">
      <span className="grid size-9 shrink-0 place-items-center rounded-[13px] bg-surface-2 text-muted">{icon}</span>
      <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold">{label}</span><span className="block text-[13px] leading-snug text-muted">{detail}</span></span>
      <ChevronRight size={17} className="shrink-0 text-muted" />
    </button>
  );
}
