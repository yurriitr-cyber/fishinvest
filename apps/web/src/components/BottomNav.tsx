import type { ReactNode } from 'react';

export type Tab = 'market' | 'portfolio' | 'deposit' | 'casino' | 'invite';

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="ico"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

const ITEMS: Array<{ id: Tab; label: string; icon: ReactNode }> = [
  {
    id: 'market',
    label: 'Рынок',
    icon: (
      <Icon>
        <path d="M3 16.5 8 11l3.5 3.5L21 5" />
        <path d="M21 5h-5m5 0v5" />
      </Icon>
    ),
  },
  {
    id: 'portfolio',
    label: 'Активы',
    icon: (
      <Icon>
        <path d="M12 3.5 21 8l-9 4.5L3 8l9-4.5Z" />
        <path d="M3 12.5 12 17l9-4.5" />
        <path d="M3 17 12 21.5 21 17" />
      </Icon>
    ),
  },
  {
    id: 'deposit',
    label: 'Депозит',
    icon: (
      <Icon>
        <path d="M12 3.5v11" />
        <path d="M7.5 10 12 14.5 16.5 10" />
        <path d="M4 18.5h16" />
      </Icon>
    ),
  },
  {
    id: 'casino',
    label: 'Кейсы',
    icon: (
      <Icon>
        <rect x="4" y="6" width="16" height="12" rx="2" />
        <path d="M8 10h.01M12 10h.01M16 10h.01M8 14h8" />
      </Icon>
    ),
  },
  {
    id: 'invite',
    label: 'Друзья',
    icon: (
      <Icon>
        <circle cx="9" cy="8.5" r="3.5" />
        <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
        <path d="M18 8v6m3-3h-6" />
      </Icon>
    ),
  },
];

export const TABS: Tab[] = ITEMS.map((item) => item.id);

export function BottomNav({
  tab,
  onChange,
}: {
  tab: Tab;
  onChange: (tab: Tab) => void;
}) {
  return (
    <nav className="nav">
      {ITEMS.map((item) => (
        <button
          key={item.id}
          className={tab === item.id ? 'active' : undefined}
          onClick={() => onChange(item.id)}
          type="button"
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
