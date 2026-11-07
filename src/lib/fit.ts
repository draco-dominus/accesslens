/**
 * Fit media of a given size inside a container without cropping or distortion ("contain"), centered.
 * Used for the camera capture frame so the viewfinder, the Line-up guide and the captured photo all
 * show exactly the same field of view.
 */
export type Size = { w: number; h: number };
export type Rect = { left: number; top: number; width: number; height: number };

export function fitContain(container: Size, media: Size): Rect {
  if (container.w <= 0 || container.h <= 0 || media.w <= 0 || media.h <= 0) return { left: 0, top: 0, width: 0, height: 0 };
  const scale = Math.min(container.w / media.w, container.h / media.h);
  const width = Math.round(media.w * scale);
  const height = Math.round(media.h * scale);
  return { left: Math.round((container.w - width) / 2), top: Math.round((container.h - height) / 2), width, height };
}
