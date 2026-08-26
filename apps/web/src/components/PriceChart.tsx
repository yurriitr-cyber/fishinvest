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
        // Always append latest quote so the line breathes
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

  // Micro-jitter between server ticks so the chart feels alive
  useEffect(() => {
    if (!Number.isFinite(price)) return;
    const id = setInterval(() => {
      setPoints((prev) => {
        if (prev.length === 0) {
          return [{ t: Date.now(), p: price }];
        }
        const last = prev[prev.length - 1];
        const step =
          price >= 80
            ? (Math.random() - 0.5) * 0.35
            : price >= 10
              ? (Math.random() - 0.5) * 0.08
              : (Math.random() - 0.5) * 0.015;
        // Pull slightly toward live server price
        const next = last.p * 0.85 + price * 0.15 + step;
        const nextPts = [...prev, { t: Date.now(), p: next }];
        return nextPts.slice(-100);
      });
    }, 700);
    return () => clearInterval(id);
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
    const h = 140;
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

  return (
    <div className={`chart-card ${up ? 'up' : 'down'}`}>
      <div className="chart-meta">
        <span className="label">Live · 1s ticks</span>
        <span className={`chg ${pnlClass(change)}`}>
          {change >= 0 ? '+' : ''}
          {change.toFixed(2)}%
        </span>
      </div>
      <svg
        className="chart-svg"
        viewBox="0 0 320 140"
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor={up ? '#0ecb81' : '#f6465d'}
              stopOpacity="0.35"
            />
            <stop
              offset="100%"
              stopColor={up ? '#0ecb81' : '#f6465d'}
              stopOpacity="0"
            />
          </linearGradient>
        </defs>
        {area && <path d={area} fill="url(#chartFill)" />}
        {path && (
          <path
            d={path}
            fill="none"
            stroke={up ? '#0ecb81' : '#f6465d'}
            strokeWidth="2.2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <div className="chart-range mono">
        <span>L {formatStars(min, 2)}</span>
        <span>H {formatStars(max, 2)}</span>
      </div>
    </div>
  );
}
