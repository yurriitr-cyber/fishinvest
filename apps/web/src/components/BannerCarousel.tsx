import { useEffect, useState } from 'react';

const BANNER_VER = '20260827c';

const BANNERS = [
  `/banners/banner-1.jpg?v=${BANNER_VER}`,
  `/banners/banner-2.jpg?v=${BANNER_VER}`,
  `/banners/banner-3.jpg?v=${BANNER_VER}`,
  `/banners/banner-4.jpg?v=${BANNER_VER}`,
  `/banners/banner-5.jpg?v=${BANNER_VER}`,
  `/banners/banner-6.jpg?v=${BANNER_VER}`,
] as const;

const ROTATE_MS = 4500;

export function BannerCarousel() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || BANNERS.length <= 1) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % BANNERS.length);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [paused]);

  return (
    <div
      className="banner-carousel"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div
        className="banner-track"
        style={{ transform: `translateX(-${index * 100}%)` }}
      >
        {BANNERS.map((src, i) => (
          <div className="banner-slide" key={src}>
            <img
              src={src}
              alt=""
              draggable={false}
              loading={i === 0 ? 'eager' : 'lazy'}
            />
          </div>
        ))}
      </div>
      <div className="banner-dots" role="tablist" aria-label="Баннеры">
        {BANNERS.map((src, i) => (
          <button
            key={src}
            type="button"
            role="tab"
            aria-selected={i === index}
            className={`banner-dot${i === index ? ' active' : ''}`}
            onClick={() => setIndex(i)}
          />
        ))}
      </div>
    </div>
  );
}
