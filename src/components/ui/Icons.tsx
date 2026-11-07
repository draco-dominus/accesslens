import type { SVGProps } from "react";

/** Line icons from the Figma prototype, plus a few the real app needs (camera, photos, alert). */
type P = SVGProps<SVGSVGElement> & { size?: number };

function Base({ size = 20, children, ...rest }: P) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const ChevronRight = (p: P) => (
  <Base {...p}>
    <path d="M9 5l7 7-7 7" />
  </Base>
);
export const ChevronLeft = (p: P) => (
  <Base {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Base>
);
export const ChevronDown = (p: P) => (
  <Base {...p}>
    <path d="M5 9l7 7 7-7" />
  </Base>
);
export const Sun = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
  </Base>
);
export const Moon = (p: P) => (
  <Base {...p}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
  </Base>
);
export const Scan = (p: P) => (
  <Base {...p}>
    <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
    <circle cx="12" cy="12" r="3" />
  </Base>
);
export const Pin = (p: P) => (
  <Base {...p}>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.3" />
  </Base>
);
export const Chat = (p: P) => (
  <Base {...p}>
    <path d="M5 18.5V6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7a2.5 2.5 0 0 1-2.5 2.5H9z" />
  </Base>
);
export const Compare = (p: P) => (
  <Base {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
    <path d="M12 3v18" />
  </Base>
);
export const Check = (p: P) => (
  <Base {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Base>
);
export const Close = (p: P) => (
  <Base {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Base>
);
export const Arrow = (p: P) => (
  <Base {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Base>
);
export const Rescan = (p: P) => (
  <Base {...p}>
    <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4" />
  </Base>
);
export const Columns = (p: P) => (
  <Base {...p}>
    <rect x="3.5" y="5" width="7.5" height="14" rx="2" />
    <rect x="13" y="5" width="7.5" height="14" rx="2" />
  </Base>
);
export const Route = (p: P) => (
  <Base {...p}>
    <circle cx="6" cy="18" r="2.2" />
    <circle cx="18" cy="6" r="2.2" />
    <path d="M8.2 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.8" />
  </Base>
);
export const Photos = (p: P) => (
  <Base {...p}>
    <rect x="3.5" y="5" width="17" height="14" rx="3" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M20.5 15.5l-4.5-4.5-8 8" />
  </Base>
);
export const Camera = (p: P) => (
  <Base {...p}>
    <path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.8l1.4-2h4.6l1.4 2h1.8A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z" />
    <circle cx="12" cy="12.5" r="3.4" />
  </Base>
);
export const Layers = (p: P) => (
  <Base {...p}>
    <path d="M12 4l8.5 4.5L12 13 3.5 8.5z" />
    <path d="M3.5 12.5L12 17l8.5-4.5" />
  </Base>
);
export const Alert = (p: P) => (
  <Base {...p}>
    <path d="M12 4l9 15.5H3z" />
    <path d="M12 10v4M12 17h.01" />
  </Base>
);
