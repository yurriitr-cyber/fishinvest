import { useEffect, useRef, type RefObject } from 'react';
import { TABS, type Tab } from '../components/BottomNav';
import { hapticImpact } from './telegram';

const LOCK_PX = 12;
const SWIPE_PX = 56;

function isSwipeBlocked(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  if (target.closest('input, textarea, select')) return true;
  if (
    target.closest('.nav, .case-rail, .reel, .reel-viewport')
  ) {
    return true;
  }
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

export function useTabSwipe(
  enabled: boolean,
  tab: Tab,
  onChange: (tab: Tab) => void,
  rootRef: RefObject<HTMLElement | null>,
) {
  const tabRef = useRef(tab);
  const onChangeRef = useRef(onChange);
  tabRef.current = tab;
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!enabled) return;
    const root = rootRef.current;
    if (!root) return;

    let tracking = false;
    let axis: 'h' | 'v' | null = null;
    let pointerId = -1;
    let startX = 0;
    let startY = 0;

    const reset = (id: number) => {
      tracking = false;
      axis = null;
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
      startX = e.clientX;
      startY = e.clientY;
    };

    const onMove = (e: PointerEvent) => {
      if (!tracking || e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!axis) {
        if (Math.abs(dx) < LOCK_PX && Math.abs(dy) < LOCK_PX) return;
        axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'h' : 'v';
        if (axis === 'h') {
          try {
            root.setPointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
        } else {
          tracking = false;
        }
      }
      if (axis === 'h' && e.cancelable) e.preventDefault();
    };

    const onUp = (e: PointerEvent) => {
      if (!tracking || e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const wasHorizontal = axis === 'h';
      reset(e.pointerId);
      if (!wasHorizontal) return;
      if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) <= Math.abs(dy)) return;
      const idx = TABS.indexOf(tabRef.current);
      const next = idx + (dx < 0 ? 1 : -1);
      if (next < 0 || next >= TABS.length) return;
      onChangeRef.current(TABS[next]);
      void hapticImpact('light');
    };

    root.addEventListener('pointerdown', onDown);
    root.addEventListener('pointermove', onMove, { passive: false });
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', onUp);
    return () => {
      root.removeEventListener('pointerdown', onDown);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerup', onUp);
      root.removeEventListener('pointercancel', onUp);
    };
  }, [enabled, rootRef]);
}
