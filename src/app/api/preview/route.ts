import { errorResponse, readForm } from "@/lib/api-errors.server";
import { readImageField } from "@/lib/image.server";

export const runtime = "nodejs";

/**
 * Returns the normalized JPEG for an uploaded photo so every browser can preview it
 * (Chrome/Firefox can't display HEIC). It is the exact image the AI will see:
 * same orientation, same size, metadata (incl. GPS) stripped. No AI call, no API key involved.
 */
export async function POST(request: Request) {
  const form = await readForm(request);
  if (form instanceof Response) return form;

  try {
    const image = await readImageField(form, "image", "photo");
    return new Response(new Uint8Array(image.data), {
      headers: {
        "Content-Type": image.mimeType,
        "Cache-Control": "no-store",
        "X-Image-Width": String(image.width),
        "X-Image-Height": String(image.height),
        "X-Source-Format": image.sourceFormat,
      },
    });
  } catch (err) {
    return errorResponse(err, "preview");
  }
}
