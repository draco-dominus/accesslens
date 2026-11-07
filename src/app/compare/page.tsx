"use client";

import Link from "next/link";
import { useState } from "react";
import { BeforeAfterSlider } from "@/components/BeforeAfterSlider";
import { PhotoPicker, type PickedPhoto } from "@/components/PhotoPicker";
import type { AnalyzeResponse, Finding } from "@/lib/analysis-schema";
import { MAX_CONCERN_LENGTH, type CompareResponse, type ComparisonStatus } from "@/lib/comparison-schema";

const STATUS_UI: Record<ComparisonStatus, { label: string; icon: string; className: string }> = {
  improved: { label: "Appears improved", icon: "✓", className: "border-green-700 bg-green-50 text-green-900" },
  still_present: { label: "Still present", icon: "✕", className: "border-red-700 bg-red-50 text-red-900" },
  uncertain: { label: "Can't verify from these photos", icon: "?", className: "border-amber-600 bg-amber-50 text-amber-900" },
};

const VISIBILITY = { yes: "Yes", partially: "Partially", no: "No" } as const;

export default function ComparePage() {
  const [before, setBefore] = useState<PickedPhoto | null>(null);
  const [after, setAfter] = useState<PickedPhoto | null>(null);
  const [concern, setConcern] = useState("");

  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [findingsState, setFindingsState] = useState<"idle" | "loading" | "error">("idle");
  const [findingsError, setFindingsError] = useState("");

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CompareResponse | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  async function findBarriers() {
    if (!before) return;
    setFindingsState("loading");
    setFindings(null);
    try {
      const body = new FormData();
      body.append("image", before.blob, "before.jpg");
      const res = await fetch("/api/analyze", { method: "POST", body });
      const data = (await res.json().catch(() => null)) as AnalyzeResponse | null;
      if (data?.ok) {
        setFindings(data.analysis.findings);
        setFindingsState("idle");
      } else {
        setFindingsError(data?.error.message ?? `HTTP ${res.status}`);
        setFindingsState("error");
      }
    } catch {
      setFindingsError("Could not reach the server.");
      setFindingsState("error");
    }
  }

  async function compare() {
    if (!before || !after || !concern.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const body = new FormData();
      body.append("before", before.blob, "before.jpg");
      body.append("after", after.blob, "after.jpg");
      body.append("concern", concern.trim());
      const res = await fetch("/api/compare", { method: "POST", body });
      const data = (await res.json().catch(() => null)) as CompareResponse | null;
      setResult(data ?? { ok: false, error: { code: `HTTP_${res.status}`, message: "Server returned an unreadable response." } });
    } catch {
      setResult({ ok: false, error: { code: "NETWORK", message: "Could not reach the server." } });
    } finally {
      setLoading(false);
    }
  }

  const ready = before && after && concern.trim().length > 0 && !loading;

  return (
    <main className="mx-auto w-full max-w-xl flex-1 p-4 font-sans">
      <nav className="mb-2 text-sm">
        <Link href="/" className="underline">
          ← AccessLens (developer comparison tool)
        </Link>
      </nav>
      <h1 className="text-2xl font-bold">Before &amp; after check</h1>
      <p className="mb-4 text-sm opacity-70">
        Check whether one specific barrier looks better after a fix. For best results, take the AFTER photo from the same
        spot and angle as the BEFORE photo.
      </p>

      <div className="space-y-6">
        <section>
          <h2 className="mb-2 font-semibold">1. Before photo</h2>
          <PhotoPicker
            label="BEFORE photo"
            value={before}
            onChange={(p) => {
              setBefore(p);
              setFindings(null);
              setFindingsState("idle");
              setResult(null);
            }}
          />
        </section>

        <section>
          <h2 className="mb-2 font-semibold">2. Barrier to check</h2>
          <label htmlFor="concern" className="mb-1 block text-sm">
            Describe the barrier, or pick one the AI found in the BEFORE photo.
          </label>
          <textarea
            id="concern"
            value={concern}
            maxLength={MAX_CONCERN_LENGTH}
            onChange={(e) => {
              setConcern(e.target.value);
              setResult(null);
            }}
            rows={3}
            placeholder="e.g. Chair blocking the walkway between the counter and the door"
            className="w-full rounded border border-zinc-400 p-2"
          />
          <button
            onClick={findBarriers}
            disabled={!before || findingsState === "loading"}
            className="mt-2 rounded border border-blue-700 px-3 py-2 text-sm text-blue-800 disabled:opacity-50 dark:text-blue-300"
          >
            {findingsState === "loading" ? "Looking for barriers…" : "Find barriers in BEFORE photo"}
          </button>
          <div aria-live="polite">
            {findingsState === "error" && (
              <p role="alert" className="mt-2 text-sm text-red-700">
                {findingsError}
              </p>
            )}
            {findings && findings.length === 0 && (
              <p className="mt-2 text-sm">No barriers found in the BEFORE photo. You can still describe one yourself.</p>
            )}
            {findings && findings.length > 0 && (
              <fieldset className="mt-2 space-y-1">
                <legend className="text-sm">Use a finding as the barrier to check:</legend>
                {findings.map((f, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setConcern(`${f.title}. ${f.locationInImage}. ${f.visualEvidence}`.slice(0, MAX_CONCERN_LENGTH));
                      setResult(null);
                    }}
                    className="block w-full rounded border border-zinc-300 p-2 text-left text-sm dark:border-zinc-700"
                  >
                    <strong>{f.title}</strong> <span className="opacity-70">({f.locationInImage})</span>
                  </button>
                ))}
              </fieldset>
            )}
          </div>
        </section>

        <section>
          <h2 className="mb-2 font-semibold">3. After photo</h2>
          <PhotoPicker
            label="AFTER photo"
            value={after}
            onChange={(p) => {
              setAfter(p);
              setResult(null);
            }}
          />
        </section>

        <button
          onClick={compare}
          disabled={!ready}
          className="w-full rounded bg-blue-700 px-4 py-3 font-semibold text-white disabled:opacity-50"
        >
          {loading ? "Comparing… (can take 10–40s)" : "Compare photos"}
        </button>
      </div>

      <div aria-live="polite" className="mt-6">
        {result && !result.ok && (
          <div role="alert" className="rounded border border-red-500 bg-red-50 p-3 text-red-900">
            <strong>Error ({result.error.code}):</strong> {result.error.message}
          </div>
        )}

        {result?.ok && (
          <ComparisonResult result={result} />
        )}

        {result && (
          <div className="mt-4">
            <button onClick={() => setShowRaw((v) => !v)} className="text-sm underline">
              {showRaw ? "Hide" : "Show"} raw JSON
            </button>
            {showRaw && (
              <pre className="mt-2 overflow-x-auto rounded bg-zinc-100 p-3 text-xs dark:bg-zinc-900">
                {JSON.stringify(result, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>

      {before && after && (
        <section className="mt-6">
          <h2 className="mb-2 font-semibold">Compare visually</h2>
          <BeforeAfterSlider before={before} after={after} />
        </section>
      )}
    </main>
  );
}

function ComparisonResult({ result }: { result: Extract<CompareResponse, { ok: true }> }) {
  const c = result.comparison;
  const s = STATUS_UI[c.status];
  return (
    <section className="space-y-4">
      <div className={`rounded border-2 p-3 ${s.className}`}>
        <div className="text-lg font-bold">
          <span aria-hidden>{s.icon} </span>
          {s.label}
        </div>
        {c.status !== "uncertain" && <div className="text-sm">{c.confidence} confidence</div>}
      </div>

      {result.guardrail && (
        <div className="rounded border border-amber-600 p-3 text-sm">
          <strong>Safety check adjusted this result</strong> (AI said: {STATUS_UI[result.guardrail.modelStatus].label}
          ):
          <ul className="mt-1 list-disc pl-5">
            {result.guardrail.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">{result.disclaimer}</p>
      <p className="text-xs opacity-60">Model: {result.model}</p>

      <dl className="space-y-2 text-sm">
        <Row label="Original barrier">{c.originalBarrier}</Row>
        <Row label="Observed change">{c.observedChange}</Row>
        <Row label="Visual evidence">
          <ul className="list-disc pl-5">
            {c.visualEvidence.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </Row>
        <Row label="Remaining uncertainty">{c.remainingUncertainty}</Row>
        <Row label="Suggested next action">{c.suggestedNextAction}</Row>
      </dl>

      <details className="text-sm">
        <summary className="cursor-pointer">How the photos were checked</summary>
        <dl className="mt-2 space-y-1">
          <Row label="Barrier visible in BEFORE">{VISIBILITY[c.beforeBarrierVisible]}</Row>
          <Row label="Same area visible in AFTER">{VISIBILITY[c.afterAreaVisible]}</Row>
          <Row label="Same location">{c.sameLocation}</Row>
          <Row label="Camera viewpoint">{c.viewpoint}</Row>
          <Row label="Location evidence">{c.locationEvidence}</Row>
        </dl>
      </details>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-medium">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
