import { useEffect, useState } from 'react';
import { MediaSlot } from '../components/MediaSlot';
import { api, type Me, type ReferralStats } from '../lib/api';
import { formatStars } from '../lib/format';
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
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed'));
  }, []);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(me.referralLink);
      void hapticImpact('light');
      notify('Invite link copied');
    } catch {
      notify(me.referralLink);
    }
  }

  function shareLink() {
    const text = encodeURIComponent(
      'Join me on Rare Fish — we both get bonus credits.',
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
          <div className="eyebrow">Growth</div>
          <h1>Invite</h1>
          <p>You +300 CR · Friend +50 CR</p>
        </div>
      </div>

      <div className="ticker">
        <div className="ticker-card">
          <div className="label">Friends</div>
          <div className="value">{stats?.count ?? '—'}</div>
        </div>
        <div className="ticker-card">
          <div className="label">Earned</div>
          <div className="value">
            {stats ? `${formatStars(stats.totalBonusEarned)} CR` : '—'}
          </div>
        </div>
      </div>

      <div className="trade-panel" style={{ marginBottom: 14 }}>
        <div className="eyebrow">Your link</div>
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
          Friend opens the link → taps Open in the bot → both bonuses land.
          Your own link never pays out to you.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
        <button
          className="btn btn-solid"
          type="button"
          style={{ flex: 1 }}
          onClick={shareLink}
        >
          Share in Telegram
        </button>
        <button
          className="btn"
          type="button"
          style={{ flex: 1 }}
          onClick={copyLink}
        >
          Copy link
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="section-title">Recent joins</div>
      <div className="list">
        {(stats?.referrals || []).map((r) => (
          <div key={r.id} className="row" style={{ cursor: 'default' }}>
            <MediaSlot className="thumb" label="INV" />
            <div className="row-main">
              <div className="name">
                {r.username || r.firstName || 'Friend'}
              </div>
              <div className="meta">
                {new Date(r.joinedAt).toLocaleDateString()}
              </div>
            </div>
            <div className="row-side">
              <div className="price">+{formatStars(r.bonus)}</div>
            </div>
          </div>
        ))}
      </div>

      {stats && stats.referrals.length === 0 && (
        <div className="state-box">No invites yet. Share your link.</div>
      )}
    </div>
  );
}
