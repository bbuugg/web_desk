import {
  FolderOpen, TerminalSquare, Activity, Settings, FileText, FileImage, PlaySquare, FileArchive,
} from 'lucide-react';
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
}

export default function StartMenu({ apps, actions, onClose }: StartMenuProps) {
  return (
    <div className="absolute bottom-[calc(100%+1rem)] left-0 z-[10000] pointer-events-auto" onClick={e => e.stopPropagation()}>
      <div className="start-menu rounded-2xl p-4 w-72 flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-4 duration-300 ease-out fill-mode-forwards will-change-transform">
        {/* Search bar placeholder */}
        <div className="px-3 py-2 rounded-lg bg-white/5 border border-white/5 text-sm text-gray-500">
          Search applications...
        </div>

        {/* Apps grid */}
        <div className="grid grid-cols-4 gap-1">
          {apps.map(app => {
            const IconComponent = iconMap[app.icon] || Settings;
            const colorClass = iconColors[app.icon] || 'text-gray-400';

            return (
              <button
                key={app.id}
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
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-white/5">
          <span className="text-[10px] text-gray-600">Linux Server Manager</span>
          <span className="text-[10px] text-gray-600">v1.0.0</span>
        </div>
      </div>
    </div>
  );
}
