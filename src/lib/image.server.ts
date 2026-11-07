import "server-only";

import decodeHeic from "heic-decode";
import sharp from "sharp";

/**
 * Untrusted-upload normalization. Every image that reaches the model or a preview goes through
 * `normalizeImage`, which:
 *  - identifies the format from the file's magic bytes (the browser-supplied MIME type and
 *    filename are ignored, so mislabeled or disguised files can't slip through),
 *  - decodes HEIC/HEIF (iPhone photos) with libheif (WASM), everything else with sharp,
 *  - applies EXIF orientation, flattens transparency, downsizes to MAX_EDGE,
 *  - re-encodes as baseline JPEG with ALL metadata stripped (incl. GPS location).
 * The output is always a freshly encoded `image/jpeg`, so the MIME type we send is always correct.
 */

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // phones' full-res JPEG/HEIC fit; output is far smaller
const MAX_INPUT_PIXELS = 50_000_000; // ~48 MP iPhone photos fit; rejects decompression bombs
const MAX_EDGE = 1600; // plenty for barrier detection; keeps model requests small

export type SourceFormat = "jpeg" | "png" | "webp" | "heic" | "avif";

export type NormalizedImage = {
  data: Buffer;
  mimeType: "image/jpeg";
  width: number;
  height: number;
  sourceFormat: SourceFormat;
};

export class ImageError extends Error {
  constructor(
    public code: "NO_IMAGE" | "EMPTY_IMAGE" | "IMAGE_TOO_LARGE" | "UNSUPPORTED_TYPE" | "DECODE_FAILED",
    message: string,
    public httpStatus: number,
  ) {
    super(message);
  }
}

const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);
const AVIF_BRANDS = new Set(["avif", "avis"]);

/** Identify the real format from the file signature. Returns null for anything unsupported. */
export function sniffFormat(buf: Buffer): SourceFormat | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (buf.toString("ascii", 4, 8) === "ftyp") {
    // ISO-BMFF: check the major brand and the compatible brands list.
    const boxSize = Math.min(buf.readUInt32BE(0), buf.length);
    const brands = [buf.toString("ascii", 8, 12)];
    for (let i = 16; i + 4 <= boxSize; i += 4) brands.push(buf.toString("ascii", i, i + 4));
    if (brands.some((b) => AVIF_BRANDS.has(b)) && !brands.some((b) => b === "heic" || b === "heix")) return "avif";
    if (brands.some((b) => HEIF_BRANDS.has(b))) return "heic";
  }
  return null;
}

async function decodeHeicToSharp(buf: Buffer): Promise<ReturnType<typeof sharp>> {
  const images = await decodeHeic.all({ buffer: buf });
  try {
    const primary = images[0];
    if (!primary) throw new Error("no image in HEIF container");
    if (primary.width * primary.height > MAX_INPUT_PIXELS) {
      throw new ImageError("IMAGE_TOO_LARGE", "Image resolution is too large.", 413);
    }
    // display() applies the HEIF rotation/mirror transforms, so output is upright.
    const { width, height, data } = await primary.decode();
    return sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), {
      raw: { width, height, channels: 4 },
    });
  } finally {
    images.dispose();
  }
}

export async function normalizeImage(buf: Buffer, opts: { maxEdge?: number } = {}): Promise<NormalizedImage> {
  const maxEdge = Math.min(opts.maxEdge ?? MAX_EDGE, MAX_EDGE);
  if (buf.length === 0) throw new ImageError("EMPTY_IMAGE", "The uploaded file is empty.", 400);
  if (buf.length > MAX_UPLOAD_BYTES) {
    throw new ImageError("IMAGE_TOO_LARGE", "Image is larger than 20 MB. Please upload a smaller photo.", 413);
  }

  const sourceFormat = sniffFormat(buf);
  if (!sourceFormat) {
    throw new ImageError(
      "UNSUPPORTED_TYPE",
      "This file isn't a supported image. Use a JPEG, PNG, WebP, HEIC (iPhone), or AVIF photo.",
      415,
    );
  }

  try {
    const pipeline =
      sourceFormat === "heic"
        ? await decodeHeicToSharp(buf)
        : sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" }).rotate(); // EXIF orientation

    const { data, info } = await pipeline
      .resize(maxEdge, maxEdge, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85 })
      .toBuffer({ resolveWithObject: true }); // sharp drops all metadata unless asked to keep it

    return { data, mimeType: "image/jpeg", width: info.width, height: info.height, sourceFormat };
  } catch (err) {
    if (err instanceof ImageError) throw err;
    if (err instanceof Error && /pixel limit/i.test(err.message)) {
      throw new ImageError("IMAGE_TOO_LARGE", "Image resolution is too large.", 413);
    }
    console.warn(`[image] failed to decode ${sourceFormat}:`, err instanceof Error ? err.message : err);
    throw new ImageError("DECODE_FAILED", "We couldn't read this image. It may be corrupted. Try another photo.", 422);
  }
}

/** Read a multipart field, verify it is a file, and normalize it. */
export async function readImageField(
  form: FormData,
  field: string,
  label = field,
  opts: { maxEdge?: number } = {},
): Promise<NormalizedImage> {
  const file = form.get(field);
  if (!(file instanceof File)) {
    throw new ImageError("NO_IMAGE", `No ${label} image uploaded (expected form field '${field}').`, 400);
  }
  // Check size before buffering the whole file.
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ImageError("IMAGE_TOO_LARGE", `The ${label} image is larger than 20 MB.`, 413);
  }
  return normalizeImage(Buffer.from(await file.arrayBuffer()), opts);
}
