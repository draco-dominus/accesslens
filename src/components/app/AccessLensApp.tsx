"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { useLumiChat } from "@/hooks/useLumiChat";
import { useWalkthrough } from "@/hooks/useWalkthrough";
import { DiscoverScreen } from "../screens/DiscoverScreen";
import { FindingDetailScreen, isRecheckable } from "../screens/FindingDetailScreen";
import { InspectionReport } from "../screens/InspectionReport";
import { ScanScreen } from "../screens/ScanScreen";
import { WalkthroughScreen } from "../screens/WalkthroughScreen";
import { WelcomeScreen } from "../screens/WelcomeScreen";
import { AskLumiScreen } from "../lumi/LumiPanel";
import { Chat, Close, Home, Pin, Route, Scan } from "../ui/Icons";
import { GlassIconButton } from "../ui/primitives";

/**
 * AccessLens app shell, adapted from the Figma prototype's App.tsx.
 * Journey: Home → Scan new area → Analyzing → Area (photo + findings) → Finding details → Re-check this area
 * → Before/after → Review → Report. "Scan new area" and "Re-check this area" are separate, explicit
 * operations. Ask Lumi is its own destination. All data comes from useWalkthrough (real API calls +
 * session engine); nothing here is mocked.
 */

export type Theme = "light" | "dark";
type Screen = "welcome" | "scan" | "discover" | "finding" | "ask" | "walkthrough" | "report";

const NAV = [
  { id: "discover", label: "Findings", icon: Pin },
  { id: "walkthrough", label: "Walkthrough", icon: Route },
] as const;

/**
 * Screen changes use the View Transitions API where available (Safari 18+, Chrome), so the scanned photo
 * morphs between screens (`view-transition-name: scan-photo`). Falls back to the CSS screen animation;
 * skipped entirely when the user prefers reduced motion.
 */
function withTransition(update: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (doc.startViewTransition && !reduced) doc.startViewTransition(() => flushSync(update));
  else update();
}

function subscribeScheme(cb: () => void) {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
const systemTheme = (): Theme => (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

export function AccessLensApp() {
  const wt = useWalkthrough();
  const chat = useLumiChat(wt.session);
  const system = useSyncExternalStore(subscribeScheme, systemTheme, () => "light" as Theme);
  const [override, setOverride] = useState<Theme | null>(null);
  const theme = override ?? system;

  const [screen, setScreen] = useState<Screen>("welcome");
  const [returnTo, setReturnTo] = useState<Screen>("welcome");
  const [scanId, setScanId] = useState<string | null>(null);
  const [findingId, setFindingId] = useState<string | null>(null);
  /** Set only by "Re-check this area": the earlier scan the camera lines up with. */
  const [recheckScanId, setRecheckScanId] = useState<string | undefined>();
  const [lumiFindingId, setLumiFindingId] = useState<string | null>(null);
  const [askReturn, setAskReturn] = useState<Screen>("welcome");
  const [reportReturn, setReportReturn] = useState<Screen>("welcome");
  /** Finding Details: which finding, seen from which scan's photo, optionally at the comparison. */
  const [detail, setDetail] = useState<{ findingId: string; scanId: string; section?: "compare" } | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const session = wt.session;
  const scans = session?.scans ?? [];
  const latestScan = scans.at(-1) ?? null;
  const currentScan = scans.find((s) => s.id === scanId) ?? latestScan;
  const hasScans = scans.length > 0;

  const go = useCallback((s: Screen) => withTransition(() => setScreen(s)), []);
  const toggleTheme = () => setOverride(theme === "dark" ? "light" : "dark");

  /** Open the camera: a new area by default, or a re-check lined up with `recheck`'s photo. */
  const startScan = (recheck?: string) => {
    setRecheckScanId(typeof recheck === "string" ? recheck : undefined);
    if (!session) wt.start();
    else if (session.finishedAt !== null) wt.resume();
    setReturnTo(screen === "scan" ? returnTo : screen);
    go("scan");
  };

  const onCaptured = (file: File, lineUpScanId?: string) => {
    const id = wt.scanFile(file, { lineUpScanId });
    setScanId(id);
    setFindingId(null);
    go("discover");
  };

  /** An area's photo and findings. */
  const openScan = (id: string) => {
    setScanId(id);
    go("discover");
  };

  /** Finding Details, seen from a scan's photo (defaults to where the finding was last seen). */
  const openFinding = (id: string, fromScanId?: string, section?: "compare") => {
    const f = session?.findings.find((x) => x.id === id);
    if (!f) return;
    setFindingId(id);
    setDetail({ findingId: id, scanId: fromScanId ?? f.lastSeenScanId, section });
    go("finding");
  };

  /** Back from details: the area page it was opened from. */
  const backToArea = () => {
    if (detail) openScan(detail.scanId);
    else go("discover");
  };

  const openLumi = (id?: string) => {
    const preferred = id ?? findingId ?? [...(session?.findings ?? [])].reverse().find((finding) => finding.status !== "appears_improved")?.id ?? session?.findings.at(-1)?.id ?? null;
    setLumiFindingId(preferred);
    setAskReturn(screen === "ask" ? askReturn : screen);
    go("ask");
  };

  const openReport = () => {
    setReportReturn(screen === "report" ? reportReturn : screen);
    go("report");
  };

  const detailFinding = detail ? session?.findings.find((f) => f.id === detail.findingId) : undefined;

  // Camera-led screens are always dark; others follow the chosen appearance.
  const chromeTheme: Theme = screen === "scan" ? "dark" : theme;

  return (
    <main className="grid min-h-dvh place-items-center bg-[#e8e8ea] transition-colors duration-500 dark:bg-[#050505] sm:p-6">
      <div
        className="device relative h-dvh w-full overflow-clip bg-bg text-fg sm:h-[min(880px,calc(100dvh-48px))] sm:w-[410px] sm:rounded-[56px] sm:shadow-[0_0_0_11px_#0a0a0a,0_0_0_12.5px_#3a3a3c,0_40px_100px_-20px_rgba(0,0,0,0.45)]"
        style={{ containerType: "size" }}
      >
        <div key={screen} className="screen-host animate-screen-in absolute inset-0">
          {screen === "welcome" && (
            <WelcomeScreen
              session={session}
              theme={theme}
              onToggleTheme={toggleTheme}
              onScan={() => startScan()}
              onResume={() => latestScan && openScan(latestScan.id)}
              onReview={() => go("walkthrough")}
              onAsk={() => openLumi()}
              onReport={() => openReport()}
            />
          )}
          {screen === "scan" && <ScanScreen key={recheckScanId ?? "new"} wt={wt} onCapture={onCaptured} recheckScanId={recheckScanId} />}
          {screen === "discover" && currentScan && (
            <DiscoverScreen
              key={currentScan.id}
              wt={wt}
              scan={currentScan}
              onOpenFinding={(id, section) => openFinding(id, currentScan.id, section)}
              onOpenScan={openScan}
              onScanNewArea={() => startScan()}
              onRecheck={(id) => startScan(id)}
              onReview={() => go("walkthrough")}
              onAsk={(id) => openLumi(id)}
              onHome={() => go("welcome")}
              onReport={() => openReport()}
            />
          )}
          {screen === "finding" && detail && detailFinding && (
            <FindingDetailScreen
              key={`${detail.findingId}:${detail.scanId}:${detail.section ?? ""}`}
              wt={wt}
              finding={detailFinding}
              scanId={detail.scanId}
              section={detail.section}
              onBack={backToArea}
              onAsk={() => openLumi(detailFinding.id)}
              onRecheck={isRecheckable(wt, detailFinding) ? () => startScan(detailFinding.lastSeenScanId) : undefined}
            />
          )}
          {screen === "ask" && (
            <AskLumiScreen
              session={session}
              chat={chat}
              findingId={lumiFindingId}
              onFindingChange={setLumiFindingId}
              onBack={() => go(askReturn === "ask" || askReturn === "scan" ? (hasScans ? "discover" : "welcome") : askReturn)}
              onOpenFinding={(finding) => openFinding(finding.id)}
              onScan={() => startScan()}
            />
          )}
          {screen === "walkthrough" && (
            <WalkthroughScreen
              wt={wt}
              theme={theme}
              onToggleTheme={toggleTheme}
              onScan={() => startScan()}
              onOpenScan={(id, finding) => {
                if (!finding) return openScan(id);
                const compared = session?.findings.find((f) => f.id === finding)?.history.some((h) => h.comparison);
                openFinding(finding, id, compared ? "compare" : undefined);
              }}
              onReport={() => openReport()}
              onRestart={() => {
                wt.reset();
                setScanId(null);
                setFindingId(null);
                go("welcome");
              }}
            />
          )}
          {screen === "report" && session && <InspectionReport session={session} media={wt.media} photoRestore={wt.photoRestore} onBack={() => go(reportReturn)} />}
        </div>

        {/* Simulated status bar + Dynamic Island, framed desktop preview only (from the prototype). */}
        <div
          aria-hidden
          data-theme={chromeTheme}
          className="no-print pointer-events-none absolute inset-x-0 top-0 z-50 hidden h-[50px] items-center justify-between px-9 pt-1 text-fg sm:flex"
        >
          <span className="w-14 text-[15px] font-semibold tracking-[-0.01em]">9:41</span>
          <span className="absolute top-[11px] left-1/2 h-[34px] w-[122px] -translate-x-1/2 rounded-full bg-black" />
          <span className="flex w-14 items-center justify-end gap-1.5">
            <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor">
              <rect x="0" y="7" width="3" height="4" rx="1" />
              <rect x="4.5" y="5" width="3" height="6" rx="1" />
              <rect x="9" y="2.5" width="3" height="8.5" rx="1" />
              <rect x="13.5" y="0" width="3" height="11" rx="1" />
            </svg>
            <svg width="25" height="12" viewBox="0 0 25 12" fill="none">
              <rect x="0.5" y="0.5" width="21" height="11" rx="3.5" stroke="currentColor" opacity="0.4" />
              <rect x="2" y="2" width="18" height="8" rx="2" fill="currentColor" />
              <rect x="23" y="4" width="1.5" height="4" rx="0.75" fill="currentColor" opacity="0.4" />
            </svg>
          </span>
        </div>

        {(screen === "scan" || screen === "walkthrough") && (
          <nav
            data-theme={chromeTheme}
            aria-label="AccessLens"
            className="no-print absolute inset-x-0 top-[var(--safe-top)] z-40 flex items-center justify-between gap-2 px-4 text-fg"
          >
            {screen === "walkthrough" && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 -top-[var(--safe-top)] -z-10 h-[calc(var(--safe-top)+64px)] bg-[linear-gradient(to_bottom,var(--bg)_55%,transparent)]"
              />
            )}

            {screen === "scan" && (
              <GlassIconButton
                onClick={() => go(hasScans ? (returnTo === "welcome" || returnTo === "scan" ? "discover" : returnTo) : "welcome")}
                aria-label="Close camera"
              >
                <Close size={19} />
              </GlassIconButton>
            )}

            {screen !== "scan" && (
              <GlassIconButton onClick={() => go("welcome")} aria-label="Home">
                <Home size={19} />
              </GlassIconButton>
            )}

            <div className="flex min-w-0 items-center gap-0.5 rounded-full border border-glass-line bg-glass p-1 shadow-[var(--shadow-soft)] backdrop-blur-xl backdrop-saturate-150">
              {NAV.slice(0, 1).map(({ id, label, icon: Icon }) => {
                const active = screen === id;
                const enabled = hasScans;
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={!enabled}
                    aria-current={active ? "page" : undefined}
                    aria-label={label}
                    onClick={() => {
                      go(id);
                    }}
                    className={`pressable flex size-11 items-center justify-center rounded-full transition-[background-color,color] duration-300 ease-[var(--ease-ios)] disabled:opacity-30 ${active ? "bg-primary text-on-primary" : "text-fg hover:bg-[color-mix(in_srgb,var(--fg)_8%,transparent)]"}`}
                  >
                    <Icon size={18} />
                  </button>
                );
              })}
              <button
                type="button"
                disabled={!session}
                aria-label="Ask Lumi"
                onClick={() => openLumi()}
                className="pressable flex size-11 items-center justify-center rounded-full text-fg transition-[background-color,color] duration-300 ease-[var(--ease-ios)] hover:bg-[color-mix(in_srgb,var(--fg)_8%,transparent)] disabled:opacity-30"
              >
                <Chat size={18} />
              </button>
              {NAV.slice(1).map(({ id, label, icon: Icon }) => {
                const active = screen === id;
                return (
                  <button
                    key={id}
                    type="button"
                    disabled={!session}
                    aria-current={active ? "page" : undefined}
                    aria-label={label}
                    onClick={() => go(id)}
                    className={`pressable flex size-11 items-center justify-center rounded-full transition-[background-color,color] duration-300 ease-[var(--ease-ios)] disabled:opacity-30 ${active ? "bg-primary text-on-primary" : "text-fg hover:bg-[color-mix(in_srgb,var(--fg)_8%,transparent)]"}`}
                  >
                    <Icon size={18} />
                  </button>
                );
              })}
            </div>

            {screen !== "scan" ? (
              <button
                type="button"
                onClick={() => startScan()}
                aria-label={hasScans ? "Scan new area" : "Scan"}
                className="pressable flex h-12 shrink-0 items-center gap-2 rounded-full bg-primary pr-4 pl-3.5 text-[15px] font-semibold text-on-primary shadow-[0_8px_24px_-8px_rgba(0,0,0,0.5)]"
              >
                <Scan size={19} />
                <span className="@max-[374px]:hidden">{hasScans ? "New area" : "Scan"}</span>
              </button>
            ) : (
              <span className="size-11" aria-hidden />
            )}
          </nav>
        )}

      </div>
    </main>
  );
}
