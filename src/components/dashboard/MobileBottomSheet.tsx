import { useRef, useEffect, useLayoutEffect, useCallback, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface MobileBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** Fires after the close animation finishes and the sheet unmounts. */
  onExited?: () => void;
  children: ReactNode;
}

const SNAP_CLOSED = 0;
const SNAP_PEEK = 48;
const SNAP_FULL = 100;
const VELOCITY_THRESHOLD = 0.5;
const DRAG_THRESHOLD = 10;

export function MobileBottomSheet({ isOpen, onClose, onExited, children }: MobileBottomSheetProps) {
  const dragRef = useRef({
    isDragging: false,
    startY: 0,
    startHeight: 0,
    currentHeight: 0,
    lastY: 0,
    lastTime: 0,
    previousY: 0,
    previousTime: 0,
    hasMoved: false,
  });
  const [sheetHeight, setSheetHeight] = useState(SNAP_CLOSED);
  const [isDragging, setIsDragging] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [maxSheetHeightPx, setMaxSheetHeightPx] = useState(0);
  const [bottomOffset, setBottomOffset] = useState(0);
  const sheetRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;

  useEffect(() => {
    const updateLayout = () => {
      const header = document.querySelector<HTMLElement>('[data-top-bar]');
      const controls = document.querySelector<HTMLElement>('[data-mobile-controls]');
      const vv = window.visualViewport;
      const layoutH = window.innerHeight;
      const keyboardGap = vv
        ? Math.max(0, layoutH - (vv.offsetTop + vv.height))
        : 0;
      const controlsTop = controls?.getBoundingClientRect().top ?? layoutH;
      setBottomOffset(Math.max(keyboardGap, layoutH - controlsTop));

      const topBarBottom = header
        ? header.getBoundingClientRect().bottom
        : 0;
      const availableBottom = vv
        ? vv.offsetTop + vv.height
        : layoutH;

      const available = Math.max(0, Math.min(availableBottom, controlsTop) - topBarBottom);
      setMaxSheetHeightPx(available);
    };

    updateLayout();
    window.addEventListener('resize', updateLayout);
    window.visualViewport?.addEventListener('resize', updateLayout);
    window.visualViewport?.addEventListener('scroll', updateLayout);

    const header = document.querySelector<HTMLElement>('[data-top-bar]');
    const controls = document.querySelector<HTMLElement>('[data-mobile-controls]');
    const observer = new ResizeObserver(updateLayout);
    if (header && observer) {
      observer.observe(header);
    }
    if (controls) observer.observe(controls);

    return () => {
      window.removeEventListener('resize', updateLayout);
      window.visualViewport?.removeEventListener('resize', updateLayout);
      window.visualViewport?.removeEventListener('scroll', updateLayout);
      if (observer) {
        observer.disconnect();
      }
    };
  }, []);

  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setSheetHeight(SNAP_PEEK);
        });
      });
    } else {
      setSheetHeight(SNAP_CLOSED);
      const timer = setTimeout(() => {
        setIsVisible(false);
        onExitedRef.current?.();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const snapTo = useCallback((targetHeight: number) => {
    if (targetHeight <= 10) {
      setSheetHeight(SNAP_CLOSED);
      onClose();
    } else {
      setSheetHeight(Math.min(targetHeight, SNAP_FULL));
    }
  }, [onClose]);

  const getClosestSnap = useCallback((height: number, velocity: number) => {
    if (velocity > VELOCITY_THRESHOLD) {
      if (height > SNAP_PEEK + 10) return SNAP_PEEK;
      return SNAP_CLOSED;
    }
    if (velocity < -VELOCITY_THRESHOLD) {
      if (height < SNAP_PEEK - 10) return SNAP_PEEK;
      return SNAP_FULL;
    }

    const snaps = [SNAP_CLOSED, SNAP_PEEK, SNAP_FULL];
    let closest = snaps[0];
    let minDist = Math.abs(height - closest);
    for (const snap of snaps) {
      const dist = Math.abs(height - snap);
      if (dist < minDist) {
        minDist = dist;
        closest = snap;
      }
    }
    return closest;
  }, []);

  const handlePointerStart = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const now = Date.now();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      isDragging: true,
      startY: e.clientY,
      startHeight: sheetHeight,
      currentHeight: sheetHeight,
      lastY: e.clientY,
      lastTime: now,
      previousY: e.clientY,
      previousTime: now,
      hasMoved: false,
    };
    setIsDragging(true);
  }, [sheetHeight]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current.isDragging) return;

    const deltaY = dragRef.current.startY - e.clientY;
    const deltaPercent = maxSheetHeightPx > 0 ? (deltaY / maxSheetHeightPx) * 100 : 0;
    const now = Date.now();

    if (Math.abs(e.clientY - dragRef.current.startY) > DRAG_THRESHOLD) {
      dragRef.current.hasMoved = true;
    }

    dragRef.current.previousY = dragRef.current.lastY;
    dragRef.current.previousTime = dragRef.current.lastTime;
    dragRef.current.lastY = e.clientY;
    dragRef.current.lastTime = now;

    const newHeight = Math.max(0, Math.min(SNAP_FULL + 5, dragRef.current.startHeight + deltaPercent));
    dragRef.current.currentHeight = newHeight;
    setSheetHeight(newHeight);
  }, [maxSheetHeightPx]);

  const handlePointerEnd = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current.isDragging) return;

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (err) {
      // Pointer may already be released; safe to ignore.
      void err;
    }

    const now = Date.now();
    const dt = now - dragRef.current.previousTime || 1;
    const dy = e.clientY - dragRef.current.previousY;
    const velocity = now - dragRef.current.lastTime > 100 || e.type === "pointercancel" ? 0 : dy / dt;

    dragRef.current.isDragging = false;
    setIsDragging(false);

    if (!dragRef.current.hasMoved) return;

    const closest = getClosestSnap(dragRef.current.currentHeight, velocity);
    snapTo(closest);
  }, [getClosestSnap, snapTo]);

  useEffect(() => {
    if (!isVisible) return;
    const viewport = window.visualViewport;
    const keyboardGap = viewport ? window.innerHeight - viewport.offsetTop - viewport.height : 0;
    if (keyboardGap > 50 && sheetHeight < SNAP_FULL) {
      setSheetHeight(SNAP_FULL);
    }
  }, [bottomOffset, isVisible, sheetHeight]);

  useLayoutEffect(() => {
    if (!isVisible) return;
    const sheet = sheetRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openerRef.current = opener;
    sheet?.focus({ preventScroll: true });
    return () => {
      if (sheet?.contains(document.activeElement) && opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [isVisible]);

  useLayoutEffect(() => {
    if (!isOpen && sheetRef.current?.contains(document.activeElement) && openerRef.current?.isConnected) {
      openerRef.current.focus({ preventScroll: true });
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]')) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isVisible) return null;

  const sheetHeightPx = (sheetHeight / 100) * maxSheetHeightPx;

  return createPortal(
      <div
        ref={sheetRef}
        role="dialog"
        aria-label="ZIP details"
        tabIndex={-1}
        className="fixed left-0 right-0 z-50 bg-dashboard-panel rounded-t-[14px] flex flex-col shadow-[0_-10px_40px_rgba(0,0,0,0.15)]"
        style={{
          bottom: `${bottomOffset}px`,
          height: `${sheetHeightPx}px`,
          transition: isDragging ? 'none' : 'height 300ms cubic-bezier(0.32, 0.72, 0, 1), bottom 100ms ease',
          willChange: 'height, bottom',
          maxHeight: `${maxSheetHeightPx}px`,
        }}
      >
        {/* Drag handle area */}
        <div className="relative flex-shrink-0">
          <div
            className="absolute inset-x-0 -top-5 h-16 cursor-grab active:cursor-grabbing touch-none select-none z-10"
            onPointerDown={handlePointerStart}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
          />
          <div className="py-2">
            <div className="mx-auto w-12 h-1 rounded-full bg-gray-300" />
          </div>
          <button className="relative z-20 mx-auto block min-h-10 px-4 text-xs underline"
            aria-expanded={sheetHeight > SNAP_PEEK}
            onClick={() => snapTo(sheetHeight > SNAP_PEEK ? SNAP_PEEK : SNAP_FULL)}>
            {sheetHeight > SNAP_PEEK ? "Collapse details" : "Expand details"}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden min-h-0">
          {children}
        </div>
      </div>, document.body,
  );
}
