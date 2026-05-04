import type { DesktopApp } from '@/types/desktop';
import { appConfigs } from './appMeta';
import FileManager from '@/components/desktop/apps/FileManager';
import Terminal from '@/components/desktop/apps/Terminal';
import SystemMonitor from '@/components/desktop/apps/SystemMonitor';
import Settings from '@/components/desktop/apps/Settings';
import TextEditor from '@/components/desktop/apps/TextEditor';
import MediaViewer from '@/components/desktop/apps/MediaViewer';
import ArchiveViewer from '@/components/desktop/apps/ArchiveViewer';
import DocumentViewer from '@/components/desktop/apps/DocumentViewer';

const componentMap: Record<string, React.ComponentType<any>> = {
  'archive-viewer': ArchiveViewer,
  'file-manager': FileManager,
  'terminal': Terminal,
  'system-monitor': SystemMonitor,
  'settings': Settings,
  'text-editor': TextEditor,
  'image-viewer': MediaViewer,
  'document-viewer': DocumentViewer,
};

export const desktopApps: DesktopApp[] = appConfigs.map(cfg => ({
  ...cfg,
  component: componentMap[cfg.id],
}));
