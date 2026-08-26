import type { Me } from '../lib/api';
import { formatStars } from '../lib/format';

export function Welcome({ me, onEnter }: { me: Me; onEnter: () => void }) {
  const join = me.referralJoinBonus ? Number(me.referralJoinBonus) : 0;
  const welcome = Number(me.welcomeBonus);
  const total = welcome + join;

  return (
    <section className="hero">
      <div className="hero-visual" aria-hidden />
      <div className="hero-copy">
        <div className="eyebrow">
          <span className="live-dot" /> Paper market
        </div>
        <h1 className="brand">
          Rare Fish
          <span>Investment</span>
        </h1>
        <p className="lede">
          Finite supply. Live prices. Game credits only — not real Stars on the
          books until you deposit.
        </p>
        <div className="bonus-chip">
          Starter ⭐ {formatStars(total)}
          {join > 0 ? ' · referral bonus' : ''}
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
