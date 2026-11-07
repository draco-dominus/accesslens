"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import * as api from "@/lib/session/api";
import * as E from "@/lib/session/engine";
import { loadSession, saveSession } from "@/lib/session/storage";
import type { Session } from "@/lib/session/types";

/**
 * Orchestrates a walkthrough: scan → analyze → (match earlier areas) → (compare open findings) → integrate.
 *
 * - Scans are processed one at a time in the order taken, so each one sees the previous results.
 *   The user can pick the next photo at any time; it simply waits in the queue.
 * - Every session has its own "run" (abort controller + queue). Starting over aborts in-flight requests,
 *   drops queued work, and any late result is discarded instead of touching the new session.
 * - Images are held in memory only, as normalized JPEG Blobs. Full images are released (object URLs
 *   revoked) once no open finding depends on them; thumbnails are kept for the timeline.
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
const message = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

function revokeMedia(media: Record<string, ScanMedia>) {
  for (const m of Object.values(media)) {
    if (m.imageUrl) URL.revokeObjectURL(m.imageUrl);
    if (m.thumbUrl) URL.revokeObjectURL(m.thumbUrl);
  }
}

function createStore() {
  const restoredSession = typeof window === "undefined" ? null : loadSession();
  let state: WalkthroughState = restoredSession ? { ...EMPTY, session: restoredSession, restored: true } : EMPTY;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(update: (s: WalkthroughState) => WalkthroughState) {
      const prev = state;
      state = update(state);
      if (state === prev) return;
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

/** One session's async work. Replaced (and aborted) whenever the session changes. */
type Run = { sessionId: string; controller: AbortController; queue: Promise<void> };

export function useWalkthrough() {
  const [store] = useState<Store>(createStore); // created once per mounted app
  const state = useSyncExternalStore(store.subscribe, store.get, () => EMPTY);

  const runRef = useRef<Run | null>(null);
  /** Original files kept until their photo is prepared, so "Try again" works even if preparing failed. */
  const sources = useRef(new Map<string, File>());

  /** The run for the current session (created lazily, e.g. for a session restored from storage). */
  const currentRun = useCallback((): Run | null => {
    const sessionId = store.get().session?.id;
    if (!sessionId) return null;
    if (runRef.current?.sessionId !== sessionId) {
      runRef.current?.controller.abort();
      runRef.current = { sessionId, controller: new AbortController(), queue: Promise.resolve() };
    }
    return runRef.current;
  }, [store]);

  const alive = useCallback(
    (run: Run) => runRef.current === run && store.get().session?.id === run.sessionId && !run.controller.signal.aborted,
    [store],
  );

  /** Update the session only if `run` still belongs to it; stale results are dropped. */
  const update = useCallback(
    (run: Run, fn: (s: Session) => Session) =>
      store.set((st) => (st.session && st.session.id === run.sessionId && runRef.current === run ? { ...st, session: fn(st.session) } : st)),
    [store],
  );

  const enqueue = useCallback(
    (run: Run, task: () => Promise<void>) => {
      run.queue = run.queue
        .then(() => (alive(run) ? task() : undefined))
        .catch((err) => {
          if (!api.isAbort(err)) console.error("[walkthrough]", err instanceof Error ? err.message : err);
        });
    },
    [alive],
  );

  const blobOf = useCallback((scanId: string) => store.get().media[scanId]?.imageBlob, [store]);

  /** Release full-size images no open finding (or pending question) depends on. Thumbnails stay. */
  const pruneImages = useCallback(() => {
    store.set((st) => {
      if (!st.session) return st;
      const keep = E.scansNeedingImages(st.session);
      let changed = false;
      const media = { ...st.media };
      for (const [id, m] of Object.entries(media)) {
        if (!keep.has(id) && m.imageUrl) {
          URL.revokeObjectURL(m.imageUrl);
          media[id] = { thumbUrl: m.thumbUrl };
          changed = true;
        }
      }
      return changed ? { ...st, media } : st;
    });
  }, [store]);

  const compareFinding = useCallback(
    async (run: Run, findingId: string, referenceScanId: string, newScanId: string): Promise<E.CompareOutcome> => {
      const finding = store.get().session?.findings.find((f) => f.id === findingId);
      const before = blobOf(referenceScanId);
      const after = blobOf(newScanId);
      if (!finding || !before || !after) return { findingId, referenceScanId, error: "Photo no longer available." };
      try {
        const result = await api.compare(before, after, E.concernText(finding), run.controller.signal);
        return { findingId, referenceScanId, result };
      } catch (err) {
        if (api.isAbort(err)) throw err;
        return { findingId, referenceScanId, error: message(err, "Comparison failed.") };
      }
    },
    [store, blobOf],
  );

  const fail = useCallback(
    (run: Run, scanId: string, err: unknown, fallback: string) => {
      if (api.isAbort(err) || !alive(run)) return;
      const retryable = err instanceof api.ApiClientError ? err.retryable : true;
      update(run, (s) => E.setStep(s, scanId, "error", message(err, fallback), retryable));
    },
    [alive, update],
  );

  /** Prepare (if needed), analyze, match and compare one scan, then fold it into the session. */
  const processScan = useCallback(
    async (run: Run, scanId: string) => {
      const signal = run.controller.signal;

      if (!blobOf(scanId)) {
        const file = sources.current.get(scanId);
        if (!file) return update(run, (s) => E.setStep(s, scanId, "error", "This photo is no longer available. Please scan again.", false));
        update(run, (s) => E.setStep(s, scanId, "preparing"));
        let media: ScanMedia;
        try {
          const prepared = await api.prepareImage(file, signal);
          // 640px keeps before/after views legible after the full image is released.
          const thumb = await api.makeThumbnail(prepared.blob, 640).catch(() => null);
          media = {
            imageBlob: prepared.blob,
            imageUrl: URL.createObjectURL(prepared.blob),
            thumbUrl: thumb ? URL.createObjectURL(thumb) : undefined,
          };
        } catch (err) {
          return fail(run, scanId, err, "Couldn't prepare this photo.");
        }
        if (!alive(run)) return revokeMedia({ [scanId]: media }); // session ended meanwhile
        store.set((st) => ({ ...st, media: { ...st.media, [scanId]: media } }));
        sources.current.delete(scanId);
      }
      const blob = blobOf(scanId)!;

      update(run, (s) => E.setStep(s, scanId, "analyzing"));
      let analysis, model;
      try {
        ({ analysis, model } = await api.analyze(blob, signal));
      } catch (err) {
        return fail(run, scanId, err, "Analysis failed.");
      }
      if (!alive(run)) return;
      update(run, (s) => E.setAnalysis(s, scanId, analysis, model));

      const session = store.get().session!;
      const candidates = analysis.imageUsable ? E.selectCandidates(session, scanId, (id) => Boolean(blobOf(id))) : [];
      let match = null;
      let matchFailed = false;
      let comparisons: E.CompareOutcome[] = [];
      if (candidates.length) {
        update(run, (s) => E.setStep(s, scanId, "matching"));
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
            signal,
          );
        } catch (err) {
          if (api.isAbort(err)) return;
          matchFailed = true; // the engine asks the user instead of guessing
        }
        if (!alive(run)) return;
        const sameArea = (match?.candidates ?? []).filter((c) => c.sameArea === "yes" || c.sameArea === "likely");
        const targets = E.comparisonTargets(store.get().session!, sameArea.map((c) => c.scanId));
        if (targets.length) {
          update(run, (s) => E.setStep(s, scanId, "comparing"));
          try {
            comparisons = await Promise.all(targets.map((t) => compareFinding(run, t.finding.id, t.referenceScanId, scanId)));
          } catch {
            return; // aborted
          }
        }
      }
      if (!alive(run)) return;

      update(run, (s) =>
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
    [store, blobOf, update, alive, fail, compareFinding, pruneImages],
  );

  /** Abort everything belonging to the current session and clear its media. */
  const teardown = useCallback(() => {
    runRef.current?.controller.abort();
    runRef.current = null;
    sources.current.clear();
    revokeMedia(store.get().media);
  }, [store]);

  const start = useCallback(() => {
    teardown();
    store.set(() => ({ ...EMPTY, session: E.createSession(newId("w"), Date.now()) }));
  }, [store, teardown]);

  const reset = useCallback(() => {
    teardown();
    store.set(() => EMPTY);
  }, [store, teardown]);

  const scanFile = useCallback(
    (file: File) => {
      if (!store.get().session) start();
      const run = currentRun()!;
      const scanId = newId("s");
      sources.current.set(scanId, file);
      update(run, (s) => E.addScan(s, scanId, Date.now()));
      enqueue(run, () => processScan(run, scanId));
      return scanId;
    },
    [store, start, currentRun, update, enqueue, processScan],
  );

  /** Whether "Try again" can work for this scan (we still have its photo, and the error isn't permanent). */
  const canRetry = useCallback(
    (scanId: string) => {
      const scan = state.session?.scans.find((s) => s.id === scanId);
      return Boolean(scan?.step === "error" && scan.errorRetryable !== false && (state.media[scanId]?.imageBlob || sources.current.has(scanId)));
    },
    [state],
  );

  const retryScan = useCallback(
    (scanId: string) => {
      const run = currentRun();
      const scan = store.get().session?.scans.find((s) => s.id === scanId);
      if (!run || scan?.step !== "error") return; // ignore double taps / non-failed scans
      update(run, (s) => E.setStep(s, scanId, "queued"));
      enqueue(run, () => processScan(run, scanId));
    },
    [store, currentRun, update, enqueue, processScan],
  );

  /** User says `scanId` revisits `earlierScanId`: re-check that scan's open findings with /api/compare. */
  const confirmRevisit = useCallback(
    (scanId: string, earlierScanId: string) => {
      const run = currentRun();
      if (!run) return;
      const setChecking = (on: boolean) => {
        if (store.get().session?.id === run.sessionId) store.set((st) => ({ ...st, checking: { ...st.checking, [scanId]: on } }));
      };
      setChecking(true);
      enqueue(run, async () => {
        try {
          const targets = E.openFindingsLastSeenIn(store.get().session!, earlierScanId).slice(0, E.MAX_COMPARISONS_PER_SCAN);
          const comparisons = await Promise.all(targets.map((f) => compareFinding(run, f.id, earlierScanId, scanId)));
          if (!alive(run)) return;
          update(run, (s) => E.applyUserRevisit(s, scanId, earlierScanId, comparisons, Date.now()));
          pruneImages();
        } finally {
          setChecking(false);
        }
      });
    },
    [store, currentRun, enqueue, compareFinding, alive, update, pruneImages],
  );

  const declineRevisit = useCallback(
    (scanId: string, earlierScanId: string) => {
      const run = currentRun();
      if (!run) return;
      update(run, (s) => E.declineRevisit(s, scanId, earlierScanId));
      pruneImages();
    },
    [currentRun, update, pruneImages],
  );

  /** User confirmed one specific suggested duplicate pair. */
  const confirmDuplicate = useCallback(
    (scanId: string, newFindingId: string, existingFindingId: string) => {
      const run = currentRun();
      if (run) update(run, (s) => E.confirmDuplicate(s, scanId, newFindingId, existingFindingId, Date.now()));
    },
    [currentRun, update],
  );

  const finish = useCallback(() => {
    const run = currentRun();
    if (run) update(run, (s) => E.finishSession(s, Date.now()));
  }, [currentRun, update]);
  const resume = useCallback(() => {
    const run = currentRun();
    if (run) update(run, (s) => ({ ...s, finishedAt: null }));
  }, [currentRun, update]);

  const manualRevisitOptions = useCallback(
    (scanId: string) => (state.session ? E.manualRevisitOptions(state.session, scanId, (id) => Boolean(state.media[id]?.imageBlob)) : []),
    [state],
  );

  const duplicateSuggestions = useCallback(
    (scanId: string) => (state.session ? E.duplicateSuggestions(state.session, scanId) : []),
    [state],
  );

  return {
    ...state,
    hasImage: (id: string) => Boolean(state.media[id]?.imageBlob),
    canRetry,
    start,
    scanFile,
    retryScan,
    confirmRevisit,
    declineRevisit,
    confirmDuplicate,
    duplicateSuggestions,
    manualRevisitOptions,
    finish,
    resume,
    reset,
  };
}
