import { useEffect, useState } from 'react';
import { useVisibleInterval } from '../lib/perf';

const BANNER_VER = '20260829a';

const BANNERS = [
  `/banners/banner-1.jpg?v=${BANNER_VER}`,
  `/banners/banner-2.jpg?v=${BANNER_VER}`,
  `/banners/banner-3.jpg?v=${BANNER_VER}`,
  `/banners/banner-4.jpg?v=${BANNER_VER}`,
  `/banners/banner-5.jpg?v=${BANNER_VER}`,
] as const;

const SLIDES = [...BANNERS, BANNERS[0]];
const LAST_REAL = BANNERS.length - 1;
const ROTATE_MS = 4500;

export function BannerCarousel() {
  const [index, setIndex] = useState(0);
  const [snap, setSnap] = useState(false);

  useVisibleInterval(() => {
    setIndex((i) => (i > LAST_REAL ? i : i + 1));
  }, ROTATE_MS, BANNERS.length > 1);

  function loopToStart() {
    if (index !== BANNERS.length) return;
    setSnap(true);
    setIndex(0);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setSnap(false));
    });
  }

  useEffect(() => {
    if (index !== BANNERS.length) return;
    const id = window.setTimeout(loopToStart, 540);
    return () => window.clearTimeout(id);
  }, [index]);

  return (
    <div className="banner-wrap">
      <div className="banner-carousel" aria-hidden>
        <div
          className={`banner-track${snap ? ' snap' : ''}`}
          style={{ transform: `translateX(-${index * 100}%)` }}
          onTransitionEnd={(e) => {
            if (e.target !== e.currentTarget) return;
            loopToStart();
          }}
        >
          {SLIDES.map((src, i) => (
            <div className="banner-slide" key={`${src}-${i}`}>
              <img
                src={src}
                alt=""
                width={1672}
                height={941}
                draggable={false}
                loading={i === 0 ? 'eager' : 'lazy'}
                decoding="async"
                fetchPriority={i === 0 ? 'high' : 'low'}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
