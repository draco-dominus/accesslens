"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Eye, Info, Question, Scan } from "../ui/Icons";
import { Button } from "../ui/primitives";

/**
 * What AccessLens can and can't do — every statement is true of the current product.
 * Deliberately no claims about training, validation, endorsements or certification, and no model or
 * brand names (pending the team's brand-guideline check).
 */
export const TRUST_FACTS: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <Scan size={20} />,
    title: "What Lumi can spot",
    body: "Potential physical barriers visible in a photo: steps and level changes, blocked or narrowed paths, and objects sticking out into a walkway.",
  },
  {
    icon: <Eye size={20} />,
    title: "How it stays grounded",
    body: "Every finding describes what’s visible in your photo and where. “Appears improved” only follows a close comparison of two photos of the same spot. When the photos don’t agree, Lumi says it can’t confirm.",
  },
  {
    icon: <Question size={20} />,
    title: "What Lumi can’t confirm",
    body: "Measurements like door widths, slopes or step heights; anything out of frame; non-visual barriers such as sound, lighting, signage or staff practices; whether a fix will last; and compliance with any accessibility standard.",
  },
  {
    icon: <Info size={20} />,
    title: "What AccessLens is",
    body: "An assistive awareness tool, powered by AI, to help you notice potential barriers. It isn’t a professional assessment or certification. For decisions, involve accessibility professionals and people with disabilities.",
  },
];

export function TrustList({ compact = false }: { compact?: boolean }) {
  return (
    <ul className={compact ? "space-y-3" : "divide-y divide-line"}>
      {TRUST_FACTS.map((f) => (
        <li key={f.title} className={`flex gap-3.5 ${compact ? "" : "py-3.5"}`}>
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-surface text-fg shadow-[var(--shadow-soft)]" aria-hidden>
            {f.icon}
          </span>
          <div>
            <p className="text-[16px] font-semibold tracking-[-0.01em]">{f.title}</p>
            <p className="mt-0.5 text-[14px] leading-snug text-muted">{f.body}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Modal sheet with the trust facts. Focus moves in on open and back to the opener on close; Esc closes. */
export function TrustSheet({ open, onClose, title = "About these results", footer }: { open: boolean; onClose: () => void; title?: string; footer?: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  // Runs only when the sheet opens/closes (not on every parent render).
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    panel.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      (opener.current as HTMLElement | null)?.focus?.();
    };
  }, [open]);

  return (
    <>
      <div
        className={`absolute inset-0 z-[60] bg-black/35 transition-opacity duration-300 ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        inert={!open}
        className={`absolute inset-x-2 bottom-2 z-[61] max-h-[86%] overflow-y-auto overscroll-contain rounded-[34px] border border-glass-line bg-glass-strong p-6 pt-3 text-fg shadow-[var(--shadow-float)] backdrop-blur-2xl backdrop-saturate-150 outline-none transition-[transform,opacity] duration-[520ms] ease-[var(--ease-ios)] ${open ? "translate-y-0 opacity-100" : "translate-y-[110%] opacity-0"}`}
      >
        <div className="mx-auto mb-4 h-[5px] w-10 rounded-full bg-[color-mix(in_srgb,var(--fg)_22%,transparent)]" />
        <h2 className="text-[24px] font-semibold tracking-[-0.03em]">{title}</h2>
        <div className="mt-2">
          <TrustList />
        </div>
        {footer ?? (
          <Button className="mt-4 w-full" onClick={onClose}>
            Got it
          </Button>
        )}
      </div>
    </>
  );
}
