// The rail's icons, drawn in one weight: a 1.75px stroke with round ends, on a 20px grid.
import type { ReactNode } from "react";

const frame = (children: ReactNode) => (
  <svg
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const icons: Record<string, ReactNode> = {
  // a line with two stations
  floor: frame(
    <>
      <path d="M2.5 13h5l3-6h7" />
      <circle cx="5" cy="13" r="1.9" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="7" r="1.9" fill="currentColor" stroke="none" />
    </>,
  ),
  // a train on its line
  runs: frame(
    <>
      <rect x="5" y="3.5" width="10" height="10.5" rx="2.5" />
      <path d="M5 9.5h10M7.5 17l1.2-3M12.5 17l-1.2-3" />
    </>,
  ),
  inbox: frame(
    <>
      <path d="M3 11.5 5 4.5h10l2 7v4H3z" />
      <path d="M3 11.5h4l1 2h4l1-2h4" />
    </>,
  ),
  accounts: frame(
    <>
      <circle cx="10" cy="7" r="3" />
      <path d="M4 16.5c.8-3 3.2-4.5 6-4.5s5.200 1.500 6 4.500" />
    </>,
  ),
  plugins: frame(
    <>
      <path d="M7.500 3v3.500M12.500 3v3.500M5 6.500h10V10a5 5 0 0 1-10 0z" />
      <path d="M10 15v2.500" />
    </>,
  ),
  costs: frame(
    <>
      <circle cx="10" cy="10" r="6.750" />
      <path d="M12.250 7.750c-.5-.8-1.300-1.250-2.250-1.250-1.300 0-2.250.700-2.250 1.750s.900 1.500 2.250 1.750 2.250.700 2.250 1.750-.950 1.750-2.250 1.750c-.950 0-1.750-.450-2.250-1.250M10 5.250v9.500" />
    </>,
  ),
  theme: frame(
    <>
      <circle cx="10" cy="10" r="6.750" />
      <path d="M10 3.250v13.500" />
      <path d="M10 3.250a6.750 6.750 0 0 1 0 13.500z" fill="currentColor" stroke="none" />
    </>,
  ),
};
