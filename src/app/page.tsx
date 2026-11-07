"use client";

import Link from "next/link";
import { useState } from "react";
import { PhotoPicker, type PickedPhoto } from "@/components/PhotoPicker";
import type { AnalyzeResponse, Finding } from "@/lib/analysis-schema";

const TYPE_LABELS: Record<Finding["barrierType"], string> = {
  steps: "Steps / level change",
  obstructed_walkway: "Obstructed walkway",
  protruding_obstacle: "Protruding obstacle",
  other: "Other",
};

export default function Home() {
  const [photo, setPhoto] = useState<PickedPhoto | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  async function analyze() {
    if (!photo) return;
    setLoading(true);
    setResult(null);
    try {
      const body = new FormData();
      body.append("image", photo.blob, "photo.jpg");
      const res = await fetch("/api/analyze", { method: "POST", body });
      const data = (await res.json().catch(() => null)) as AnalyzeResponse | null;
      setResult(
        data ?? { ok: false, error: { code: `HTTP_${res.status}`, message: "Server returned an unreadable response." } },
      );
    } catch {
      setResult({ ok: false, error: { code: "NETWORK", message: "Could not reach the server." } });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-xl flex-1 p-4 font-sans">
      <h1 className="text-2xl font-bold">AccessLens</h1>
      <p className="mb-2 text-sm opacity-70">Image analysis proof of concept</p>
      <nav className="mb-4 text-sm">
        <Link href="/compare" className="underline">
          Check a fix with before &amp; after photos →
        </Link>
      </nav>

      <PhotoPicker
        label="Photo of an entrance, walkway, or space"
        value={photo}
        onChange={(p) => {
          setPhoto(p);
          setResult(null);
        }}
      />

      <button
        onClick={analyze}
        disabled={!photo || loading}
        className="mt-4 w-full rounded bg-blue-700 px-4 py-3 font-semibold text-white disabled:opacity-50"
      >
        {loading ? "Analyzing… (can take 10–30s)" : "Analyze photo"}
      </button>

      <div aria-live="polite" className="mt-6">
        {result && !result.ok && (
          <div role="alert" className="rounded border border-red-500 bg-red-50 p-3 text-red-900">
            <strong>Error ({result.error.code}):</strong> {result.error.message}
          </div>
        )}

        {result?.ok && (
          <section className="space-y-4">
            <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">{result.disclaimer}</p>
            <p className="text-xs opacity-60">Model: {result.model}</p>

            {!result.analysis.imageUsable && (
              <p className="rounded border border-amber-500 p-3">⚠️ The image could not be fully assessed.</p>
            )}

            <div>
              <h2 className="font-semibold">What the AI sees</h2>
              <p>{result.analysis.sceneSummary}</p>
            </div>

            <h2 className="font-semibold">
              Potential barriers ({result.analysis.findings.length})
            </h2>
            {result.analysis.findings.length === 0 && (
              <p className="text-sm">
                No potential barriers were identified in the visible area. This does not mean the space is accessible.
              </p>
            )}
            <ol className="space-y-3">
              {result.analysis.findings.map((f, i) => (
                <li key={i} className="rounded border border-zinc-300 p-3 dark:border-zinc-700">
                  <div className="text-xs uppercase tracking-wide opacity-70">
                    {TYPE_LABELS[f.barrierType]} · {f.confidence} confidence
                  </div>
                  <h3 className="font-semibold">{f.title}</h3>
                  <dl className="mt-2 space-y-1 text-sm">
                    <Row label="Where">{f.locationInImage}</Row>
                    <Row label="Visual evidence">{f.visualEvidence}</Row>
                    <Row label="Who may be affected">{f.whoMayBeAffected.join(", ")}</Row>
                    <Row label="Potential impact">{f.potentialImpact}</Row>
                    <Row label="Suggested improvement">{f.suggestedImprovement}</Row>
                    <Row label="Uncertainty">{f.uncertainty}</Row>
                  </dl>
                </li>
              ))}
            </ol>

            <div>
              <h2 className="font-semibold">Limitations</h2>
              <p className="text-sm">{result.analysis.limitations}</p>
            </div>
          </section>
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
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="inline font-medium">{label}: </dt>
      <dd className="inline">{children}</dd>
    </div>
  );
}
