"use client";

import type { ScanMedia } from "@/hooks/useWalkthrough";
import { STATUS_LABEL, walkthroughSummary } from "@/lib/session/lumi";
import type { Session, TrackedFinding } from "@/lib/session/types";
import { Sidekick } from "../lumi/Sidekick";
import { ChevronLeft, Print } from "../ui/Icons";
import { Button } from "../ui/primitives";
import { StatusTag } from "../ui/Tags";

export function InspectionReport({ session, media, onBack }: { session: Session; media: Record<string, ScanMedia>; onBack: () => void }) {
  const summary = walkthroughSummary(session);
  const date = new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeStyle: "short" }).format(new Date(session.startedAt));

  return (
    <div className="report-screen no-scrollbar h-full overflow-y-auto bg-bg px-4 pt-[calc(var(--safe-top)+68px)] pb-[calc(var(--safe-bottom)+28px)] text-fg">
      <div className="no-print flex items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="pressable inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-[15px] font-semibold">
          <ChevronLeft size={18} /> Back
        </button>
        <Button size="md" onClick={() => window.print()} icon={<Print size={17} />}>
          Print or save PDF
        </Button>
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
  const photoIds = [...new Set([finding.firstScanId, latestEvent?.scanId].filter((id): id is string => Boolean(id)))];
  const photos = photoIds.flatMap((id) => {
    const scan = session.scans.find((item) => item.id === id);
    const url = media[id]?.imageUrl ?? media[id]?.thumbUrl;
    return scan && url ? [{ id, number: scan.number, url }] : [];
  });

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
