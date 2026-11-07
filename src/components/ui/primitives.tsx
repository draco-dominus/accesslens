"use client";

import { useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { Sidekick, type LumiMood } from "../lumi/Sidekick";

/** UI primitives adapted from the Figma prototype (AccessLensFigmaPrototype/src/components/ui.tsx). */

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet";
  size?: "lg" | "md" | "sm";
  icon?: ReactNode;
};

export function Button({ variant = "primary", size = "lg", icon, className = "", children, ...rest }: BtnProps) {
  const sizes = {
    lg: "h-14 px-7 text-[17px] gap-2.5",
    md: "h-11 px-5 text-[15px] gap-2",
    sm: "h-9 px-4 text-[14px] gap-1.5",
  };
  const variants = {
    primary:
      "bg-primary text-on-primary shadow-[0_1px_0_rgba(255,255,255,0.12)_inset,0_10px_24px_-10px_rgba(0,0,0,0.45)] hover:opacity-90",
    secondary: "bg-surface-2 text-fg hover:bg-[color-mix(in_srgb,var(--surface-2),var(--fg)_6%)]",
    quiet: "bg-transparent text-fg hover:bg-surface-2",
  };
  return (
    <button
      type="button"
      className={`pressable inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-[-0.01em] disabled:cursor-not-allowed disabled:opacity-40 ${sizes[size]} ${variants[variant]} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

/** Circular glass control, 44pt minimum hit area. */
export function GlassIconButton({ className = "", children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`pressable grid size-11 shrink-0 place-items-center rounded-full border border-glass-line bg-glass text-fg shadow-[var(--shadow-soft)] backdrop-blur-xl backdrop-saturate-150 disabled:opacity-40 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Glass({
  className = "",
  style,
  children,
  strong,
}: {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  strong?: boolean;
}) {
  return (
    <div
      className={`border border-glass-line ${strong ? "bg-glass-strong" : "bg-glass"} shadow-[var(--shadow-float)] backdrop-blur-2xl backdrop-saturate-150 ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}

/** Thin, slowly travelling iridescent light around the parent's rounded shape (parent must be `relative`). */
export function IridescentEdge({
  active,
  ring = 2,
  bloom = 16,
  inner = true,
  speed = 6,
}: {
  active: boolean;
  ring?: number;
  bloom?: number;
  inner?: boolean;
  speed?: number;
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 rounded-[inherit] transition-opacity duration-700 ease-[var(--ease-ios)]"
      style={{ opacity: active ? 1 : 0 }}
    >
      {inner && (
        <div className="iri-bloom opacity-70" style={{ "--bloom": `${bloom}px` } as CSSProperties}>
          <div className="iri-border iri-conic" style={{ "--ring": `${bloom * 0.8}px`, animationDuration: `${speed}s` } as CSSProperties} />
        </div>
      )}
      <div className="iri-border iri-conic" style={{ "--ring": `${ring}px`, animationDuration: `${speed}s` } as CSSProperties} />
    </div>
  );
}

export const activeMood = (m: LumiMood) =>
  m === "thinking" || m === "discovery" || m === "speaking" || m === "happy" || m === "celebrate" || m === "welcome";

/** Floating capsule that hosts Lumi above camera content. */
export function SidekickCapsule({
  mood,
  title,
  detail,
  className = "",
  live = true,
  action,
}: {
  mood: LumiMood;
  title: ReactNode;
  detail?: ReactNode;
  className?: string;
  live?: boolean;
  action?: { label: string; onClick: () => void };
}) {
  const active = activeMood(mood);
  return (
    <div className={`relative rounded-[28px] ${className}`}>
      <IridescentEdge active={active} ring={1.5} bloom={10} speed={5} />
      <Glass strong className="relative flex items-center gap-3 rounded-[28px] py-2.5 pr-5 pl-2.5">
        <Sidekick mood={mood} size={44} halo={active} />
        <div className="min-w-0 max-w-[calc(100cqw-112px)]" aria-live={live ? "polite" : undefined}>
          <p className={`text-[15px] leading-tight font-semibold tracking-[-0.01em] ${mood === "thinking" ? "text-thinking" : ""}`}>{title}</p>
          {detail && <p className="mt-0.5 text-[13px] leading-snug text-muted">{detail}</p>}
          {action && (
            <button
              type="button"
              onClick={action.onClick}
              className="pressable mt-2 -mb-0.5 inline-flex min-h-10 items-center rounded-full bg-primary px-4 text-[14px] font-semibold text-on-primary"
            >
              {action.label}
            </button>
          )}
        </div>
      </Glass>
    </div>
  );
}

/**
 * Apple Maps-style sheet with two detents. Drag the handle or tap it to toggle;
 * keyboard users get a real button.
 */
export function BottomSheet({
  expanded,
  onExpandedChange,
  peek,
  full,
  label,
  children,
  className = "",
}: {
  expanded: boolean;
  onExpandedChange: (v: boolean) => void;
  peek: string;
  full: string;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const start = useRef<number | null>(null);
  const [drag, setDrag] = useState(0);
  const moved = useRef(false);

  return (
    <section
      aria-label={label}
      className={`absolute inset-x-0 bottom-0 z-20 flex flex-col rounded-t-[34px] border border-b-0 border-glass-line bg-[var(--sheet)] shadow-[0_-12px_48px_-12px_rgba(0,0,0,0.35)] backdrop-blur-2xl backdrop-saturate-150 ${drag ? "" : "transition-[height] duration-[560ms] ease-[var(--ease-ios)]"} ${className}`}
      style={{ height: `calc(${expanded ? full : peek} - ${drag}px)` }}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={expanded ? "Collapse findings" : "Expand findings"}
        onClick={() => {
          if (moved.current) {
            moved.current = false;
            return;
          }
          onExpandedChange(!expanded);
        }}
        onPointerDown={(e) => {
          start.current = e.clientY;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (start.current == null) return;
          setDrag(Math.max(-220, Math.min(220, e.clientY - start.current)));
        }}
        onPointerUp={(e) => {
          if (start.current == null) return;
          const dy = e.clientY - start.current;
          start.current = null;
          setDrag(0);
          if (Math.abs(dy) > 30) {
            moved.current = true;
            onExpandedChange(dy < 0);
          }
        }}
        className="flex h-9 w-full shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
      >
        <span className="h-[5px] w-10 rounded-full bg-[color-mix(in_srgb,var(--fg)_30%,transparent)]" />
      </button>
      {children}
    </section>
  );
}
