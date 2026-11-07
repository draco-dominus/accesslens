"use client";

import { useId, type CSSProperties } from "react";

/**
 * Lumi — a tiny, soft, white companion (adapted from the Figma prototype's Sidekick).
 * Mood is carried by the face, a little body language and restrained iridescent light.
 *
 * Product states → moods:
 *   welcome → "welcome"          ready to scan → "ready"       analyzing → "thinking"
 *   barrier discovered → "discovery"   explaining → "speaking"   improvement observed → "happy"
 *   uncertainty → "unsure"       still there / problem → "concerned"   walkthrough complete → "celebrate"
 */
import type { LumiMood } from "@/lib/session/lumi";
export type { LumiMood };

const HALO: Record<LumiMood, { opacity: number; speed: number; scale: number }> = {
  idle: { opacity: 0.16, speed: 14, scale: 0.85 },
  welcome: { opacity: 0.6, speed: 7, scale: 1 },
  ready: { opacity: 0.3, speed: 10, scale: 0.92 },
  thinking: { opacity: 0.9, speed: 4, scale: 1.06 },
  speaking: { opacity: 0.55, speed: 6, scale: 0.98 },
  discovery: { opacity: 0.95, speed: 3.5, scale: 1.1 },
  happy: { opacity: 0.7, speed: 6, scale: 1.02 },
  unsure: { opacity: 0.25, speed: 11, scale: 0.9 },
  concerned: { opacity: 0.2, speed: 12, scale: 0.88 },
  celebrate: { opacity: 0.95, speed: 3, scale: 1.12 },
};

/** Iridescent light inside the body — only while Lumi is "working" or delighted. */
const INNER_GLOW: Record<LumiMood, number> = {
  idle: 0,
  welcome: 0.35,
  ready: 0.2,
  thinking: 0.85,
  speaking: 0.45,
  discovery: 0.9,
  happy: 0.55,
  unsure: 0.1,
  concerned: 0,
  celebrate: 0.9,
};

const MOOD_LABEL: Record<LumiMood, string> = {
  idle: "relaxed",
  welcome: "waving hello",
  ready: "ready to scan",
  thinking: "thinking",
  speaking: "explaining",
  discovery: "alert, it noticed something",
  happy: "pleased, something looks improved",
  unsure: "unsure",
  concerned: "concerned",
  celebrate: "celebrating the finished walkthrough",
};

/** Whole-body motion per mood (CSS classes in globals.css). */
const MOTION: Record<LumiMood, string> = {
  idle: "",
  welcome: "",
  ready: "lumi-tilt",
  thinking: "lumi-sway",
  speaking: "",
  discovery: "lumi-hop",
  happy: "lumi-bounce",
  unsure: "lumi-ponder",
  concerned: "lumi-droop",
  celebrate: "lumi-celebrate",
};

const GAZE: Record<LumiMood, [number, number]> = {
  idle: [0, 0],
  welcome: [0, 0],
  ready: [-1.5, 0.5],
  thinking: [2.6, -2.8],
  speaking: [0, 0.4],
  discovery: [0, -0.6],
  happy: [0, 0],
  unsure: [1.8, -1.2],
  concerned: [0, 1.4],
  celebrate: [0, 0],
};

const INK = "#141416";

function Face({ mood }: { mood: LumiMood }) {
  if (mood === "happy" || mood === "celebrate" || mood === "welcome") {
    return (
      <g fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round">
        <path d="M34 54 Q39 47.5 44 54" />
        <path d="M56 54 Q61 47.5 66 54" />
        <path d={mood === "celebrate" ? "M43.5 60.5 Q50 69.5 56.5 60.5 Z" : "M44.5 61.5 Q50 67.5 55.5 61.5"} strokeWidth={2.6} fill={mood === "celebrate" ? INK : "none"} />
      </g>
    );
  }
  const big = mood === "discovery";
  const curious = mood === "ready" || mood === "unsure";
  const rx = big ? 5.3 : 4.7;
  const ry = big ? 7 : 6.1;
  return (
    <>
      {mood === "unsure" && (
        <g fill="none" stroke={INK} strokeWidth={2.2} strokeLinecap="round">
          <path d="M33.5 42 Q39 39.5 44 41.5" />
          <path d="M56 40 Q61 37 66.5 39" />
        </g>
      )}
      {mood === "concerned" && (
        <g fill="none" stroke={INK} strokeWidth={2.2} strokeLinecap="round">
          <path d="M34 41 Q39 42.5 44 40" />
          <path d="M56 40 Q61 42.5 66 41" />
        </g>
      )}
      <g className={big ? "" : "lumi-blink"}>
        <ellipse cx={39} cy={52} rx={rx} ry={ry} fill={INK} />
        <ellipse cx={61} cy={52} rx={curious ? rx + 0.5 : rx} ry={curious ? ry + 0.7 : ry} fill={INK} />
        <circle cx={40.8} cy={49.4} r={1.7} fill="#fff" />
        <circle cx={62.8} cy={49.4} r={1.7} fill="#fff" />
      </g>
      {mood === "discovery" && <ellipse cx={50} cy={64} rx={2.6} ry={3} fill={INK} />}
      {mood === "ready" && <ellipse cx={50} cy={63.5} rx={1.8} ry={2} fill={INK} />}
      {mood === "unsure" && (
        <path d="M45 63.5 Q48 61.8 50 63.5 T55 63.5" fill="none" stroke={INK} strokeWidth={2.2} strokeLinecap="round" />
      )}
      {mood === "thinking" && (
        <path d="M46.5 63.5 Q50 64.4 53.5 63" fill="none" stroke={INK} strokeWidth={2.4} strokeLinecap="round" />
      )}
      {mood === "concerned" && (
        <path d="M45.5 64.5 Q50 61.8 54.5 64.5" fill="none" stroke={INK} strokeWidth={2.4} strokeLinecap="round" />
      )}
      {mood === "speaking" && <ellipse className="lumi-talk" cx={50} cy={63} rx={3} ry={2} fill={INK} />}
      {mood === "idle" && (
        <path d="M45.5 61.5 Q50 65.2 54.5 61.5" fill="none" stroke={INK} strokeWidth={2.4} strokeLinecap="round" />
      )}
    </>
  );
}

type Props = {
  mood?: LumiMood;
  size?: number;
  halo?: boolean;
  /** Ambient breathing. */
  float?: boolean;
  className?: string;
  label?: string;
};

export function Sidekick({ mood = "idle", size = 160, halo = true, float = true, className = "", label }: Props) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const h = HALO[mood];
  const [gx, gy] = GAZE[mood];
  const glow = INNER_GLOW[mood];
  // Small renders get a slightly larger face so expressions stay legible.
  const faceScale = size < 48 ? 1.14 : 1;
  const body = "M50 13 C70 13 84 25 86 46 C88 69 79 88 50 88 C21 88 12 69 14 46 C16 25 30 13 50 13 Z";
  const showDetails = size >= 40; // accessories are noise at avatar size

  return (
    <div
      role="img"
      aria-label={label ?? `Lumi, your accessibility companion, ${MOOD_LABEL[mood]}`}
      className={`relative shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      {halo && (
        <div
          aria-hidden
          className="absolute rounded-full transition-[opacity,transform] duration-700 ease-[var(--ease-ios)]"
          style={{ inset: -size * 0.22, opacity: h.opacity, transform: `scale(${h.scale})` }}
        >
          <div
            className={`iri-conic absolute inset-0 rounded-full ${mood === "thinking" || mood === "discovery" ? "animate-breathe" : ""}`}
            style={
              {
                filter: `blur(${Math.max(6, size * 0.18)}px)`,
                animationDuration: `${h.speed}s, 2.6s`,
                "--breathe-min": 0.6,
              } as CSSProperties
            }
          />
        </div>
      )}

      {(mood === "discovery" || mood === "celebrate") && (
        <div
          aria-hidden
          className="iri-conic animate-pulse-out absolute inset-[10%] rounded-full opacity-0"
          style={{ filter: `blur(${size * 0.06}px)` }}
        />
      )}

      <div key={mood} className={`absolute inset-0 ${MOTION[mood]}`}>
        <svg
          viewBox="0 0 100 100"
          width={size}
          height={size}
          aria-hidden
          className="lumi-svg overflow-visible"
          style={{ filter: `drop-shadow(0 ${size * 0.04}px ${size * 0.07}px rgba(0,0,0,0.18))` }}
        >
          <defs>
            <radialGradient id={`b-${uid}`} cx="38%" cy="28%" r="80%">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="0.6" stopColor="#f6f6f8" />
              <stop offset="1" stopColor="#d9d9de" />
            </radialGradient>
            <clipPath id={`c-${uid}`}>
              <path d={body} />
              <circle cx="31" cy="21" r="6.5" />
              <circle cx="69" cy="21" r="6.5" />
            </clipPath>
            <filter id={`g-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="7" />
            </filter>
            <filter id={`s-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="1.6" />
            </filter>
          </defs>

          <ellipse cx="50" cy="93" rx="24" ry="3.4" fill="rgba(0,0,0,0.16)" filter={`url(#s-${uid})`} />

          <g className={float ? "lumi-breathe" : ""}>
            {/* Waving nub */}
            {mood === "welcome" && showDetails && (
              <g className="lumi-wave">
                <ellipse cx="86" cy="52" rx="6" ry="9" fill={`url(#b-${uid})`} stroke="rgba(0,0,0,0.07)" strokeWidth="0.6" transform="rotate(-30 86 52)" />
              </g>
            )}

            {/* Ear nubs + body */}
            <circle cx="31" cy="21" r="6.5" fill={`url(#b-${uid})`} />
            <circle cx="69" cy="21" r="6.5" fill={`url(#b-${uid})`} />
            <path d={body} fill={`url(#b-${uid})`} stroke="rgba(0,0,0,0.07)" strokeWidth="0.6" />

            {/* Inner iridescent light */}
            <g clipPath={`url(#c-${uid})`} style={{ opacity: glow, transition: "opacity 700ms var(--ease-ios)" }}>
              <g className="lumi-glow" filter={`url(#g-${uid})`}>
                <circle cx="34" cy="74" r="16" fill="#8bb8ff" />
                <circle cx="62" cy="80" r="15" fill="#ffb6cf" />
                <circle cx="50" cy="66" r="12" fill="#b5a1ff" />
                <circle cx="72" cy="62" r="9" fill="#a8e8d5" />
              </g>
            </g>

            {/* Soft top highlight */}
            <ellipse cx="38" cy="25" rx="13" ry="5.5" fill="#fff" opacity="0.95" transform="rotate(-18 38 25)" filter={`url(#s-${uid})`} />

            {/* Cheeks */}
            <ellipse cx="29.5" cy="61" rx="5" ry="3" fill="#ffb6cf" opacity={mood === "happy" || mood === "celebrate" ? 0.75 : 0.42} />
            <ellipse cx="70.5" cy="61" rx="5" ry="3" fill="#ffb6cf" opacity={mood === "happy" || mood === "celebrate" ? 0.75 : 0.42} />

            <g
              style={{
                transform: `translate(${gx}px, ${gy}px) scale(${faceScale})`,
                transformOrigin: "50px 56px",
                transition: "transform 500ms var(--ease-spring)",
              }}
            >
              <Face mood={mood} />
            </g>
          </g>

          {/* Floating question mark while unsure */}
          {mood === "unsure" && showDetails && (
            <g className="lumi-qmark">
              <text x="80" y="22" fontSize="17" fontWeight="700" fill="currentColor" opacity="0.85" fontFamily="var(--font-sans)">
                ?
              </text>
            </g>
          )}

          {/* Sparkles when the walkthrough is complete */}
          {mood === "celebrate" && showDetails && (
            <g fill="#b5a1ff">
              {[
                [12, 20, 0],
                [88, 14, 0.4],
                [92, 46, 0.8],
                [6, 52, 1.1],
              ].map(([x, y, delay]) => (
                <path
                  key={`${x}-${y}`}
                  className="lumi-spark"
                  style={{ animationDelay: `${delay}s`, transformOrigin: `${x}px ${y}px` }}
                  d={`M${x} ${y - 5} Q${x + 1} ${y - 1} ${x + 5} ${y} Q${x + 1} ${y + 1} ${x} ${y + 5} Q${x - 1} ${y + 1} ${x - 5} ${y} Q${x - 1} ${y - 1} ${x} ${y - 5} Z`}
                />
              ))}
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}
