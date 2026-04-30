import { useMemo, useState } from 'react';
import {
  Activity,
  FileArchive,
  FileImage,
  FileText,
  FolderOpen,
  LayoutGrid,
  Monitor,
  PlaySquare,
  Settings,
  TerminalSquare,
  X,
} from 'lucide-react';
import type { DesktopApp, WindowManagerActions, WindowState } from '@/types/desktop';
import SystemTray from './SystemTray';
import StartMenu from './StartMenu';
import { useIsMobile } from '@/hooks/use-mobile';

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  FolderOpen,
  TerminalSquare,
  Activity,
  Settings,
  FileText,
  FileImage,
  PlaySquare,
  FileArchive,
};

interface TaskbarProps {
  windows: WindowState[];
  actions: WindowManagerActions;
  apps: DesktopApp[];
  onToggleStartMenu: () => void;
  startMenuOpen: boolean;
}

interface TaskbarWindowGroup {
  appId: string;
  app?: DesktopApp;
  windows: WindowState[];
}

interface PreviewAnchor {
  x: number;
}

function getPrimaryWindow(windows: WindowState[]) {
  return [...windows].sort((a, b) => b.zIndex - a.zIndex)[0];
}

function getWindowPreviewSize(win: WindowState) {
  const maxWidth = 180;
  const maxHeight = 88;
  const scale = Math.min(maxWidth / win.width, maxHeight / win.height, 1);

  return {
    width: Math.max(68, Math.round(win.width * scale)),
    height: Math.max(42, Math.round(win.height * scale)),
  };
}

export default function Taskbar({ windows, actions, apps, onToggleStartMenu, startMenuOpen }: TaskbarProps) {
  const [previewAppId, setPreviewAppId] = useState<string | null>(null);
  const [previewAnchor, setPreviewAnchor] = useState<PreviewAnchor | null>(null);
  const isMobile = useIsMobile();
  const groupedWindows = useMemo(() => {
    return windows.reduce<TaskbarWindowGroup[]>((groups, win) => {
      const existing = groups.find(group => group.appId === win.appId);
      if (existing) {
        existing.windows.push(win);
        return groups;
      }

      groups.push({
        appId: win.appId,
        app: apps.find(app => app.id === win.appId),
        windows: [win],
      });
      return groups;
    }, []);
  }, [apps, windows]);
  const activePreviewGroup = groupedWindows.find(group => group.appId === previewAppId);

  const showPreviewForGroup = (appId: string, element: HTMLElement) => {
    const itemRect = element.getBoundingClientRect();
    const taskbarRect = element.closest('.taskbar')?.getBoundingClientRect();
    setPreviewAppId(appId);
    setPreviewAnchor({
      x: taskbarRect ? itemRect.left + itemRect.width / 2 - taskbarRect.left : itemRect.width / 2,
    });
  };

  const hidePreview = () => {
    setPreviewAppId(null);
    setPreviewAnchor(null);
  };

  return (
    <div
      className={`taskbar absolute bottom-4 left-1/2 z-[9999] flex h-16 -translate-x-1/2 items-center rounded-2xl transition-all duration-500 ease-in-out
        ${isMobile ? 'w-[96vw] gap-1.5 px-2' : 'min-w-[480px] max-w-[80vw] gap-3 px-4'}
      `}
      onClick={e => e.stopPropagation()}
      onMouseLeave={hidePreview}
    >
      {activePreviewGroup && previewAnchor && (
        <div
          className="absolute bottom-full z-[10001] -translate-x-1/2 pb-3"
          style={{ left: previewAnchor.x }}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        >
          <div className="flex max-w-[min(72vw,760px)] gap-2 overflow-x-auto rounded-xl border border-white/10 bg-[#10151f]/95 p-2 shadow-2xl shadow-black/50 backdrop-blur-2xl">
            {activePreviewGroup.windows.map(win => {
              const PreviewIcon = iconMap[win.icon] || iconMap[activePreviewGroup.app?.icon ?? ''] || Settings;
              const previewSize = getWindowPreviewSize(win);
              const isWindowActive = win.isFocused && !win.isMinimized;

              return (
                <div key={win.id} className="group/preview w-48 shrink-0">
                  <button
                    className={`w-full overflow-hidden rounded-lg border text-left transition-all duration-200 ${
                      isWindowActive
                        ? 'border-emerald-400/50 bg-white/12 shadow-[0_0_18px_rgba(52,211,153,0.16)]'
                        : 'border-white/10 bg-white/5 hover:border-white/25 hover:bg-white/10'
                    }`}
                    onMouseEnter={() => {
                      if (!isWindowActive) {
                        actions.focusWindow(win.id);
                      }
                    }}
                    onClick={() => {
                      actions.focusWindow(win.id);
                      setPreviewAppId(null);
                    }}
                    title={win.title}
                  >
                    <div className="flex h-7 items-center gap-2 border-b border-white/10 bg-black/20 px-2">
                      <PreviewIcon className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
                      <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-gray-200">{win.title}</span>
                      {win.isMinimized && <Monitor className="h-3.5 w-3.5 shrink-0 text-gray-500" />}
                    </div>
                    <div className="flex h-28 items-center justify-center bg-[#0d1117] p-2">
                      <div
                        className={`relative overflow-hidden rounded-md border border-white/10 ${
                          win.isMinimized ? 'opacity-50' : 'opacity-100'
                        }`}
                        style={{
                          width: previewSize.width,
                          height: previewSize.height,
                        }}
                      >
                        <div className="flex h-4 items-center gap-1 bg-[#1a1f2e] px-1">
                          <PreviewIcon className="h-2.5 w-2.5 text-emerald-300" />
                          <div className="h-1.5 flex-1 rounded-full bg-white/10" />
                        </div>
                        <div className="grid h-[calc(100%-1rem)] place-items-center bg-[radial-gradient(circle_at_top_left,rgba(52,211,153,0.18),transparent_42%),linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.015))]">
                          <PreviewIcon className="h-8 w-8 text-white/25" />
                        </div>
                      </div>
                    </div>
                  </button>
                  <div className="mt-1 flex items-center justify-between gap-1 px-1">
                    <span className="min-w-0 truncate text-[11px] text-gray-400">{activePreviewGroup.app?.name ?? win.appId}</span>
                    <button
                      className="rounded-md p-1 text-gray-500 opacity-70 transition-colors hover:bg-red-500/15 hover:text-red-300 group-hover/preview:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        actions.closeWindow(win.id);
                      }}
                      title="Close"
                      aria-label={`Close ${win.title}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {startMenuOpen && (
        <StartMenu
          apps={apps}
          actions={actions}
          onClose={onToggleStartMenu}
        />
      )}

      <button
        onClick={onToggleStartMenu}
        className={`rounded-2xl p-3 transition-all duration-300 hover:scale-110 active:scale-95 ${startMenuOpen ? 'bg-emerald-500/30 text-emerald-400 shadow-lg shadow-emerald-500/20' : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'}`}
        title="Start"
        aria-label="Start"
      >
        <LayoutGrid className="h-6 w-6" />
      </button>

      {!isMobile && <div className="mx-1 h-8 w-px bg-white/20" />}

      <div className="flex flex-1 items-center gap-1 overflow-x-auto overflow-y-hidden no-scrollbar">
        {groupedWindows.map(group => {
          const primaryWindow = getPrimaryWindow(group.windows);
          const AppIcon = iconMap[primaryWindow?.icon ?? ''] || iconMap[group.app?.icon ?? ''] || Settings;
          const isFocused = group.windows.some(win => win.isFocused && !win.isMinimized);
          const visibleFocusedWindow = group.windows.find(win => win.isFocused && !win.isMinimized);

          return (
            <div
              key={group.appId}
              className="relative shrink-0"
              onMouseEnter={e => showPreviewForGroup(group.appId, e.currentTarget)}
            >
              <button
                className={`relative flex h-11 w-12 items-center justify-center rounded-xl text-sm transition-all duration-300 animate-dock-item
                  ${isFocused
                    ? 'bg-white/15 text-white shadow-lg'
                    : 'bg-white/5 text-gray-300 hover:bg-white/10'
                  }`}
                onClick={() => {
                  if (!primaryWindow) return;
                  if (visibleFocusedWindow) {
                    actions.minimizeWindow(visibleFocusedWindow.id);
                  } else {
                    actions.focusWindow(primaryWindow.id);
                  }
                }}
                title={group.app?.name ?? primaryWindow?.title ?? group.appId}
                aria-label={group.app?.name ?? primaryWindow?.title ?? group.appId}
              >
                <AppIcon className="h-5 w-5 drop-shadow-md" />
                {group.windows.length > 1 && (
                  <span className="absolute right-1.5 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-400 px-1 text-[10px] font-bold leading-none text-[#07130f] shadow-lg shadow-emerald-500/20">
                    {group.windows.length}
                  </span>
                )}
                <div className={`absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-full transition-all duration-300 ${isFocused ? 'h-1 w-6 bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]' : 'h-1 w-1.5 bg-gray-600/50'}`} />
              </button>
            </div>
          );
        })}
      </div>

      <SystemTray />
    </div>
  );
}
