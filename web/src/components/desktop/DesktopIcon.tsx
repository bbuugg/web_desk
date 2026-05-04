import { useRef, useCallback, useEffect, useState } from 'react';
import { Rnd, type DraggableData, type RndDragEvent } from 'react-rnd';
import {
  FolderOpen, TerminalSquare, Activity, Settings, FileText, FileImage, PlaySquare, FileArchive, Trash2,
} from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import type { DesktopApp } from '@/types/desktop';
import { useIsMobile } from '@/hooks/use-mobile';

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  FolderOpen, TerminalSquare, Activity, Settings, FileText, FileImage, PlaySquare, FileArchive,
};

const iconColors: Record<string, string> = {
  FolderOpen: 'text-amber-400',
  TerminalSquare: 'text-emerald-400',
  Activity: 'text-sky-400',
  Settings: 'text-gray-400',
  FileText: 'text-blue-500',
  FileImage: 'text-purple-400',
  PlaySquare: 'text-purple-400',
  FileArchive: 'text-amber-500',
};

interface DesktopIconProps {
  app: DesktopApp;
  isSelected: boolean;
  defaultPosition: { x: number; y: number };
  rndKey: string;
  onSelect: (e?: React.MouseEvent) => void;
  onOpen: () => void;
  onDragStop: (x: number, y: number) => void;
  onRemove?: () => void;
}

export default function DesktopIcon({ app, isSelected, defaultPosition, rndKey, onSelect, onOpen, onDragStop, onRemove }: DesktopIconProps) {
  const IconComponent = iconMap[app.icon] || Settings;
  const colorClass = iconColors[app.icon] || 'text-gray-400';
  const isMobile = useIsMobile();
  const didDragRef = useRef(false);
  const isDraggingRef = useRef(false);
  const startPosRef = useRef(defaultPosition);
  const [pos, setPos] = useState(defaultPosition);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const touchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchMovedRef = useRef(false);

  const handleDragStart = useCallback(() => {
    isDraggingRef.current = true;
    didDragRef.current = false;
  }, []);

  const handleDrag = useCallback((_e: RndDragEvent, data: DraggableData) => {
    if (Math.abs(data.x - startPosRef.current.x) > 4 || Math.abs(data.y - startPosRef.current.y) > 4) {
      didDragRef.current = true;
    }
    setPos({ x: data.x, y: data.y });
  }, []);

  const handleDragStop = useCallback((_e: RndDragEvent, data: DraggableData) => {
    isDraggingRef.current = false;
    setPos({ x: data.x, y: data.y });
    onDragStop(data.x, data.y);
    startPosRef.current = { x: data.x, y: data.y };
  }, [onDragStop]);

  // Native event listeners to handle clicks reliably alongside Rnd's drag system.
  // Rnd/react-draggable intercepts touch events, breaking React's synthetic onClick.
  useEffect(() => {
    const el = buttonRef.current;
    if (!el) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (didDragRef.current) {
        didDragRef.current = false;
        return;
      }
      if (isMobile) {
        onOpen();
      } else {
        onSelect();
      }
    };

    const handleDblClick = () => {
      if (!isMobile) {
        onOpen();
      }
    };

    const handleTouchStart = () => {
      touchMovedRef.current = false;
      if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
      touchTimerRef.current = setTimeout(() => {
        if (!touchMovedRef.current && !didDragRef.current) {
          onOpen();
        }
      }, 250);
    };

    const handleTouchMove = () => {
      touchMovedRef.current = true;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (touchTimerRef.current) {
        clearTimeout(touchTimerRef.current);
        touchTimerRef.current = null;
      }
      if (!touchMovedRef.current && !didDragRef.current) {
        e.preventDefault();
        onOpen();
      }
    };

    el.addEventListener('mousedown', handleMouseDown);
    el.addEventListener('dblclick', handleDblClick);
    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: true });
    el.addEventListener('touchend', handleTouchEnd);

    return () => {
      el.removeEventListener('mousedown', handleMouseDown);
      el.removeEventListener('dblclick', handleDblClick);
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      if (touchTimerRef.current) clearTimeout(touchTimerRef.current);
    };
  }, [isMobile, onOpen, onSelect]);

  return (
    <Rnd
      key={rndKey}
      default={{ x: pos.x, y: pos.y, width: 88, height: 96 }}
      enableResizing={false}
      bounds="#icon-area"
      dragGrid={[4, 4]}
      onDragStart={handleDragStart}
      onDrag={handleDrag}
      onDragStop={handleDragStop}
      className="!absolute"
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            ref={buttonRef}
            className="flex flex-col items-center gap-1.5 p-3 rounded-xl w-[88px] transition-all duration-150 select-none group outline-none
              hover:bg-white/5
            "
            style={isSelected ? { backgroundColor: 'rgba(255,255,255,0.1)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.2)' } : undefined}
          >
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center bg-white/5 group-hover:bg-white/10 transition-colors ${isSelected ? 'bg-white/10' : ''}`}>
              <IconComponent className={`w-7 h-7 ${colorClass} transition-transform group-hover:scale-110`} />
            </div>
            <span className="text-[11px] text-gray-300 text-center leading-tight font-medium drop-shadow-sm">{app.name}</span>
          </button>
        </ContextMenuTrigger>
        {onRemove && (
          <ContextMenuContent className="z-[10002] w-44 border-white/10 text-gray-200 liquid-glass">
            <ContextMenuItem
              className="focus:liquid-glass-active focus:text-white"
              onClick={onRemove}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              从桌面移除
            </ContextMenuItem>
          </ContextMenuContent>
        )}
      </ContextMenu>
    </Rnd>
  );
}
