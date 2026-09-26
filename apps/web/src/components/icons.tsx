/**
 * Inline SVG icon set.
 *
 * Hand-drawn from primitives so nothing is licensed from a third party, and
 * every icon inherits `currentColor` so it themes with its container.
 */
type Props = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const IconHome = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5.5 9.5V20a1 1 0 0 0 1 1h3.5v-5.5h4V21h3.5a1 1 0 0 0 1-1V9.5" />
  </svg>
);

export const IconGrid = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="3" width="7.5" height="7.5" rx="1.6" />
    <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" />
    <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" />
  </svg>
);

export const IconLive = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M6.5 6.5a7.8 7.8 0 0 0 0 11M17.5 6.5a7.8 7.8 0 0 1 0 11" />
    <path d="M3.7 3.7a11.7 11.7 0 0 0 0 16.6M20.3 3.7a11.7 11.7 0 0 1 0 16.6" />
  </svg>
);

export const IconTrophy = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
    <path d="M7 5.5H4.5V8A3.5 3.5 0 0 0 7 11.3M17 5.5h2.5V8a3.5 3.5 0 0 1-2.5 3.3" />
    <path d="M12 14v4M8.5 21h7M10 18h4l1 3H9l1-3Z" />
  </svg>
);

export const IconWallet = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="6" width="18" height="13" rx="3" />
    <path d="M3 10h18" />
    <circle cx="16.5" cy="14.5" r="1.3" fill="currentColor" stroke="none" />
  </svg>
);

export const IconUser = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="8.5" r="3.8" />
    <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
  </svg>
);

export const IconGift = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="8.5" width="18" height="12.5" rx="2" />
    <path d="M3 13h18M12 8.5V21" />
    <path d="M12 8.5C10.5 5 8.8 4 7.6 4a2.3 2.3 0 0 0 0 4.5M12 8.5C13.5 5 15.2 4 16.4 4a2.3 2.3 0 0 1 0 4.5" />
  </svg>
);

export const IconFlame = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M12 21c3.6 0 6-2.4 6-5.6 0-4.3-4.2-5.6-4.2-9.4 0 0-2.4 1.2-2.4 4.2 0 1.6-1 2.2-1.6 1.4-.5-.7-.5-1.9-.5-1.9C7 11 6 13 6 15.4 6 18.6 8.4 21 12 21Z" />
  </svg>
);

export const IconStar = ({ size = 20, className, filled }: Props & { filled?: boolean }) => (
  <svg {...base(size)} className={className} fill={filled ? "currentColor" : "none"}>
    <path d="M12 3.5l2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.9l6-.8L12 3.5Z" />
  </svg>
);

export const IconSearch = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </svg>
);

export const IconBell = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M18 15.5V10a6 6 0 1 0-12 0v5.5L4.5 18h15L18 15.5Z" />
    <path d="M10 21h4" />
  </svg>
);

export const IconChevronLeft = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="m14.5 5-7 7 7 7" />
  </svg>
);

export const IconChevronRight = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="m9.5 5 7 7-7 7" />
  </svg>
);

export const IconMenu = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);

export const IconClose = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const IconShield = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3l7.5 3v5.5c0 4.6-3.1 8-7.5 9.5-4.4-1.5-7.5-4.9-7.5-9.5V6L12 3Z" />
    <path d="m9 12 2.2 2.2L15.5 10" />
  </svg>
);

export const IconDice = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
    <circle cx="8.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="15.5" cy="15.5" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

export const IconChart = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M4 20V4M4 20h16" />
    <path d="M8 16v-4M12 16V8M16 16v-6" />
  </svg>
);

export const IconUsers = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <circle cx="9" cy="8.5" r="3.3" />
    <path d="M2.8 19.5a6.4 6.4 0 0 1 12.4 0" />
    <path d="M16 5.7a3.3 3.3 0 0 1 0 5.6M17.5 19.5a6.5 6.5 0 0 0-1.4-4" />
  </svg>
);

export const IconCard = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
    <path d="M2.5 9.5h19" />
    <path d="M6 14.5h4" />
  </svg>
);

export const IconSettings = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
  </svg>
);

export const IconPlug = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M9 2.5v5M15 2.5v5" />
    <path d="M6.5 7.5h11v3a5.5 5.5 0 0 1-11 0v-3Z" />
    <path d="M12 16v5.5" />
  </svg>
);

export const IconDoc = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M6 2.5h7.5L19 8v13.5H6V2.5Z" />
    <path d="M13.5 2.5V8H19" />
    <path d="M9 12.5h7M9 16h5" />
  </svg>
);

export const IconCoins = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <ellipse cx="12" cy="6.5" rx="7" ry="3" />
    <path d="M5 6.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" />
    <path d="M5 11.5v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" />
  </svg>
);

export const IconLock = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
  </svg>
);

export const IconSparkle = ({ size = 20, className }: Props) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />
  </svg>
);
