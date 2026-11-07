"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import * as api from "@/lib/session/api";
import * as E from "@/lib/session/engine";
import { runScanPipeline } from "@/lib/session/pipeline";
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
        const { result } = await api.compare(before, after, E.concernText(finding), run.controller.signal);
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

  /** In-flight photo preparations, started as soon as a photo is taken (outside the queue). */
  const preparing = useRef(new Map<string, Promise<void>>());

  /**
   * Prepare a photo (browser re-encode, or /api/preview for formats the browser can't decode) and
   * store its media. Doesn't touch session logic, so it can run while earlier scans are still processing.
   */
  const prepare = useCallback(
    (run: Run, scanId: string): Promise<void> => {
      const existing = preparing.current.get(scanId);
      if (existing) return existing;
      const task = (async () => {
        const file = sources.current.get(scanId);
        if (!file) throw new api.ApiClientError("GONE", "This photo is no longer available. Please scan again.", 0);
        const startedAt = Date.now();
        update(run, (s) => E.setStage(s, scanId, { id: "prepare", label: "Getting your photo ready", state: "active", startedAt }));
        const prepared = await api.prepareImage(file, run.controller.signal);
        // 640px keeps before/after views legible after the full image is released.
        const thumb = await api.makeThumbnail(prepared.blob, 640).catch(() => null);
        const media: ScanMedia = {
          imageBlob: prepared.blob,
          imageUrl: URL.createObjectURL(prepared.blob),
          thumbUrl: thumb ? URL.createObjectURL(thumb) : undefined,
        };
        if (!alive(run)) return revokeMedia({ [scanId]: media }); // session ended meanwhile
        store.set((st) => ({ ...st, media: { ...st.media, [scanId]: media } }));
        sources.current.delete(scanId);
        update(run, (s) =>
          E.setStage(s, scanId, {
            id: "prepare",
            state: "done",
            endedAt: Date.now(),
            timing: prepared.timing,
            note: prepared.via === "browser" ? "Prepared on this device" : "Converted on the server",
          }),
        );
      })();
      // Kept until processScan consumes it, so an early failure isn't re-requested a second time.
      preparing.current.set(scanId, task);
      return task;
    },
    [store, update, alive],
  );

  /** Analyze, check earlier areas and compare (see lib/session/pipeline.ts), then fold the result into the session. */
  const processScan = useCallback(
    async (run: Run, scanId: string) => {
      if (!blobOf(scanId)) {
        update(run, (s) => E.setStep(s, scanId, "preparing"));
        try {
          await prepare(run, scanId);
        } catch (err) {
          update(run, (s) => E.setStage(s, scanId, { id: "prepare", state: api.isAbort(err) ? "skipped" : "failed", endedAt: Date.now() }));
          return fail(run, scanId, err, "Couldn't prepare this photo.");
        } finally {
          preparing.current.delete(scanId); // a later "Try again" prepares afresh
        }
      }
      const blob = blobOf(scanId);
      if (!alive(run)) return;
      if (!blob) return update(run, (s) => E.setStep(s, scanId, "error", "This photo is no longer available. Please scan again.", false));

      update(run, (s) => E.setStep(s, scanId, "analyzing"));
      const lineUpScanId = store.get().session?.scans.find((x) => x.id === scanId)?.lineUpScanId;
      let result;
      try {
        result = await runScanPipeline(
          {
            session: () => store.get().session!,
            blobOf,
            analyze: (b, signal) => api.analyze(b, signal),
            match: (b, ctx, images, signal) => api.matchScene(b, ctx, images, signal),
            compare: (before, after, concern, signal) => api.compare(before, after, concern, signal),
            stage: (u) => update(run, (s) => E.setStage(s, scanId, u)),
          },
          scanId,
          blob,
          { signal: run.controller.signal, lineUpScanId },
        );
      } catch (err) {
        return fail(run, scanId, err, "Analysis failed.");
      }
      if (!alive(run)) return;

      update(run, (s) => {
        const withAnalysis = E.setAnalysis(s, scanId, result.analysis, result.model);
        return E.integrateScan(
          withAnalysis,
          scanId,
          {
            candidateScanIds: result.candidateScanIds,
            match: result.match,
            matchFailed: result.matchFailed,
            comparisons: result.comparisons,
            newFindingIds: result.analysis.findings.map(() => newId("f")),
            lineUpScanId: result.lineUpScanId,
          },
          Date.now(),
        );
      });
      pruneImages();
    },
    [store, blobOf, prepare, update, alive, fail, pruneImages],
  );

  /** Abort everything belonging to the current session and clear its media. */
  const teardown = useCallback(() => {
    runRef.current?.controller.abort();
    runRef.current = null;
    sources.current.clear();
    preparing.current.clear();
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

  /**
   * Start a scan. `lineUpScanId`: the earlier scan the user lined the photo up with in the camera
   * (its open findings are compared directly, skipping the scene-match request).
   */
  const scanFile = useCallback(
    (file: File, opts: { lineUpScanId?: string } = {}) => {
      if (!store.get().session) start();
      const run = currentRun()!;
      const scanId = newId("s");
      sources.current.set(scanId, file);
      const lineUpScanId = opts.lineUpScanId && store.get().session?.scans.some((x) => x.id === opts.lineUpScanId) ? opts.lineUpScanId : undefined;
      update(run, (s) => E.addScan(s, scanId, Date.now(), { lineUpScanId }));
      // Prepare right away (overlaps with earlier scans still in the queue); errors surface in processScan.
      prepare(run, scanId).catch(() => {});
      enqueue(run, () => processScan(run, scanId));
      return scanId;
    },
    [store, start, currentRun, update, prepare, enqueue, processScan],
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
      update(run, (s) => E.setStep(E.clearStages(s, scanId), scanId, "queued"));
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
