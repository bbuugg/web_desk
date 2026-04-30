import {
  FolderOpen, TerminalSquare, Activity, Settings, FileText, FileImage, PlaySquare, FileArchive,
} from 'lucide-react';
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
  onSelect: () => void;
  onOpen: () => void;
}

export default function DesktopIcon({ app, isSelected, onSelect, onOpen }: DesktopIconProps) {
  const IconComponent = iconMap[app.icon] || Settings;
  const colorClass = iconColors[app.icon] || 'text-gray-400';
  const isMobile = useIsMobile();

  return (
    <button
      className={`flex flex-col items-center gap-1.5 p-3 rounded-xl w-[88px] transition-all duration-150 select-none group outline-none
        ${isSelected
          ? 'bg-white/10 ring-1 ring-white/20'
          : 'hover:bg-white/5'
        }
      `}
      onClick={e => {
        e.stopPropagation();
        if (isMobile) {
          onOpen();
        } else {
          onSelect();
        }
      }}
      onDoubleClick={e => {
        e.stopPropagation();
        if (!isMobile) {
          onOpen();
        }
      }}
    >
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center bg-white/5 group-hover:bg-white/10 transition-colors ${isSelected ? 'bg-white/10' : ''}`}>
        <IconComponent className={`w-7 h-7 ${colorClass} transition-transform group-hover:scale-110`} />
      </div>
      <span className="text-[11px] text-gray-300 text-center leading-tight font-medium drop-shadow-sm">{app.name}</span>
    </button>
  );
}
