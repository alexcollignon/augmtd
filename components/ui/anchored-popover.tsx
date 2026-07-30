'use client';

// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE OVERLAY LAW (July 29): a popover must ESCAPE its clipping ancestors. Deck rows live inside
// overflow-hidden collapse wrappers and transform-animated sections (each a stacking context), so
// an in-flow `absolute` panel gets CLIPPED at the card bounds and LAYERED under later siblings
// (the right rail) no matter its z-index — the "Add to project" picker bug. No z-index wins a
// fight across stacking contexts; the only correct move is out: portal to <body>, fixed-position
// from the anchor's rect. ONE primitive for every anchored panel; owns reposition-on-scroll/resize,
// outside-click, and Escape, so no door reimplements (or half-implements) the mechanics.
// ════════════════════════════════════════════════════════════════════════════════════════════════

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function AnchoredPopover({ anchorRef, open, onClose, align = 'right', width = 240, children }: {
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  align?: 'left' | 'right';
  width?: number;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const place = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      const left = align === 'right'
        ? Math.max(8, Math.min(r.right, window.innerWidth - 8) - width)
        : Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      // Flip above only when the space below is genuinely tight and above has more room.
      const below = window.innerHeight - r.bottom;
      if (below < 320 && r.top > below) setPos({ bottom: window.innerHeight - r.top + 6, left });
      else setPos({ top: r.bottom + 6, left });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open, align, width, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, onClose, anchorRef]);

  if (!open || !pos || typeof document === 'undefined') return null;
  return createPortal(
    <div ref={panelRef} style={{ position: 'fixed', width, ...pos }} className="z-[70]" onClick={(e) => e.stopPropagation()}>
      {children}
    </div>,
    document.body
  );
}
