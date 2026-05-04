import { useState, useEffect } from 'react';
import {
  FolderOpen, TerminalSquare, Activity, Settings, FileText, FileImage, PlaySquare, FileArchive, LogOut, Search, Plus, Minus,
} from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import type { DesktopApp, WindowManagerActions } from '@/types/desktop';

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

interface StartMenuProps {
  apps: DesktopApp[];
  actions: WindowManagerActions;
  onClose: () => void;
  onLogout?: () => void;
  open?: boolean;
  desktopAppIds?: string[];
  onToggleDesktopApp?: (appId: string) => void;
}

export default function StartMenu({ apps, actions, onClose, onLogout, open = false, desktopAppIds = [], onToggleDesktopApp }: StartMenuProps) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const filtered = query.trim()
    ? apps.filter(a => a.name.toLowerCase().includes(query.toLowerCase()))
    : apps;

  return (
    <div
      className="start-menu-wrapper absolute bottom-[calc(100%+1rem)] left-1/2 z-[10000] pointer-events-auto"
      onClick={e => e.stopPropagation()}
      style={{
        opacity: open ? 1 : 0,
        transform: `translateX(-50%) translateY(${open ? '0' : '16px'})`,
        pointerEvents: open ? 'auto' : 'none',
      }}
    >
      <div className="start-menu rounded-2xl p-4 sm:p-5 w-[92vw] sm:w-[640px] max-w-[640px] flex flex-col gap-4">
        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="搜索应用..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-white/5 border border-white/5 text-sm text-gray-200 placeholder-gray-500 outline-none focus:border-emerald-500/50 focus:bg-white/[0.07] transition-colors"
          />
        </div>

        {/* Apps grid */}
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-1 max-h-[320px] overflow-y-auto">
          {filtered.map(app => {
            const IconComponent = iconMap[app.icon] || Settings;
            const colorClass = iconColors[app.icon] || 'text-gray-400';
            const isOnDesktop = desktopAppIds.includes(app.id);

            return (
              <ContextMenu key={app.id}>
                <ContextMenuTrigger asChild>
                  <button
                    className="flex flex-col items-center gap-1.5 p-2.5 rounded-xl hover:bg-white/10 transition-colors group"
                    onClick={() => {
                      actions.openWindow(app);
                      onClose();
                    }}
                  >
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-white/5 group-hover:bg-white/10 transition-colors">
                      <IconComponent className={`w-5 h-5 ${colorClass}`} />
                    </div>
                    <span className="text-[10px] text-gray-400 group-hover:text-gray-200 text-center leading-tight transition-colors">{app.name}</span>
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent className="z-[10002] w-44 border-white/10 text-gray-200 liquid-glass">
                  <ContextMenuItem
                    className="focus:liquid-glass-active focus:text-white"
                    onClick={() => onToggleDesktopApp?.(app.id)}
                  >
                    {isOnDesktop ? (
                      <><Minus className="mr-2 h-4 w-4" />从桌面移除</>
                    ) : (
                      <><Plus className="mr-2 h-4 w-4" />添加到桌面</>
                    )}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
          {filtered.length === 0 && (
            <div className="col-span-3 sm:col-span-4 py-6 text-center text-sm text-gray-500">无匹配应用</div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 pt-2 border-t border-white/5">
          {onLogout && (
            <button
              type="button"
              className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-gray-400 transition-colors hover:bg-white/5 hover:text-red-300"
              onClick={onLogout}
            >
              <LogOut className="h-3.5 w-3.5" />
              注销登录
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
