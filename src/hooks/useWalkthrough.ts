"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";
import * as api from "@/lib/session/api";
import * as E from "@/lib/session/engine";
import { loadSession, saveSession } from "@/lib/session/storage";
import type { Session } from "@/lib/session/types";

/**
 * Orchestrates a walkthrough: scan → analyze → (match earlier areas) → (compare open findings) → integrate.
 *
 * - Scans are processed one at a time in the order taken, so each one sees the previous results.
 *   The user can pick the next photo at any time; it simply waits in the queue.
 * - Images are held in memory only, as normalized JPEG Blobs. Full images are released (object URLs
 *   revoked) once no open finding depends on them; small thumbnails are kept for the timeline.
 * - Session data (no images) is mirrored to sessionStorage.
 */

export type ScanMedia = { thumbUrl?: string; imageUrl?: string; imageBlob?: Blob };
export type WalkthroughState = {
  session: Session | null;
  media: Record<string, ScanMedia>;
  /** Scans currently re-checking an earlier area after the user's confirmation. */
  checking: Record<string, boolean>;
  restored: boolean; // session came from sessionStorage (photos not available)
};

const EMPTY: WalkthroughState = { session: null, media: {}, checking: {}, restored: false };
const newId = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

function createStore() {
  const restoredSession = typeof window === "undefined" ? null : loadSession();
  let state: WalkthroughState = restoredSession ? { ...EMPTY, session: restoredSession, restored: true } : EMPTY;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(update: (s: WalkthroughState) => WalkthroughState) {
      const prev = state;
      state = update(state);
      if (state.session !== prev.session) saveSession(state.session);
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}
type Store = ReturnType<typeof createStore>;

export function useWalkthrough() {
  const storeRef = useRef<Store | null>(null);
  storeRef.current ??= createStore();
  const store = storeRef.current;
  const state = useSyncExternalStore(store.subscribe, store.get, () => EMPTY);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const setSession = useCallback(
    (fn: (s: Session) => Session) => store.set((st) => (st.session ? { ...st, session: fn(st.session) } : st)),
    [store],
  );
  const session = () => store.get().session!;
  const blobOf = (scanId: string) => store.get().media[scanId]?.imageBlob;
  const hasImage = (scanId: string) => Boolean(blobOf(scanId));

  /** Release full-size images no open finding (or pending question) depends on. Thumbnails stay. */
  const pruneImages = useCallback(() => {
    store.set((st) => {
      if (!st.session) return st;
      const keep = E.scansNeedingImages(st.session);
      const media = { ...st.media };
      for (const [id, m] of Object.entries(media)) {
        if (!keep.has(id) && m.imageUrl) {
          URL.revokeObjectURL(m.imageUrl);
          media[id] = { thumbUrl: m.thumbUrl };
        }
      }
      return { ...st, media };
    });
  }, [store]);

  const compareFinding = useCallback(
    async (findingId: string, referenceScanId: string, newScanId: string): Promise<E.CompareOutcome> => {
      const finding = session().findings.find((f) => f.id === findingId)!;
      const before = blobOf(referenceScanId);
      const after = blobOf(newScanId);
      if (!before || !after) return { findingId, referenceScanId, error: "Photo no longer available." };
      try {
        return { findingId, referenceScanId, result: await api.compare(before, after, E.concernText(finding)) };
      } catch (err) {
        return { findingId, referenceScanId, error: err instanceof Error ? err.message : "Comparison failed." };
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store],
  );

  /** Analyze a prepared scan and fold it into the session. Also used for "Try again". */
  const analyzeAndIntegrate = useCallback(
    async (scanId: string) => {
      const blob = blobOf(scanId);
      if (!blob) {
        setSession((s) => E.setStep(s, scanId, "error", "This photo is no longer available. Please scan again."));
        return;
      }
      setSession((s) => E.setStep(s, scanId, "analyzing"));
      let analysis, model;
      try {
        ({ analysis, model } = await api.analyze(blob));
      } catch (err) {
        setSession((s) => E.setStep(s, scanId, "error", err instanceof Error ? err.message : "Analysis failed."));
        return;
      }
      setSession((s) => E.setAnalysis(s, scanId, analysis, model));

      const candidates = analysis.imageUsable ? E.selectCandidates(session(), scanId, hasImage) : [];
      let match = null;
      let matchFailed = false;
      let comparisons: E.CompareOutcome[] = [];
      if (candidates.length) {
        setSession((s) => E.setStep(s, scanId, "matching"));
        try {
          match = await api.matchScene(
            blob,
            {
              newFindings: analysis.findings.map(({ barrierType, title, locationInImage }) => ({ barrierType, title, locationInImage })),
              candidates: candidates.map((c) => ({
                scanId: c.scanId,
                findings: c.findings.map((f) => ({
                  id: f.id,
                  barrierType: f.details.barrierType,
                  title: f.details.title,
                  locationInImage: f.details.locationInImage,
                })),
              })),
            },
            new Map(candidates.map((c) => [c.scanId, blobOf(c.scanId)!])),
          );
        } catch (err) {
          console.warn("[walkthrough] scene match failed:", err);
          matchFailed = true;
        }
        const sameArea = (match?.candidates ?? []).filter((c) => c.sameArea === "yes" || c.sameArea === "likely");
        const targets = E.comparisonTargets(session(), sameArea.map((c) => c.scanId));
        if (targets.length) {
          setSession((s) => E.setStep(s, scanId, "comparing"));
          comparisons = await Promise.all(targets.map((t) => compareFinding(t.finding.id, t.referenceScanId, scanId)));
        }
      }

      setSession((s) =>
        E.integrateScan(
          s,
          scanId,
          {
            candidateScanIds: candidates.map((c) => c.scanId),
            match,
            matchFailed,
            comparisons,
            newFindingIds: analysis.findings.map(() => newId("f")),
          },
          Date.now(),
        ),
      );
      pruneImages();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setSession, compareFinding, pruneImages],
  );

  const enqueue = (task: () => Promise<void>) => {
    queue.current = queue.current.then(task).catch((err) => console.error("[walkthrough]", err));
  };

  const start = useCallback(() => {
    store.set(() => ({ ...EMPTY, session: E.createSession(newId("w"), Date.now()) }));
  }, [store]);

  const scanFile = useCallback(
    (file: File) => {
      if (!store.get().session) start();
      const scanId = newId("s");
      setSession((s) => E.addScan(s, scanId, Date.now()));
      enqueue(async () => {
        setSession((s) => E.setStep(s, scanId, "preparing"));
        try {
          const prepared = await api.prepareImage(file);
          // 640px keeps before/after views legible after the full image is released.
          const thumb = await api.makeThumbnail(prepared.blob, 640).catch(() => null);
          store.set((st) => ({
            ...st,
            media: {
              ...st.media,
              [scanId]: {
                imageBlob: prepared.blob,
                imageUrl: URL.createObjectURL(prepared.blob),
                thumbUrl: thumb ? URL.createObjectURL(thumb) : undefined,
              },
            },
          }));
        } catch (err) {
          setSession((s) => E.setStep(s, scanId, "error", err instanceof Error ? err.message : "Couldn't prepare this photo."));
          return;
        }
        await analyzeAndIntegrate(scanId);
      });
      return scanId;
    },
    [store, start, setSession, analyzeAndIntegrate],
  );

  const retryScan = useCallback(
    (scanId: string) => enqueue(() => analyzeAndIntegrate(scanId)),
    [analyzeAndIntegrate],
  );

  /** User says `scanId` revisits `earlierScanId`: re-check that scan's open findings with /api/compare. */
  const confirmRevisit = useCallback(
    (scanId: string, earlierScanId: string) => {
      store.set((st) => ({ ...st, checking: { ...st.checking, [scanId]: true } }));
      enqueue(async () => {
        const targets = E.openFindingsLastSeenIn(session(), earlierScanId).slice(0, E.MAX_COMPARISONS_PER_SCAN);
        const comparisons = await Promise.all(targets.map((f) => compareFinding(f.id, earlierScanId, scanId)));
        setSession((s) => E.applyUserRevisit(s, scanId, earlierScanId, comparisons, Date.now()));
        store.set((st) => ({ ...st, checking: { ...st.checking, [scanId]: false } }));
        pruneImages();
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, setSession, compareFinding, pruneImages],
  );

  const declineRevisit = useCallback(
    (scanId: string, earlierScanId: string) => {
      setSession((s) => E.declineRevisit(s, scanId, earlierScanId));
      pruneImages();
    },
    [setSession, pruneImages],
  );

  const finish = useCallback(() => setSession((s) => E.finishSession(s, Date.now())), [setSession]);
  const resume = useCallback(() => setSession((s) => ({ ...s, finishedAt: null })), [setSession]);

  const reset = useCallback(() => {
    for (const m of Object.values(store.get().media)) {
      if (m.imageUrl) URL.revokeObjectURL(m.imageUrl);
      if (m.thumbUrl) URL.revokeObjectURL(m.thumbUrl);
    }
    store.set(() => EMPTY);
  }, [store]);

  const manualRevisitOptions = useCallback(
    (scanId: string) => (state.session ? E.manualRevisitOptions(state.session, scanId, (id) => Boolean(state.media[id]?.imageBlob)) : []),
    [state],
  );

  return {
    ...state,
    hasImage: (id: string) => Boolean(state.media[id]?.imageBlob),
    start,
    scanFile,
    retryScan,
    confirmRevisit,
    declineRevisit,
    manualRevisitOptions,
    finish,
    resume,
    reset,
  };
}
