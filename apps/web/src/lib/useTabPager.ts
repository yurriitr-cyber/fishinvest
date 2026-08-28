import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { TABS, type Tab } from '../components/BottomNav';
import { hapticImpact } from './telegram';

const LOCK_PX = 10;
const SNAP = 0.2;
const VEL = 0.38;
const RUBBER = 0.35;
const EASE = 'transform 420ms cubic-bezier(0.22, 1, 0.36, 1)';

function isSwipeBlocked(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, select')) return true;
  if (target.closest('.case-rail, .reel, .reel-viewport')) return true;
  let node: HTMLElement | null =
    target instanceof HTMLElement ? target : target.parentElement;
  while (node) {
    const { overflowX } = getComputedStyle(node);
    if (
      (overflowX === 'auto' || overflowX === 'scroll') &&
      node.scrollWidth > node.clientWidth + 8
    ) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

export function useTabPager({
  enabled,
  tab,
  onChange,
  onHint,
  viewportRef,
  trackRef,
  thumbRef,
}: {
  enabled: boolean;
  tab: Tab;
  onChange: (tab: Tab) => void;
  onHint?: (tab: Tab) => void;
  viewportRef: RefObject<HTMLElement | null>;
  trackRef: RefObject<HTMLElement | null>;
  thumbRef: RefObject<HTMLElement | null>;
}) {
  const tabRef = useRef(tab);
  const onChangeRef = useRef(onChange);
  const onHintRef = useRef(onHint);
  const draggingRef = useRef(false);
  const hintRef = useRef(tab);
  tabRef.current = tab;
  onChangeRef.current = onChange;
  onHintRef.current = onHint;

  const paint = (index: number, dx: number, animate: boolean) => {
    const track = trackRef.current;
    const thumb = thumbRef.current;
    const viewport = viewportRef.current;
    if (!track || !viewport) return;
    const width = viewport.clientWidth || 1;
    const last = TABS.length - 1;
    let x = -index * width + dx;
    if (index === 0 && dx > 0) x = dx * RUBBER;
    if (index === last && dx < 0) x = -index * width + dx * RUBBER;
    track.style.transition = animate ? EASE : 'none';
    track.style.transform = `translate3d(${x}px, 0, 0)`;
    if (!thumb) return;
    const progress = Math.min(last, Math.max(0, index - dx / width));
    thumb.style.transition = animate ? EASE : 'none';
    thumb.style.transform = `translate3d(calc(${progress} * (100% + 2px)), 0, 0)`;
    const hint = TABS[Math.round(progress)] ?? TABS[0];
    if (hint !== hintRef.current) {
      hintRef.current = hint;
      onHintRef.current?.(hint);
    }
  };

  useLayoutEffect(() => {
    if (!enabled || draggingRef.current) return;
    paint(TABS.indexOf(tab), 0, false);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || draggingRef.current) return;
    paint(TABS.indexOf(tab), 0, true);
  }, [enabled, tab]);

  useEffect(() => {
    if (!enabled) return;
    const root = viewportRef.current?.closest('.app-shell') ?? viewportRef.current;
    const viewport = viewportRef.current;
    if (!root || !viewport) return;

    let tracking = false;
    let axis: 'h' | 'v' | null = null;
    let pointerId = -1;
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastT = 0;
    let vx = 0;
    let index = TABS.indexOf(tabRef.current);

    const blockClick = (ev: Event) => {
      ev.preventDefault();
      ev.stopPropagation();
      window.removeEventListener('click', blockClick, true);
    };

    const reset = (id: number) => {
      tracking = false;
      axis = null;
      draggingRef.current = false;
      try {
        if (root.hasPointerCapture(id)) root.releasePointerCapture(id);
      } catch {
        /* ignore */
      }
    };

    const onDown = (e: PointerEvent) => {
      if (!e.isPrimary) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (isSwipeBlocked(e.target)) return;
      tracking = true;
      axis = null;
      pointerId = e.pointerId;
      startX = lastX = e.clientX;
      startY = e.clientY;
      lastT = e.timeStamp;
      vx = 0;
      index = TABS.indexOf(tabRef.current);
    };

    const onMove = (e: PointerEvent) => {
      if (!tracking || e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!axis) {
        if (Math.abs(dx) < LOCK_PX && Math.abs(dy) < LOCK_PX) return;
        axis = Math.abs(dx) > Math.abs(dy) * 1.15 ? 'h' : 'v';
        if (axis === 'h') {
          draggingRef.current = true;
          try {
            root.setPointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
        } else {
          tracking = false;
          return;
        }
      }
      if (axis !== 'h') return;
      if (e.cancelable) e.preventDefault();
      const dt = e.timeStamp - lastT;
      if (dt > 0) vx = (e.clientX - lastX) / dt;
      lastX = e.clientX;
      lastT = e.timeStamp;
      paint(index, dx, false);
    };

    const onUp = (e: PointerEvent) => {
      if (!tracking || e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      const wasHorizontal = axis === 'h';
      reset(e.pointerId);
      if (!wasHorizontal) return;
      const width = viewport.clientWidth || 1;
      const last = TABS.length - 1;
      let next = index;
      if (vx < -VEL || dx < -width * SNAP) next = index + 1;
      else if (vx > VEL || dx > width * SNAP) next = index - 1;
      next = Math.min(last, Math.max(0, next));
      if (Math.abs(dx) > LOCK_PX) {
        window.addEventListener('click', blockClick, true);
        window.setTimeout(() => window.removeEventListener('click', blockClick, true), 400);
      }
      paint(next, 0, true);
      if (TABS[next] !== tabRef.current) {
        onChangeRef.current(TABS[next]);
        void hapticImpact('light');
      }
    };

    const onResize = () => {
      if (draggingRef.current) return;
      paint(TABS.indexOf(tabRef.current), 0, false);
    };

    root.addEventListener('pointerdown', onDown);
    root.addEventListener('pointermove', onMove, { passive: false });
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', onUp);
    window.addEventListener('resize', onResize);
    return () => {
      root.removeEventListener('pointerdown', onDown);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerup', onUp);
      root.removeEventListener('pointercancel', onUp);
      window.removeEventListener('resize', onResize);
    };
  }, [enabled, viewportRef, trackRef, thumbRef]);
}
