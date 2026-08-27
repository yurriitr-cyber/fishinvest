import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { formatStars, pnlClass } from '../lib/format';

type Point = { t: number; p: number };

export function PriceChart({
  fishId,
  livePrice,
}: {
  fishId: string;
  livePrice: string;
  volatility?: string;
}) {
  const [points, setPoints] = useState<Point[]>([]);
  const price = Number(livePrice);

  useEffect(() => {
    let cancelled = false;

    async function pull() {
      try {
        const [hist, fish] = await Promise.all([
          api.fishHistory(fishId, 60),
          api.fishOne(fishId),
        ]);
        if (cancelled) return;
        const series = [...hist.history]
          .reverse()
          .map((h) => ({
            t: new Date(h.createdAt).getTime(),
            p: Number(h.price),
          }));
        series.push({ t: Date.now(), p: Number(fish.currentPrice) });
        setPoints(series.slice(-80));
      } catch {
        /* keep last series */
      }
    }

    pull();
    const id = setInterval(pull, 2500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [fishId]);

  useEffect(() => {
    if (!Number.isFinite(price)) return;
    // Soft follow of live server price — no fake wild jitter (looked like casino).
    setPoints((prev) => {
      if (prev.length === 0) {
        return [{ t: Date.now(), p: price }];
      }
      const last = prev[prev.length - 1];
      if (Math.abs(last.p - price) < price * 1e-9) return prev;
      return [...prev, { t: Date.now(), p: price }].slice(-100);
    });
  }, [fishId, price]);

  const { path, area, min, max, change } = useMemo(() => {
    if (points.length < 2) {
      return { path: '', area: '', min: 0, max: 0, change: 0 };
    }
    const vals = points.map((p) => p.p);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = (hi - lo) * 0.12 || lo * 0.01 || 0.01;
    const yMin = lo - pad;
    const yMax = hi + pad;
    const w = 320;
    const h = 128;
    const coords = points.map((pt, i) => {
      const x = (i / (points.length - 1)) * w;
      const y = h - ((pt.p - yMin) / (yMax - yMin)) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    const line = `M ${coords.join(' L ')}`;
    const areaPath = `${line} L ${w},${h} L 0,${h} Z`;
    const ch = ((vals[vals.length - 1] - vals[0]) / vals[0]) * 100;
    return { path: line, area: areaPath, min: lo, max: hi, change: ch };
  }, [points]);

  const up = change >= 0;
  const stroke = up ? '#38dfa4' : '#ff6b81';

  return (
    <div className={`chart-card ${up ? 'up' : 'down'}`}>
      <div className="chart-meta">
        <span className="label">Цена</span>
        <span className={`chg ${pnlClass(change)}`}>
          {change >= 0 ? '+' : ''}
          {change.toFixed(2)}%
        </span>
      </div>
      <svg
        className="chart-svg"
        viewBox="0 0 320 128"
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.34" />
            <stop offset="60%" stopColor={stroke} stopOpacity="0.08" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
          <filter id="chartGlow" x="-10%" y="-30%" width="120%" height="180%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {area && <path d={area} fill="url(#chartFill)" />}
        {path && (
          <path
            d={path}
            fill="none"
            stroke={stroke}
            strokeWidth="1.8"
            strokeLinejoin="round"
            strokeLinecap="round"
            filter="url(#chartGlow)"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <div className="chart-range mono">
        <span>Мин {formatStars(min, 2)}</span>
        <span>Макс {formatStars(max, 2)}</span>
      </div>
    </div>
  );
}
