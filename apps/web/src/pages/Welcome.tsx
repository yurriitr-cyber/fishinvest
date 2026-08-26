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
        <h1 className="brand">
          Rare Fish
          <span>Investment</span>
        </h1>
        <p className="lede">
          A simulated aquarium market. Buy absurd fish. Watch prices thrash
          like crypto. Become a Fish Whale.
        </p>
        <div className="bonus-chip">
          Starter pack · ⭐ {formatStars(total)}
          {join > 0 ? ' (incl. invite bonus)' : ''}
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
