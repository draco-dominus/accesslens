"use client";

import type { Session } from "./types";

/**
 * Local persistence for the latest inspection's structured data. Photos live separately in IndexedDB.
 * The legacy sessionStorage value is read once so existing in-progress walkthroughs are not lost.
 */

const KEY = "accesslens.walkthrough.v1";

export function loadSession(): Session | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // Some private modes expose localStorage but reject access.
  }
  if (!raw) {
    try {
      raw = sessionStorage.getItem(KEY);
    } catch {
      // Continue without persistence.
    }
  }
  try {
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (!s || !Array.isArray(s.scans) || !Array.isArray(s.findings)) return null;
    // Scans that were mid-flight when the page reloaded can't resume (their photo is gone).
    return {
      ...s,
      scans: s.scans.map((sc) =>
        sc.step === "done" || sc.step === "error"
          ? sc
          : { ...sc, step: "error", error: "This scan was interrupted when the page reloaded. Please scan again.", errorRetryable: false },
      ),
    };
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null): void {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
    sessionStorage.removeItem(KEY);
    return;
  } catch {
    // Fall back to this tab when durable storage is unavailable.
  }
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    // Storage unavailable (private mode, quota): the inspection still works in memory.
  }
}
