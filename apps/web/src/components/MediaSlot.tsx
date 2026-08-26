import type { CSSProperties } from 'react';

/** Empty frame for future photo / gif / animation. */
export function MediaSlot({
  label = 'Media',
  ratio = '16 / 10',
  className = '',
}: {
  label?: string;
  ratio?: string;
  className?: string;
}) {
  return (
    <div
      className={`media-slot ${className}`.trim()}
      style={{ '--media-ratio': ratio } as CSSProperties}
      aria-hidden
    >
      <span>{label}</span>
    </div>
  );
}
