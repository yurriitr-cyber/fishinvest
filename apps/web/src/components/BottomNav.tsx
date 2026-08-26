export type Tab = 'market' | 'portfolio' | 'deposit' | 'leaders' | 'invite';

const ITEMS: Array<{ id: Tab; label: string; ico: string }> = [
  { id: 'market', label: 'Markets', ico: '◇' },
  { id: 'portfolio', label: 'Assets', ico: '▣' },
  { id: 'deposit', label: 'Deposit', ico: '+' },
  { id: 'leaders', label: 'Ranks', ico: '#' },
  { id: 'invite', label: 'Invite', ico: '↗' },
];

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
          <span className="ico">{item.ico}</span>
          {item.label}
        </button>
      ))}
    </nav>
  );
}
