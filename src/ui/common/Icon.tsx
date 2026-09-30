/** Tiny hand-drawn-ish inline SVG icon set (stroke = currentColor). */
import type { CSSProperties } from 'react';

const PATHS = {
  crown: 'M4 17 3 7l5 4 4-6 4 6 5-4-1 10Z M5 20h14',
  bot: 'M12 3v3 M7 7h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3Z M9 12.5h.01 M15 12.5h.01 M9.5 16h5',
  copy: 'M9 9h10v11H9Z M5 15H4V4h11v1',
  share: 'M12 3v12 M7 8l5-5 5 5 M5 13v7h14v-7',
  book: 'M4 5.5C4 4.7 4.7 4 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5Z M20 5.5c0-.8-.7-1.5-1.5-1.5H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5Z',
  scroll: 'M7 4h11a2 2 0 0 1 2 2v1h-4 M16 7v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1h10 M7 4a2 2 0 0 0-2 2v11 M9 9h4 M9 12.5h4',
  trophy: 'M8 4h8v5a4 4 0 0 1-8 0Z M8 6H5a3 3 0 0 0 3 4 M16 6h3a3 3 0 0 1-3 4 M12 13v4 M8.5 20h7 M10 17h4',
  dots: 'M5 12h.01 M12 12h.01 M19 12h.01',
  close: 'M6 6l12 12 M18 6 6 18',
  check: 'M5 12.5l4.5 4.5L19 7',
  plus: 'M12 5v14 M5 12h14',
  minus: 'M5 12h14',
  arrowLeft: 'M19 12H5 M11 6l-6 6 6 6',
  arrowRight: 'M5 12h14 M13 6l6 6-6 6',
  hand: 'M5 8.5 11 6l1.5 12L6.5 20Z M11 6l6-.5 1 12.5-5.5.5',
  chili: 'M15 6c-4 1-9 5-10 12 4-1 10-4 11-10 M15 6c.5-1.5 1.8-2.6 3.5-3 M15 6c1.2.4 2 1.2 2.2 2.4',
  leave: 'M14 4h5v16h-5 M10 8l-4 4 4 4 M6 12h10',
  eye: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z',
  skip: 'M5 6l7 6-7 6Z M12 6l7 6-7 6Z',
  edit: 'M4 20h4L19 9l-4-4L4 16Z M13.5 6.5l4 4',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z M2.5 20c.6-3.6 3.2-6 6.5-6s5.9 2.4 6.5 6 M16 4.3a3.5 3.5 0 0 1 0 6.4 M18 14.2c1.9.9 3.1 3 3.5 5.8',
  sparkle: 'M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6Z',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, className, style, title }: { name: IconName; size?: number; className?: string; style?: CSSProperties; title?: string }) {
  return (
    <svg
      className={className ? `ak-icon ${className}` : 'ak-icon'}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === 'dots' ? 3.2 : 1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      aria-label={title}
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
