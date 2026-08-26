import type { Me } from '../lib/api';
import { formatStars } from '../lib/format';
import { MediaSlot } from '../components/MediaSlot';

export function Welcome({ me, onEnter }: { me: Me; onEnter: () => void }) {
  const join = me.referralJoinBonus ? Number(me.referralJoinBonus) : 0;
  const welcome = Number(me.welcomeBonus);
  const total = welcome + join;

  return (
    <section className="hero">
      <div className="hero-visual" aria-hidden>
        <MediaSlot className="cover" label="Hero media" />
      </div>
      <div className="hero-copy">
        <div className="eyebrow">
          <span className="live-dot" /> Simulated market
        </div>
        <h1 className="brand">
          Rare Fish
          <span>Investment</span>
        </h1>
        <p className="lede">
          Limited supply species. Live quotes. Deposit credits, then trade.
        </p>
        <div className="bonus-chip">
          Starter · {formatStars(total)} CR
          {join > 0 ? ' · referral' : ''}
        </div>
        <div className="cta-row">
          <button className="btn btn-primary" type="button" onClick={onEnter}>
            Open markets
          </button>
        </div>
      </div>
    </section>
  );
}
