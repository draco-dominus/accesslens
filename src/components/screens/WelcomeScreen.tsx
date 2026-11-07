"use client";

import { useEffect, useState } from "react";
import { Sidekick, type LumiMood } from "../lumi/Sidekick";
import { Arrow, Chat, Close, Moon, Pin, Route, Scan, Sun } from "../ui/Icons";
import { Button, GlassIconButton } from "../ui/primitives";
import type { Theme } from "../app/AccessLensApp";
import { TrustList } from "../trust/TrustPanel";

const STEPS = [
  { icon: Scan, title: "Scan", body: "Take a photo of an entrance, walkway or room." },
  { icon: Pin, title: "Discover", body: "Lumi points out potential barriers it can see in the photo." },
  { icon: Chat, title: "Understand", body: "See who might be affected, what could help, and what a photo can't tell." },
  { icon: Route, title: "Keep going", body: "Scan again any time. Lumi remembers earlier findings and re-checks them when you return." },
];

/** Welcome (adapted from the prototype). */
export function WelcomeScreen({
  onStart,
  onContinue,
  canContinue,
  theme,
  onToggleTheme,
}: {
  onStart: () => void;
  onContinue: () => void;
  canContinue: boolean;
  theme: Theme;
  onToggleTheme: () => void;
}) {
  const [mood, setMood] = useState<LumiMood>("welcome");
  const [howOpen, setHowOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setMood("idle"), 3400);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="relative flex h-full flex-col bg-bg px-7 pt-[calc(var(--safe-top)+4px)] pb-[calc(var(--safe-bottom)+16px)]">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="relative grid size-6 place-items-center rounded-[9px] bg-primary">
            <span className="iri-conic size-2.5 rounded-full" />
          </span>
          <span className="text-[17px] font-semibold tracking-[-0.02em]">AccessLens</span>
        </div>
        <GlassIconButton onClick={onToggleTheme} aria-label={theme === "dark" ? "Switch to light appearance" : "Switch to dark appearance"}>
          {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
        </GlassIconButton>
      </header>

      <div className="grid flex-1 place-items-center">
        <div className="animate-rise-in" onPointerEnter={() => setMood("happy")} onPointerLeave={() => setMood("idle")}>
          <Sidekick mood={mood} size={176} />
        </div>
      </div>

      <div className="animate-rise-in" style={{ animationDelay: "120ms" }}>
        <p className="text-[15px] font-medium text-muted">Meet Lumi, your accessibility sidekick</p>
        <h1 className="mt-3 text-[40px] leading-[1.04] font-semibold tracking-[-0.038em] text-balance">Let’s explore this place together.</h1>
        <p className="mt-4 text-[17px] leading-[1.45] text-muted">
          Walk through a space and scan as you go. Lumi looks for steps, blocked paths and things sticking out, explains why they
          matter, and remembers what you’ve seen.
        </p>
      </div>

      <div className="animate-rise-in mt-9 flex flex-col gap-2" style={{ animationDelay: "220ms" }}>
        {canContinue && (
          <Button onClick={onContinue} className="w-full" icon={<Route size={20} />}>
            Continue walkthrough
          </Button>
        )}
        <Button onClick={onStart} variant={canContinue ? "secondary" : "primary"} className="w-full" icon={<Scan size={20} />}>
          {canContinue ? "Start a new walkthrough" : "Start walkthrough"}
        </Button>
        <Button
          variant="quiet"
          size="md"
          onClick={() => setHowOpen(true)}
          aria-haspopup="dialog"
          className="w-full text-muted hover:text-fg"
        >
          How Lumi works
        </Button>
        <p className="px-4 text-center text-[12px] leading-snug text-muted">
          An awareness tool that flags potential barriers from photos. Not an accessibility assessment or certification.
        </p>
      </div>

      {/* How it works sheet */}
      <div
        className={`absolute inset-0 z-30 bg-black/30 transition-opacity duration-300 ${howOpen ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={() => setHowOpen(false)}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="how-title"
        aria-hidden={!howOpen}
        inert={!howOpen}
        className={`absolute inset-x-2 bottom-2 z-40 max-h-[88%] overflow-y-auto overscroll-contain rounded-[34px] border border-glass-line bg-glass-strong p-6 pt-3 shadow-[var(--shadow-float)] backdrop-blur-2xl backdrop-saturate-150 transition-[transform,opacity] duration-[560ms] ease-[var(--ease-ios)] ${howOpen ? "translate-y-0 opacity-100" : "translate-y-[110%] opacity-0"}`}
      >
        <div className="mx-auto mb-4 h-[5px] w-10 rounded-full bg-[color-mix(in_srgb,var(--fg)_22%,transparent)]" />
        <div className="flex items-start justify-between">
          <h2 id="how-title" className="text-[24px] font-semibold tracking-[-0.03em]">
            How Lumi works
          </h2>
          <button
            type="button"
            onClick={() => setHowOpen(false)}
            aria-label="Close"
            className="pressable -mt-1 -mr-1 grid size-10 place-items-center rounded-full bg-surface-2 text-muted"
          >
            <Close size={17} />
          </button>
        </div>
        <ol className="mt-5 divide-y divide-line">
          {STEPS.map(({ icon: Icon, title, body }, i) => (
            <li key={title} className="flex items-center gap-4 py-3.5">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-surface text-fg shadow-[var(--shadow-soft)]">
                <Icon size={20} />
              </span>
              <div>
                <p className="text-[16px] font-semibold tracking-[-0.01em]">
                  <span className="sr-only">Step {i + 1}: </span>
                  {title}
                </p>
                <p className="text-[14px] leading-snug text-muted">{body}</p>
              </div>
            </li>
          ))}
        </ol>
        <h3 className="mt-5 text-[13px] font-semibold tracking-[0.04em] text-muted uppercase">What to expect</h3>
        <div className="mt-3">
          <TrustList compact />
        </div>
        <Button
          className="mt-5 w-full"
          onClick={() => {
            setHowOpen(false);
            onStart();
          }}
          icon={<Arrow size={19} />}
        >
          Let’s begin
        </Button>
      </div>
    </div>
  );
}
