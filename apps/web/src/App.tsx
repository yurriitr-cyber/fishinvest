import { useEffect, useState, type ReactNode } from 'react';
import { api, type Me } from './lib/api';
import { BottomNav, type Tab } from './components/BottomNav';
import { Welcome } from './pages/Welcome';
import { Market } from './pages/Market';
import { Trade } from './pages/Trade';
import { PortfolioPage } from './pages/Portfolio';
import { Deposit } from './pages/Deposit';
import { LeaderboardPage } from './pages/Leaderboard';
import { Referrals } from './pages/Referrals';

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<Tab>('market');
  const [selectedFishId, setSelectedFishId] = useState<string | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function refreshMe() {
    const data = await api.me();
    setMe(data);
    return data;
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await refreshMe();
        if (cancelled) return;
        if (data.isNewUser) setShowWelcome(true);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  function notify(message: string) {
    setToast(message);
  }

  async function onTraded() {
    await refreshMe();
    notify('Order filled');
  }

  let body: ReactNode;

  if (loading) {
    body = (
      <div className="state-box">
        Connecting to exchange…
        <div className="loading-bar" />
      </div>
    );
  } else if (error || !me) {
    body = (
      <div className="screen">
        <div className="eyebrow">Offline</div>
        <h1 className="brand">
          Rare Fish
          <span>Investment</span>
        </h1>
        <div className="error-box">{error || 'Unavailable'}</div>
        <p className="lede">
          Check that API is online, then reopen the Mini App.
        </p>
      </div>
    );
  } else if (showWelcome) {
    body = (
      <Welcome
        me={me}
        onEnter={() => {
          setShowWelcome(false);
          setTab('market');
        }}
      />
    );
  } else if (selectedFishId) {
    body = (
      <Trade
        fishId={selectedFishId}
        balance={me.balance}
        onBack={() => setSelectedFishId(null)}
        onTraded={onTraded}
        notify={notify}
      />
    );
  } else {
    switch (tab) {
      case 'market':
        body = (
          <Market
            me={me}
            onSelectFish={(id) => setSelectedFishId(id)}
          />
        );
        break;
      case 'portfolio':
        body = <PortfolioPage me={me} onSelectFish={setSelectedFishId} />;
        break;
      case 'deposit':
        body = (
          <Deposit
            me={me}
            onCredited={async () => {
              await refreshMe();
              notify('Stars deposit confirmed. Game credits added.');
            }}
          />
        );
        break;
      case 'leaders':
        body = <LeaderboardPage />;
        break;
      case 'invite':
        body = <Referrals me={me} notify={notify} />;
        break;
    }
  }

  return (
    <div className="app-shell">
      {body}
      {!showWelcome && !loading && me && !error && (
        <BottomNav
          tab={tab}
          onChange={(next) => {
            setSelectedFishId(null);
            setTab(next);
          }}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
