import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface RefActionItem {
  id: string;
  icon: React.ElementType;
  label: string;
  active?: boolean;
  tone?: 'amber' | 'cyan' | 'lime' | 'red' | 'gray';
  disabled?: boolean;
  onClick: () => void;
}

interface RefActionPopoverProps {
  anchorRect: DOMRect;
  items: RefActionItem[];
  children?: React.ReactNode;
  compactActions?: boolean;
  onClose: () => void;
}

export const RefActionPopover: React.FC<RefActionPopoverProps> = ({ anchorRect, items, children, compactActions, onClose }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  // Compute an initial anchored position from the anchor rect so the element is rendered
  // at (approximately) the correct place on the very first paint. Using transform(-50%, ...)
  // avoids needing to know the panel's own width/height on first render. We also pick an
  // initial top/bottom guess based on where the anchor sits on screen, so the transition
  // doesn't visibly slide when the final placement matches our guess.
  const guessBelow = anchorRect.top < 200;
  const initialLeft = anchorRect.left + anchorRect.width / 2;
  const initialTop = guessBelow ? anchorRect.bottom + 8 : anchorRect.top - 8;
  const initialYTranslate = guessBelow ? '0' : '-100%';
  const initialOrigin = guessBelow ? 'center top' : 'center bottom';
  const [style, setStyle] = useState<React.CSSProperties>({
    position: 'fixed',
    top: `${initialTop}px`,
    left: `${initialLeft}px`,
    transform: `translate(-50%, ${initialYTranslate}) scale(0.95)`,
    transformOrigin: initialOrigin,
    opacity: 0,
    zIndex: 9999,
    pointerEvents: 'none',
  });
  const [placement, setPlacement] = useState<'top' | 'bottom'>('top');
  const [caretLeft, setCaretLeft] = useState<number>(0);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    if (!panelRef.current) return;
    // Layout dimensions ignore the opening scale animation.
    const panelWidth = panelRef.current.offsetWidth;
    const naturalHeight = panelRef.current.offsetHeight;
    const margin = 8;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    const anchorCenterX = anchorRect.left + anchorRect.width / 2;
    const spaceAbove = anchorRect.top;
    const spaceBelow = viewportH - anchorRect.bottom;
    const placeBottom = spaceAbove < naturalHeight + margin && spaceBelow > spaceAbove;
    const nextPlacement: 'top' | 'bottom' = placeBottom ? 'bottom' : 'top';
    const maxHeight = Math.max(48, (placeBottom ? spaceBelow : spaceAbove) - margin * 2);
    const panelHeight = Math.min(naturalHeight, maxHeight);

    // Clamp center x so the panel stays within viewport margins
    const halfW = panelWidth / 2;
    const minCenter = margin + halfW;
    const maxCenter = viewportW - halfW - margin;
    const centerX = Math.max(minCenter, Math.min(maxCenter, anchorCenterX));

    const desiredTop = placeBottom ? anchorRect.bottom + margin : anchorRect.top - margin - panelHeight;
    const top = Math.max(margin, Math.min(viewportH - panelHeight - margin, desiredTop));
    const origin = placeBottom ? 'center top' : 'center bottom';

    setStyle({
      position: 'fixed',
      top: `${top}px`,
      left: `${centerX}px`,
      transform: 'translateX(-50%) scale(1)',
      transformOrigin: origin,
      opacity: 1,
      zIndex: 9999,
      pointerEvents: 'auto',
      transition: 'transform 150ms ease-out, opacity 150ms ease-out',
      '--ref-popover-max-height': `${maxHeight}px`,
    } as React.CSSProperties);
    setPlacement(nextPlacement);
    // caret x is relative to the panel's left edge
    const panelLeftEdge = centerX - halfW;
    setCaretLeft(Math.max(10, Math.min(panelWidth - 10, anchorCenterX - panelLeftEdge)));
    setReady(true);
  }, [anchorRect, children, compactActions]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleViewportChange = (event: Event) => { if (!(event.target instanceof Node) || !panelRef.current?.contains(event.target)) onClose(); };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('resize', handleViewportChange);
    // Capture scroll events from any scrollable ancestor, but NOT touchmove
    // so touch scrolling the page still closes cleanly on mobile
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [onClose]);

  const toneClasses = (tone: RefActionItem['tone'], active: boolean, disabled: boolean): string => {
    if (disabled) return 'bg-gray-900 text-gray-600 cursor-not-allowed border-gray-800';
    if (active) {
      switch (tone) {
        case 'amber': return 'bg-amber-500 text-black border-amber-500';
        case 'cyan': return 'bg-cyan-500 text-black border-cyan-500';
        case 'lime': return 'bg-lime-500 text-black border-lime-500';
        case 'red': return 'bg-red-500 text-white border-red-500';
        default: return 'bg-gray-700 text-white border-gray-600';
      }
    }
    switch (tone) {
      case 'amber': return 'bg-gray-800 text-gray-200 border-gray-700 hover:bg-amber-500 hover:text-black hover:border-amber-500 active:bg-amber-500 active:text-black';
      case 'cyan': return 'bg-gray-800 text-gray-200 border-gray-700 hover:bg-cyan-500 hover:text-black hover:border-cyan-500 active:bg-cyan-500 active:text-black';
      case 'lime': return 'bg-gray-800 text-gray-200 border-gray-700 hover:bg-lime-500 hover:text-black hover:border-lime-500 active:bg-lime-500 active:text-black';
      case 'red': return 'bg-gray-800 text-gray-200 border-gray-700 hover:bg-red-500 hover:text-white hover:border-red-500 active:bg-red-500 active:text-white';
      default: return 'bg-gray-800 text-gray-200 border-gray-700 hover:bg-gray-700 active:bg-gray-700';
    }
  };

  return createPortal(
    <div
      ref={panelRef}
      style={style}
      className={`w-[240px] max-w-[calc(100vw-16px)] rounded-xl border shadow-2xl ${compactActions ? 'border-gray-700 bg-[#0d1117] p-1.5' : 'border-gray-700 bg-[#1c2128] p-2'}`}
      onMouseDown={(e) => e.stopPropagation()}
      role="menu"
      aria-hidden={!ready}
    >
      <div className="overflow-y-auto" style={{ maxHeight: `calc(var(--ref-popover-max-height, 100dvh) - ${compactActions ? 14 : 18}px)` }}>
      {children}
      <div className={compactActions ? 'space-y-0.5' : 'grid grid-cols-2 items-stretch gap-1.5'}>
        {items.map((item, index) => {
          const Icon = item.icon;
          const centerLastItem = items.length % 2 === 1 && index === items.length - 1;
          return (
            <button
              key={item.id}
              onClick={item.disabled ? undefined : item.onClick}
              disabled={item.disabled}
              title={item.label}
              className={compactActions ? `flex min-h-8 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 ${item.disabled ? 'cursor-not-allowed text-gray-600' : item.tone === 'red' ? 'text-gray-400 hover:bg-red-500/10 hover:text-red-300' : item.active ? 'bg-[#1b2330] text-white' : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'}` : `flex min-h-[52px] min-w-0 flex-col items-center justify-center gap-1 rounded-lg border px-1.5 py-2 text-[10px] font-semibold transition-colors ${
                centerLastItem ? 'col-span-2 w-[calc(50%-3px)] justify-self-center' : 'w-full'
              } ${toneClasses(item.tone, !!item.active, !!item.disabled)}`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className={`${compactActions ? 'min-w-0 truncate' : 'whitespace-nowrap'} leading-none`}>{item.label}</span>
            </button>
          );
        })}
      </div>
      </div>
      <div
        className={`absolute w-2 h-2 border-gray-700 rotate-45 ${compactActions ? 'bg-[#0d1117]' : 'bg-[#1c2128]'}`}
        style={{
          left: `${caretLeft - 4}px`,
          ...(placement === 'top'
            ? { bottom: '-5px', borderRight: '1px solid', borderBottom: '1px solid', borderColor: 'rgb(55 65 81)' }
            : { top: '-5px', borderLeft: '1px solid', borderTop: '1px solid', borderColor: 'rgb(55 65 81)' }),
        }}
      />
    </div>,
    document.body
  );
};
