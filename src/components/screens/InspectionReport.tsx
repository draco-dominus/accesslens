"use client";

import { useState } from "react";
import type { ScanMedia } from "@/hooks/useWalkthrough";
import { reportPhotoIds, reportPhotoStatus } from "@/lib/session/report";
import { STATUS_LABEL, walkthroughSummary } from "@/lib/session/lumi";
import type { Session, TrackedFinding } from "@/lib/session/types";
import { Sidekick } from "../lumi/Sidekick";
import { ChevronLeft, Print } from "../ui/Icons";
import { Button } from "../ui/primitives";
import { StatusTag } from "../ui/Tags";

export function InspectionReport({
  session,
  media,
  photoRestore,
  onBack,
}: {
  session: Session;
  media: Record<string, ScanMedia>;
  photoRestore: "idle" | "loading" | "ready" | "unavailable";
  onBack: () => void;
}) {
  const summary = walkthroughSummary(session);
  const photos = reportPhotoStatus(session, (id) => Boolean(media[id]?.imageUrl ?? media[id]?.thumbUrl), photoRestore);
  const [printing, setPrinting] = useState(false);
  const list = (ns: number[]) => (ns.length === 1 ? `scan ${ns[0]}` : `scans ${ns.slice(0, -1).join(", ")} and ${ns.at(-1)}`);

  /** Print only once every photo in the report has actually decoded (restored blobs can lag a moment). */
  const exportPdf = async () => {
    if (photos.state === "restoring" || printing) return;
    setPrinting(true);
    try {
      const imgs = [...document.querySelectorAll<HTMLImageElement>(".report-screen img")];
      await Promise.all(imgs.map((img) => (img.complete && img.naturalWidth ? null : img.decode().catch(() => null))));
      window.print();
    } finally {
      setPrinting(false);
    }
  };
  const date = new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeStyle: "short" }).format(new Date(session.startedAt));

  return (
    <div className="report-screen no-scrollbar h-full overflow-y-auto bg-bg px-4 pt-[calc(var(--safe-top)+8px)] pb-[calc(var(--safe-bottom)+28px)] text-fg">
      <div className="no-print flex items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="pressable inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-[15px] font-semibold">
          <ChevronLeft size={18} /> Back
        </button>
        <Button size="md" onClick={exportPdf} disabled={photos.state === "restoring" || printing} icon={<Print size={17} />}>
          {photos.state === "restoring" ? "Restoring photos…" : printing ? "Preparing…" : "Download PDF"}
        </Button>
      </div>
      <div className="no-print" aria-live="polite">
        {photos.state === "restoring" && (
          <p className="mt-2 rounded-2xl bg-surface-2 px-3 py-2 text-[13px] leading-snug">Loading this inspection’s photos from your device. The PDF will be ready in a moment.</p>
        )}
        {photos.state === "missing" && (
          <p role="alert" className="mt-2 rounded-2xl bg-[color-mix(in_srgb,var(--color-caution)_16%,transparent)] px-3 py-2 text-[13px] leading-snug">
            The photo{photos.missingScanNumbers.length > 1 ? "s" : ""} from {list(photos.missingScanNumbers)} {photos.missingScanNumbers.length > 1 ? "aren’t" : "isn’t"} available on this device. The PDF will include those findings and say the photo is missing.
          </p>
        )}
        <p className="mt-2 px-2 text-right text-[12px] leading-snug text-muted">Opens the print sheet: choose Save as PDF. On iPhone, use Share, then Save to Files.</p>
      </div>

      <header className="mt-5 border-b border-line pb-6 print:mt-0">
        <div className="flex items-start gap-4">
          <Sidekick mood={summary.improved.length ? "happy" : "speaking"} size={62} halo={false} />
          <div>
            <p className="text-[13px] font-semibold tracking-[0.06em] text-muted uppercase">AccessLens inspection</p>
            <h1 className="mt-1 text-[32px] leading-tight font-semibold tracking-[-0.035em]">Photo inspection report</h1>
            <p className="mt-1 text-[14px] text-muted">Started {date}</p>
          </div>
        </div>
        <p className="mt-5 text-[15px] leading-relaxed">This report records potential accessibility barriers observed in submitted photos. It is an awareness aid, not a professional assessment, measurement, compliance determination or certification.</p>
        <dl className="mt-4 grid grid-cols-4 divide-x divide-line rounded-[20px] bg-surface py-3 text-center shadow-[var(--shadow-soft)]">
          {[["Scans", summary.scans], ["Areas", summary.areas], ["Open", summary.unresolved.length + summary.needsVerification.length], ["Improved", summary.improved.length]].map(([label, value]) => (
            <div key={label} className="flex flex-col-reverse px-1"><dt className="mt-1 text-[11px] text-muted">{label}</dt><dd className="text-[20px] font-semibold">{value}</dd></div>
          ))}
        </dl>
      </header>

      <main>
        {session.findings.length ? (
          <ol className="space-y-5 pt-5">
            {session.findings.map((finding) => <ReportFinding key={finding.id} session={session} finding={finding} media={media} />)}
          </ol>
        ) : (
          <section className="mt-5 rounded-[24px] bg-surface p-5 shadow-[var(--shadow-soft)]">
            <h2 className="text-[18px] font-semibold">No potential barriers recorded</h2>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">The photos did not produce a finding in the supported categories. This does not confirm that the space is accessible; photos cannot show every barrier or provide reliable measurements.</p>
          </section>
        )}

        <section className="mt-6 break-inside-avoid rounded-[24px] bg-surface p-5 shadow-[var(--shadow-soft)]">
          <h2 className="text-[18px] font-semibold">Inspection limitations</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[14px] leading-relaxed text-muted">
            {session.scans.flatMap((scan) => scan.analysis?.limitations ? [`Scan ${scan.number}: ${scan.analysis.limitations}`] : []).map((limitation) => <li key={limitation}>{limitation}</li>)}
            <li>Photos cannot establish exact dimensions, slopes, clearances, permanence, or compliance with an accessibility standard.</li>
            <li>Confirm findings in person and involve accessibility professionals and people with disabilities for decisions.</li>
          </ul>
        </section>
      </main>
    </div>
  );
}

function ReportFinding({ session, finding, media }: { session: Session; finding: TrackedFinding; media: Record<string, ScanMedia> }) {
  const d = finding.details;
  const latestEvent = finding.history.at(-1);
  const expected = reportPhotoIds(finding).flatMap((id) => {
    const scan = session.scans.find((item) => item.id === id);
    return scan ? [{ id, number: scan.number, url: media[id]?.imageUrl ?? media[id]?.thumbUrl }] : [];
  });
  const photos = expected.filter((p): p is typeof p & { url: string } => Boolean(p.url));
  const missing = expected.filter((p) => !p.url);

  return (
    <li className="break-inside-avoid rounded-[26px] bg-surface p-5 shadow-[var(--shadow-soft)]">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-[15px] font-bold text-on-primary">{finding.number}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] leading-snug font-semibold tracking-[-0.02em]">{d.title}</h2>
          <div className="mt-1.5"><StatusTag status={finding.status} /></div>
        </div>
      </div>

      {photos.length > 0 && (
        <div className={`mt-4 grid gap-2 ${photos.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
          {photos.map((photo) => (
            <figure key={photo.id} className="overflow-hidden rounded-[18px] bg-black">
              {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
              <img src={photo.url} alt={`Scan ${photo.number} evidence for ${d.title}`} className="aspect-[4/3] w-full object-contain" />
              <figcaption className="bg-black px-3 py-1.5 text-[12px] font-medium text-white">Scan {photo.number}</figcaption>
            </figure>
          ))}
        </div>
      )}

      {missing.length > 0 && (
        <p className="mt-3 text-[12px] leading-snug text-muted">
          Photo from {missing.map((p) => `scan ${p.number}`).join(" and ")} not available on this device.
        </p>
      )}

      <dl className="mt-4 space-y-3 text-[14px] leading-relaxed">
        <ReportField label="Observed evidence">{d.visualEvidence} Location described as {d.locationInImage}.</ReportField>
        {latestEvent && latestEvent.scanId !== finding.firstScanId && <ReportField label={`Latest status — ${STATUS_LABEL[latestEvent.status]}`}>{latestEvent.note}</ReportField>}
        <ReportField label="Potential accessibility implication">{d.potentialImpact}</ReportField>
        <ReportField label="Suggested action">{d.suggestedImprovement}</ReportField>
        <ReportField label="Uncertainty and limitations">{d.uncertainty}</ReportField>
      </dl>
      <p className="mt-3 text-[12px] text-muted">AI confidence for the original observation: {d.confidence}. Verify in person.</p>
    </li>
  );
}

function ReportField({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="font-semibold">{label}</dt><dd className="mt-0.5 text-muted">{children}</dd></div>;
}
