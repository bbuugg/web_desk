import type { DesktopApp } from '@/types/desktop';
import FileManager from '@/components/desktop/apps/FileManager';
import Terminal from '@/components/desktop/apps/Terminal';
import SystemMonitor from '@/components/desktop/apps/SystemMonitor';
import Settings from '@/components/desktop/apps/Settings';
import TextEditor from '@/components/desktop/apps/TextEditor';
import MediaViewer from '@/components/desktop/apps/MediaViewer';
import ArchiveViewer from '@/components/desktop/apps/ArchiveViewer';
import DocumentViewer from '@/components/desktop/apps/DocumentViewer';

export const desktopApps: DesktopApp[] = [
  {
    id: 'archive-viewer',
    name: 'Archive Viewer',
    icon: 'FileArchive',
    component: ArchiveViewer,
    defaultWidth: 500,
    defaultHeight: 600,
    multiInstance: true,
  },
  {
    id: 'file-manager',
    name: 'File Manager',
    icon: 'FolderOpen',
    component: FileManager,
    defaultWidth: 860,
    defaultHeight: 540,
    multiInstance: true,
  },
  {
    id: 'terminal',
    name: 'Terminal',
    icon: 'TerminalSquare',
    component: Terminal,
    defaultWidth: 750,
    defaultHeight: 480,
    multiInstance: true,
  },
  {
    id: 'system-monitor',
    name: 'System Monitor',
    icon: 'Activity',
    component: SystemMonitor,
    defaultWidth: 800,
    defaultHeight: 520,
  },
  {
    id: 'settings',
    name: 'Settings',
    icon: 'Settings',
    component: Settings,
    defaultWidth: 780,
    defaultHeight: 520,
  },
  {
    id: 'text-editor',
    name: 'Text Editor',
    icon: 'FileText',
    component: TextEditor,
    defaultWidth: 800,
    defaultHeight: 600,
    multiInstance: true,
  },
  {
    id: 'image-viewer',
    name: 'Media Viewer',
    icon: 'PlaySquare',
    component: MediaViewer,
    defaultWidth: 800,
    defaultHeight: 560,
    multiInstance: true,
  },
  {
    id: 'document-viewer',
    name: 'Document Viewer',
    icon: 'FileText',
    component: DocumentViewer,
    defaultWidth: 920,
    defaultHeight: 680,
    multiInstance: true,
  },
];
