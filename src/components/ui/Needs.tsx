import type { Finding } from "@/lib/analysis-schema";
import { accessibilityNeeds, NEED_LABEL, type NeedCategory } from "@/lib/session/categories";
import { Alert, Eye, Obstruction, Protrusion, Signpost, Stairs, Wheelchair } from "./Icons";

/**
 * Barrier-type icons and accessibility-need marks. Need categories come from the AI's own
 * "who may be affected" list (see lib/session/categories.ts). They're shown with an icon + label and a
 * small accent — visually separate from finding status, and never a severity.
 */

type BarrierType = Finding["barrierType"];

export function BarrierIcon({ type, size = 18, className = "" }: { type: BarrierType; size?: number; className?: string }) {
  const Icon = type === "steps" ? Stairs : type === "obstructed_walkway" ? Obstruction : type === "protruding_obstacle" ? Protrusion : Alert;
  return <Icon size={size} className={className} />;
}

const NEED_ICON: Record<NeedCategory, (p: { size?: number; className?: string; style?: React.CSSProperties }) => React.ReactNode> = {
  mobility: (p) => <Wheelchair {...p} />,
  vision: (p) => <Eye {...p} />,
  cognitive: (p) => <Signpost {...p} />,
};
export const needColor = (c: NeedCategory) => `var(--need-${c})`;

export function NeedIcon({ category, size = 16 }: { category: NeedCategory; size?: number }) {
  return NEED_ICON[category]({ size, style: { color: needColor(category) } });
}

/** Compact: icons only (for one-line rows). Labels stay available to screen readers. */
export function NeedMarks({ who }: { who: readonly string[] }) {
  const needs = accessibilityNeeds(who);
  if (!needs.length) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1" aria-label={`May affect: ${needs.map((n) => NEED_LABEL[n.category]).join(", ")}`} role="img">
      {needs.map((n) => (
        <span key={n.category} className="grid size-6 place-items-center rounded-full bg-surface-2">
          <NeedIcon category={n.category} size={14} />
        </span>
      ))}
    </span>
  );
}

/** Full chips with labels and the groups each category came from. */
export function NeedChips({ who }: { who: readonly string[] }) {
  const needs = accessibilityNeeds(who);
  if (!needs.length) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {needs.map((n) => (
        <li key={n.category} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-[14px] font-semibold">
          <NeedIcon category={n.category} size={16} />
          {NEED_LABEL[n.category]}
        </li>
      ))}
    </ul>
  );
}
