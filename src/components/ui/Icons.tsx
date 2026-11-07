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
export const Eye = (p: P) => (
  <Base {...p}>
    <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="2.8" />
  </Base>
);
export const People = (p: P) => (
  <Base {...p}>
    <circle cx="9" cy="8.5" r="3" />
    <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
    <circle cx="17" cy="9.5" r="2.4" />
    <path d="M15.5 14.2A4.5 4.5 0 0 1 21 18.5" />
  </Base>
);
export const Wrench = (p: P) => (
  <Base {...p}>
    <path d="M14.5 5.5a4 4 0 0 0 4.9 5L20 11l-8.5 8.5a2.1 2.1 0 0 1-3-3L17 8l.5.6" />
    <path d="M14.5 5.5L17 8" />
  </Base>
);
export const Question = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9.6 9.5a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.6M12 16.8h.01" />
  </Base>
);
export const History = (p: P) => (
  <Base {...p}>
    <path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5M4 4.5v4h4" />
    <path d="M12 8v4.5l3 1.8" />
  </Base>
);
export const List = (p: P) => (
  <Base {...p}>
    <path d="M9 6.5h11M9 12h11M9 17.5h11" />
    <circle cx="4.5" cy="6.5" r="1" />
    <circle cx="4.5" cy="12" r="1" />
    <circle cx="4.5" cy="17.5" r="1" />
  </Base>
);
export const Info = (p: P) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5.5M12 7.8h.01" />
  </Base>
);
export const Home = (p: P) => (
  <Base {...p}>
    <path d="M3.5 10.5L12 3.8l8.5 6.7" />
    <path d="M5.5 9.5V20h13V9.5M9.5 20v-6h5v6" />
  </Base>
);
export const Document = (p: P) => (
  <Base {...p}>
    <path d="M6 3.5h8l4 4V20H6z" />
    <path d="M14 3.5V8h4M9 12h6M9 15.5h6" />
  </Base>
);
export const Print = (p: P) => (
  <Base {...p}>
    <path d="M7 8V3.5h10V8M7 17H4.5A2.5 2.5 0 0 1 2 14.5v-4A2.5 2.5 0 0 1 4.5 8h15a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-2.5 2.5H17" />
    <path d="M7 14h10v6.5H7zM18.5 11.5h.01" />
  </Base>
);
/* Barrier types */
export const Stairs = (p: P) => (
  <Base {...p}>
    <path d="M3.5 19.5h5v-4.5h4.5v-4.5h4.5V6h3" />
  </Base>
);
export const Obstruction = (p: P) => (
  <Base {...p}>
    <path d="M3.5 19.5h17" />
    <rect x="8" y="9" width="8" height="8" rx="1.5" />
    <path d="M4.5 13.5h2M17.5 13.5h2" />
  </Base>
);
export const Protrusion = (p: P) => (
  <Base {...p}>
    <path d="M5 3.5v17" />
    <path d="M5 8.5h9.5a1.5 1.5 0 0 1 1.5 1.5v2a1.5 1.5 0 0 1-1.5 1.5H5" />
    <path d="M19.5 7v8" strokeDasharray="1.5 2" />
  </Base>
);
/* Accessibility-need categories */
export const Wheelchair = (p: P) => (
  <Base {...p}>
    <circle cx="10.5" cy="4.5" r="1.6" />
    <path d="M10.5 7.5v5.5h5l2.5 5" />
    <path d="M10.5 10h4" />
    <path d="M7.6 10.4a5 5 0 1 0 6.9 6.6" />
  </Base>
);
export const Signpost = (p: P) => (
  <Base {...p}>
    <path d="M12 3v18" />
    <path d="M12 5.5h6.5l2 2-2 2H12z" />
    <path d="M12 11.5H5.5l-2 2 2 2H12" />
  </Base>
);
