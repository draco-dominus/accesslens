"use client";

import type { Session } from "./types";

/**
 * Optional sessionStorage persistence (this tab only, cleared when it closes). Stores session
 * DATA only — never images — so a reload keeps findings but not photos.
 */

const KEY = "accesslens.walkthrough.v1";

export function loadSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (!s || !Array.isArray(s.scans) || !Array.isArray(s.findings)) return null;
    // Scans that were mid-flight when the page reloaded can't resume (their photo is gone).
    return {
      ...s,
      scans: s.scans.map((sc) =>
        sc.step === "done" || sc.step === "error"
          ? sc
          : { ...sc, step: "error", error: "This scan was interrupted when the page reloaded. Please scan again." },
      ),
    };
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null): void {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    // Storage unavailable (private mode, quota): the walkthrough still works in memory.
  }
}
