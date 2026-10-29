// Icons copied from the mockups so strokes match the type. All use currentColor.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;
const base = { fill: "none", stroke: "currentColor", "aria-hidden": true } as const;

/** Two translucent sheets, solid where they overlap: vellum on vellum. packages/ui/logo has the files. */
export const LogoIcon = (p: P) => (
  <svg viewBox="0 0 64 64" fill="currentColor" aria-hidden="true" {...p}>
    <rect x="6" y="4" width="34" height="44" rx="6" fillOpacity={0.28} />
    <rect x="24" y="16" width="34" height="44" rx="6" fillOpacity={0.55} />
    <path d="M30 16H40V42A6 6 0 0 1 34 48H24V22A6 6 0 0 1 30 16Z" />
  </svg>
);
export const PlusIcon = (p: P) => (
  <svg viewBox="0 0 16 16" strokeWidth={1.75} {...base} {...p}>
    <path d="M8 3v10M3 8h10" strokeLinecap="round" />
  </svg>
);
export const SearchIcon = (p: P) => (
  <svg viewBox="0 0 16 16" strokeWidth={1.5} {...base} {...p}>
    <circle cx="7" cy="7" r="4.25" />
    <path d="m10.25 10.25 3 3" strokeLinecap="round" />
  </svg>
);
export const UploadIcon = (p: P) => (
  <svg viewBox="0 0 24 24" strokeWidth={1.5} {...base} {...p}>
    <path d="M12 15V4m0 0L8 8m4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M4.75 14v4.25c0 .55.45 1 1 1h12.5c.55 0 1-.45 1-1V14" strokeLinecap="round" />
  </svg>
);
export const LockIcon = (p: P) => (
  <svg viewBox="0 0 14 14" strokeWidth={1.4} {...base} {...p}>
    <rect x="2.75" y="6.25" width="8.5" height="5.5" rx="1" />
    <path d="M4.75 6.25V4.5a2.25 2.25 0 0 1 4.5 0v1.75" />
  </svg>
);
export const LinkIcon = (p: P) => (
  <svg viewBox="0 0 16 16" strokeWidth={1.5} {...base} {...p}>
    <path d="M6.5 9.5 9.5 6.5" strokeLinecap="round" />
    <path d="M7 4.5 8.25 3.25a2.47 2.47 0 0 1 3.5 3.5L10.5 8M9 11.5l-1.25 1.25a2.47 2.47 0 0 1-3.5-3.5L5.5 8" strokeLinecap="round" />
  </svg>
);
export const MoreIcon = (p: P) => (
  <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden {...p}>
    <circle cx="3.5" cy="8" r="1.25" />
    <circle cx="8" cy="8" r="1.25" />
    <circle cx="12.5" cy="8" r="1.25" />
  </svg>
);
export const CheckIcon = (p: P) => (
  <svg viewBox="0 0 16 16" strokeWidth={1.75} {...base} {...p}>
    <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const CopyIcon = (p: P) => (
  <svg viewBox="0 0 16 16" strokeWidth={1.5} {...base} {...p}>
    <rect x="5.25" y="5.25" width="8" height="8" rx="1.5" />
    <path d="M10.75 5.25V3.75a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1.5" />
  </svg>
);
export const ErrorIcon = (p: P) => (
  <svg viewBox="0 0 14 14" strokeWidth={1.4} {...base} {...p}>
    <circle cx="7" cy="7" r="5.25" />
    <path d="M7 4.25v3.25" strokeLinecap="round" />
    <circle cx="7" cy="9.75" r="0.5" fill="currentColor" />
  </svg>
);
export const ClockIcon = (p: P) => (
  <svg viewBox="0 0 14 14" strokeWidth={1.4} {...base} {...p}>
    <circle cx="7" cy="7" r="4.75" />
    <path d="M7 4.5V7l1.75 1" strokeLinecap="round" />
  </svg>
);
export const LiveDot = (p: P) => (
  <svg viewBox="0 0 14 14" aria-hidden {...p}>
    <circle cx="7" cy="7" r="3.5" fill="currentColor" />
  </svg>
);
export const DraftDot = (p: P) => (
  <svg viewBox="0 0 14 14" strokeWidth={1.4} strokeDasharray="2 2" {...base} {...p}>
    <circle cx="7" cy="7" r="4.25" />
  </svg>
);
export const ExpiredDot = (p: P) => (
  <svg viewBox="0 0 14 14" strokeWidth={1.4} {...base} {...p}>
    <circle cx="7" cy="7" r="4.75" />
    <path d="m4.5 9.5 5-5" strokeLinecap="round" />
  </svg>
);
