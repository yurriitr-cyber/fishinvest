import { useEffect, useState } from 'react';
import { MediaSlot } from '../components/MediaSlot';
import { api, type Me, type ReferralStats } from '../lib/api';
import { formatStars } from '../lib/format';
import { translateError } from '../lib/labels';
import { hapticImpact } from '../lib/telegram';

export function Referrals({
  me,
  notify,
}: {
  me: Me;
  notify: (msg: string) => void;
}) {
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .referrals()
      .then(setStats)
      .catch((e) =>
        setError(
          translateError(e instanceof Error ? e.message : 'Ошибка'),
        ),
      );
  }, []);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(me.referralLink);
      void hapticImpact('light');
      notify('Ссылка скопирована');
    } catch {
      notify(me.referralLink);
    }
  }

  function shareLink() {
    const text = encodeURIComponent(
      'Заходи в Rare Fish — нам обоим начислят бонусные кредиты.',
    );
    const url = encodeURIComponent(me.referralLink);
    const shareUrl = `https://t.me/share/url?url=${url}&text=${text}`;
    void hapticImpact('light');
    window.open(shareUrl, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="screen">
      <div className="topbar">
        <div>
          <div className="eyebrow">Рост</div>
          <h1>Друзья</h1>
          <p>Вам +300 CR · другу +50 CR</p>
        </div>
      </div>

      <div className="ticker">
        <div className="ticker-card">
          <div className="label">Друзья</div>
          <div className="value">{stats?.count ?? '—'}</div>
        </div>
        <div className="ticker-card">
          <div className="label">Заработано</div>
          <div className="value">
            {stats ? `${formatStars(stats.totalBonusEarned)} CR` : '—'}
          </div>
        </div>
      </div>

      <div className="trade-panel" style={{ marginBottom: 14 }}>
        <div className="eyebrow">Ваша ссылка</div>
        <div
          style={{
            marginTop: 8,
            fontSize: '0.82rem',
            wordBreak: 'break-all',
            color: 'var(--text-muted)',
            lineHeight: 1.4,
          }}
        >
          {me.referralLink}
        </div>
        <p style={{ margin: '10px 0 0', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
          Друг открывает ссылку → жмёт «Открыть» в боте → бонусы начисляются
          обоим. По своей ссылке себе бонус не приходит. С другом можно также
          покупать дорогие активы вдвоём на экране сделки (50/50).
        </p>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
        <button
          className="btn btn-solid"
          type="button"
          style={{ flex: 1 }}
          onClick={shareLink}
        >
          Поделиться в Telegram
        </button>
        <button
          className="btn"
          type="button"
          style={{ flex: 1 }}
          onClick={copyLink}
        >
          Скопировать
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="section-title">Недавние приглашения</div>
      <div className="list">
        {(stats?.referrals || []).map((r) => (
          <div key={r.id} className="row" style={{ cursor: 'default' }}>
            <MediaSlot className="thumb" label="INV" />
            <div className="row-main">
              <div className="name">
                {r.username || r.firstName || 'Друг'}
              </div>
              <div className="meta">
                {new Date(r.joinedAt).toLocaleDateString('ru-RU')}
              </div>
            </div>
            <div className="row-side">
              <div className="price">+{formatStars(r.bonus)}</div>
            </div>
          </div>
        ))}
      </div>

      {stats && stats.referrals.length === 0 && (
        <div className="state-box">Пока никого. Поделитесь ссылкой.</div>
      )}
    </div>
  );
}
