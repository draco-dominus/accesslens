"use client";

import { useId, useRef, useState } from "react";

/** A photo after server-side normalization: always a JPEG every browser can display. */
export type PickedPhoto = {
  fileName: string;
  blob: Blob; // normalized JPEG (what the AI sees); uploaded instead of the multi-MB original
  url: string; // object URL for <img>
  width: number;
  height: number;
  sourceFormat: string;
};

type Props = {
  label: string;
  value: PickedPhoto | null;
  onChange: (photo: PickedPhoto | null) => void;
};

/**
 * File input + preview. The original file is sent to /api/preview, which detects the real format
 * from its bytes, converts HEIC → JPEG, applies EXIF rotation and strips metadata. This makes
 * iPhone photos previewable in every browser, and the preview matches exactly what the AI analyzes.
 */
export function PhotoPicker({ label, value, onChange }: Props) {
  const inputId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0); // ignore stale responses if the user picks again quickly

  async function handleFile(file: File | undefined) {
    const seq = ++requestSeq.current;
    setError(null);
    if (value) URL.revokeObjectURL(value.url);
    onChange(null);
    if (!file) return;

    setBusy(true);
    try {
      const body = new FormData();
      body.append("image", file);
      const res = await fetch("/api/preview", { method: "POST", body });
      if (seq !== requestSeq.current) return;
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error?.message ?? `Couldn't prepare this photo (HTTP ${res.status}).`);
        return;
      }
      const blob = await res.blob();
      if (seq !== requestSeq.current) return;
      onChange({
        fileName: file.name,
        blob,
        url: URL.createObjectURL(blob),
        width: Number(res.headers.get("X-Image-Width")) || 0,
        height: Number(res.headers.get("X-Image-Height")) || 0,
        sourceFormat: res.headers.get("X-Source-Format") ?? "unknown",
      });
    } catch {
      if (seq === requestSeq.current) setError("Could not reach the server to prepare this photo.");
    } finally {
      if (seq === requestSeq.current) setBusy(false);
    }
  }

  return (
    <div>
      <label htmlFor={inputId} className="mb-1 block font-medium">
        {label}
      </label>
      <input
        id={inputId}
        type="file"
        // HEIC listed explicitly: some browsers otherwise grey out iPhone photos.
        accept="image/*,.heic,.heif"
        onChange={(e) => handleFile(e.target.files?.[0])}
        className="block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-blue-700 file:px-3 file:py-2 file:text-white"
      />
      <div aria-live="polite">
        {busy && <p className="mt-2 text-sm">Preparing preview…</p>}
        {error && (
          <p role="alert" className="mt-2 rounded border border-red-500 bg-red-50 p-2 text-sm text-red-900">
            {error}
          </p>
        )}
      </div>
      {value && (
        <figure className="mt-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
          <img src={value.url} alt={`${label} preview`} className="max-h-72 w-full rounded object-contain" />
          <figcaption className="mt-1 text-xs opacity-60">
            {value.fileName} · {value.sourceFormat.toUpperCase()} → JPEG {value.width}×{value.height}, location
            metadata removed
          </figcaption>
        </figure>
      )}
    </div>
  );
}
