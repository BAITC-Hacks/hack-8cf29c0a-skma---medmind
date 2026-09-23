import type { SVGProps } from 'react';

const paths = {
  history: 'M3 11a9 9 0 1 1 2.6 7 M3 4v7h7 M12 7v5l4 2',
  orders: 'M8 3h8v4H8z M6 5H4v16h16V5h-2 M8 11h8 M8 15h5',
  dashboard: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  settings: 'M4 7h16 M4 17h16 M8 4v6 M16 14v6',
  spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z',
  moon: 'M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z',
  sun: 'M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5l1.5 1.5 M5 19l1.5-1.5 M17.5 6.5l1.5-1.5 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  arrow: 'M5 12h14 M14 7l5 5-5 5',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 7v5l3 2',
  search: 'M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15 M16 16l5 5',
  download: 'M12 3v12 m-5-5 5 5 5-5 M4 16v5h16v-5',
  check: 'm5 12 4 4L19 6',
  close: 'm6 6 12 12 M18 6 6 18',
  chevron: 'm9 5 7 7-7 7',
  warning: 'm12 3 10 18H2L12 3Z M12 9v5 M12 17v.1',
  box: 'm3 7 9-4 9 4v10l-9 4-9-4V7Z m0 0 9 4 9-4 M12 11v10 M7 5l9 4',
  truck:
    'M2 5h12v12H2V5Z M14 9h4l4 4v4h-8 M8 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0 M20 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
  sort: 'm7 4-3 3 M7 4v16 m10 0 3-3 M17 20V4',
  info: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 11v6 M12 7v.1',
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
