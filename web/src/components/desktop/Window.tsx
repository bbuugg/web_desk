import { useCallback, useRef } from 'react';
import {
  FolderOpen, TerminalSquare, Activity, Settings,
  FileText, FileImage, PlaySquare, FileArchive,
  Minus, Square, X, Copy,
} from 'lucide-react';
import type { WindowState, WindowManagerActions } from '@/types/desktop';

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  FolderOpen, TerminalSquare, Activity, Settings,
  FileText, FileImage, PlaySquare, FileArchive,
};

interface WindowProps {
  windowState: WindowState;
  actions: WindowManagerActions;
  children: React.ReactNode;
}

const TASKBAR_HEIGHT = 56;

export default function Window({ windowState, actions, children }: WindowProps) {
  const { id, title, icon, x, y, width, height, isMinimized, isMaximized, isFocused, zIndex } = windowState;
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; origX: number; origY: number } | null>(null);

  const IconComponent = iconMap[icon] || Settings;

  // --- Drag ---
  const handleTitlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (isMaximized) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;

    e.preventDefault();
    actions.focusWindow(id);

    const startX = e.clientX;
    const startY = e.clientY;
    dragRef.current = { pointerId: e.pointerId, startX, startY, origX: x, origY: y };

    e.currentTarget.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current || ev.pointerId !== dragRef.current.pointerId) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      actions.updateWindowPosition(id, dragRef.current.origX + dx, Math.max(0, dragRef.current.origY + dy));
    };
    const onUp = (ev: PointerEvent) => {
      if (!dragRef.current || ev.pointerId !== dragRef.current.pointerId) return;
      dragRef.current = null;
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  }, [id, x, y, isMaximized, actions]);

  // --- Resize ---
  const handleResizeStart = useCallback((e: React.MouseEvent, direction: string) => {
    if (isMaximized) return;
    e.stopPropagation();
    e.preventDefault();
    actions.focusWindow(id);

    const startX = e.clientX;
    const startY = e.clientY;
    const startW = width;
    const startH = height;
    const startLeft = x;
    const startTop = y;

    const onMove = (ev: MouseEvent) => {
      let newW = startW, newH = startH, newX = startLeft, newY = startTop;

      if (direction.includes('e')) newW = Math.max(windowState.minWidth, startW + (ev.clientX - startX));
      if (direction.includes('w')) {
        const delta = ev.clientX - startX;
        newW = Math.max(windowState.minWidth, startW - delta);
        if (newW > windowState.minWidth) newX = startLeft + delta;
      }
      if (direction.includes('s')) newH = Math.max(windowState.minHeight, startH + (ev.clientY - startY));
      if (direction.includes('n')) {
        const delta = ev.clientY - startY;
        newH = Math.max(windowState.minHeight, startH - delta);
        if (newH > windowState.minHeight) newY = startTop + delta;
      }

      actions.updateWindowSize(id, newW, newH, newX, newY);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [id, x, y, width, height, isMaximized, windowState.minWidth, windowState.minHeight, actions]);

  // Note: do NOT unmount on minimize. Returning null here would tear down the
  // entire app subtree (Terminal/FileManager/etc.) and lose its state, open
  // WebSockets, scroll position, etc. Hide it via CSS instead so child
  // components keep running in the background.
  const style: React.CSSProperties = isMaximized
    ? { top: 0, left: 0, width: '100%', height: `calc(100dvh - ${TASKBAR_HEIGHT}px)`, zIndex }
    : { top: y, left: x, width, height, zIndex };
  if (isMinimized) {
    style.display = 'none';
  }

  return (
    <div
      className={`desktop-window absolute flex flex-col transition-shadow duration-200 ${isMaximized ? 'rounded-none' : 'rounded-xl'} overflow-hidden ${isFocused ? 'shadow-2xl shadow-black/60 ring-1 ring-white/10' : 'shadow-xl shadow-black/40 ring-1 ring-white/5'}`}
      style={style}
      onMouseDown={() => actions.focusWindow(id)}
    >
      {/* Title bar */}
      <div
        className={`flex items-center h-10 px-3 gap-2 shrink-0 select-none cursor-default touch-none ${isFocused ? 'bg-[#1a1f2e]' : 'bg-[#16191f]'}`}
        onPointerDown={handleTitlePointerDown}
        onDoubleClick={() => actions.maximizeWindow(id)}
      >
        <IconComponent className="w-4 h-4 text-emerald-400 shrink-0" />
        <span className={`text-xs font-medium truncate flex-1 ${isFocused ? 'text-gray-200' : 'text-gray-500'}`}>{title}</span>

        <div className="flex items-center gap-0.5">
          <button
            className="p-1.5 rounded-md hover:bg-white/10 transition-colors text-gray-400 hover:text-white"
            title="Minimize"
            aria-label="Minimize"
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); actions.minimizeWindow(id); }}
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            className="p-1.5 rounded-md hover:bg-white/10 transition-colors text-gray-400 hover:text-white"
            title={isMaximized ? 'Restore' : 'Maximize'}
            aria-label={isMaximized ? 'Restore' : 'Maximize'}
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); actions.maximizeWindow(id); }}
          >
            {isMaximized ? <Copy className="w-3 h-3" /> : <Square className="w-3 h-3" />}
          </button>
          <button
            className="p-1.5 rounded-md hover:bg-red-500/80 transition-colors text-gray-400 hover:text-white"
            title="Close"
            aria-label="Close"
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); actions.closeWindow(id); }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden bg-[#0d1117]">
        {children}
      </div>

      {/* Resize handles (only when not maximized) */}
      {!isMaximized && (
        <>
          {/* Edges */}
          <div className="absolute top-0 left-2 right-2 h-1 cursor-n-resize" onMouseDown={e => handleResizeStart(e, 'n')} />
          <div className="absolute bottom-0 left-2 right-2 h-1 cursor-s-resize" onMouseDown={e => handleResizeStart(e, 's')} />
          <div className="absolute left-0 top-2 bottom-2 w-1 cursor-w-resize" onMouseDown={e => handleResizeStart(e, 'w')} />
          <div className="absolute right-0 top-2 bottom-2 w-1 cursor-e-resize" onMouseDown={e => handleResizeStart(e, 'e')} />
          {/* Corners */}
          <div className="absolute top-0 left-0 w-3 h-3 cursor-nw-resize" onMouseDown={e => handleResizeStart(e, 'nw')} />
          <div className="absolute top-0 right-0 w-3 h-3 cursor-ne-resize" onMouseDown={e => handleResizeStart(e, 'ne')} />
          <div className="absolute bottom-0 left-0 w-3 h-3 cursor-sw-resize" onMouseDown={e => handleResizeStart(e, 'sw')} />
          <div className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize" onMouseDown={e => handleResizeStart(e, 'se')} />
        </>
      )}
    </div>
  );
}
