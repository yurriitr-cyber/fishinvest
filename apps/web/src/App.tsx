import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type Me } from './lib/api';
import { translateError } from './lib/labels';
import { useTabPager } from './lib/useTabPager';
import { BottomNav, type Tab } from './components/BottomNav';
import { Welcome } from './pages/Welcome';
import { Market } from './pages/Market';
import { Trade } from './pages/Trade';
import { PortfolioPage } from './pages/Portfolio';
import { Deposit } from './pages/Deposit';
import { Casino } from './pages/Casino';
import { Referrals } from './pages/Referrals';

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<Tab>('market');
  const [selectedFishId, setSelectedFishId] = useState<string | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [navTab, setNavTab] = useState<Tab>('market');
  const pagerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);

  const goTab = useCallback((next: Tab) => {
    setSelectedFishId(null);
    setTab(next);
    setNavTab(next);
  }, []);

  const showPager = !showWelcome && !loading && !!me && !error;

  useTabPager({
    enabled: showPager && !selectedFishId,
    tab,
    onChange: goTab,
    onHint: setNavTab,
    viewportRef: pagerRef,
    trackRef,
    thumbRef,
  });

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

  let body: ReactNode = null;

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
  }

  return (
    <>
      <div className="ocean" aria-hidden>
        <span className="ocean-rays" />
        <span className="ocean-caustics" />
        <span className="ocean-floor" />
        <span className="ocean-grain" />
      </div>
      <div className="app-shell">
        {body}
        {showPager && me && (
          <div
            className="pager"
            ref={pagerRef}
            hidden={!!selectedFishId}
          >
            <div className="pager-track" ref={trackRef}>
              <div className="pager-page">
                <Market
                  me={me}
                  onSelectFish={(id) => setSelectedFishId(id)}
                />
              </div>
              <div className="pager-page">
                <PortfolioPage
                  me={me}
                  onSelectFish={setSelectedFishId}
                  onSold={async () => {
                    await refreshMe();
                  }}
                  notify={notify}
                />
              </div>
              <div className="pager-page">
                <Deposit
                  me={me}
                  onCredited={async () => {
                    await refreshMe();
                    notify('Депозит подтверждён. Кредиты зачислены.');
                  }}
                />
              </div>
              <div className="pager-page">
                <Casino
                  me={me}
                  onOpened={async () => {
                    await refreshMe();
                  }}
                  notify={notify}
                />
              </div>
              <div className="pager-page">
                <Referrals me={me} notify={notify} />
              </div>
            </div>
          </div>
        )}
        {showPager && (
          <BottomNav tab={navTab} onChange={goTab} thumbRef={thumbRef} />
        )}
        {toast && <div className="toast">{toast}</div>}
      </div>
    </>
  );
}
