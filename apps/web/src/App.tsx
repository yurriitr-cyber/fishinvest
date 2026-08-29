import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { api, type Me } from './lib/api';
import { translateError } from './lib/labels';
import { BottomNav, type Tab } from './components/BottomNav';
import { Welcome } from './pages/Welcome';
import { Market } from './pages/Market';
import { Trade } from './pages/Trade';
import { PortfolioPage } from './pages/Portfolio';
import { isLowPower } from './lib/perf';

const Deposit = lazy(() =>
  import('./pages/Deposit').then((m) => ({ default: m.Deposit })),
);
const Casino = lazy(() =>
  import('./pages/Casino').then((m) => ({ default: m.Casino })),
);
const Referrals = lazy(() =>
  import('./pages/Referrals').then((m) => ({ default: m.Referrals })),
);

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
          setError(
            translateError(
              e instanceof Error ? e.message : 'Не удалось загрузить',
            ),
          );
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
    notify('Сделка исполнена');
  }

  let body: ReactNode;

  if (loading) {
    body = (
      <div className="state-box">
        Подключение к бирже…
        <div className="loading-bar" />
      </div>
    );
  } else if (error || !me) {
    body = (
      <div className="screen">
        <div className="eyebrow">Нет связи</div>
        <h1 className="brand">
          Rare Fish
          <span>Investment</span>
        </h1>
        <div className="error-box">{error || 'Недоступно'}</div>
        <p className="lede">
          Проверьте, что API работает, и откройте Mini App снова.
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
            onSelectFish={setSelectedFishId}
          />
        );
        break;
      case 'portfolio':
        body = (
          <PortfolioPage
            me={me}
            onSelectFish={setSelectedFishId}
            onSold={async () => {
              await refreshMe();
            }}
            notify={notify}
          />
        );
        break;
      case 'deposit':
        body = (
          <Deposit
            me={me}
            onCredited={async () => {
              await refreshMe();
              notify('Депозит подтверждён. Кредиты зачислены.');
            }}
          />
        );
        break;
      case 'casino':
        body = (
          <Casino
            me={me}
            onOpened={async () => {
              await refreshMe();
            }}
            notify={notify}
          />
        );
        break;
      case 'invite':
        body = <Referrals me={me} notify={notify} />;
        break;
    }
  }

  return (
    <>
      <div className="ocean" aria-hidden>
        {isLowPower() ? (
          <span className="ocean-floor" />
        ) : (
          <>
            <span className="ocean-rays" />
            <span className="ocean-caustics" />
            <span className="ocean-floor" />
          </>
        )}
      </div>
      <div className="app-shell">
        <Suspense
          fallback={
            <div className="state-box">
              Загрузка…
              <div className="loading-bar" />
            </div>
          }
        >
          {body}
        </Suspense>
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
    </>
  );
}
