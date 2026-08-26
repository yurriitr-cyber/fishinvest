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
          <span className="live-dot" /> Simulated exchange
        </div>
        <h1 className="brand">
          Rare Fish
          <span>Investment</span>
        </h1>
        <p className="lede">
          Trade meme fish like a pro terminal. Prices thrash. Whales appear.
          Your game ⭐ are the only real stakes.
        </p>
        <div className="bonus-chip">
          Starter · ⭐ {formatStars(total)}
          {join > 0 ? ' · invite bonus' : ''}
        </div>
        <div className="cta-row">
          <button className="btn btn-primary" type="button" onClick={onEnter}>
            Enter market
          </button>
        </div>
      </div>
    </section>
  );
}
