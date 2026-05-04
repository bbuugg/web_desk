/** App metadata without component imports — safe to import anywhere. */

export interface AppConfig {
  id: string;
  name: string;
  icon: string;
  defaultWidth?: number;
  defaultHeight?: number;
  multiInstance?: boolean;
  fileExtensions?: string[];
}

export const appConfigs: AppConfig[] = [
  {
    id: 'archive-viewer',
    name: 'Archive Viewer',
    icon: 'FileArchive',
    defaultWidth: 500,
    defaultHeight: 600,
    multiInstance: true,
    fileExtensions: ['zip', 'tar', 'gz', 'xz', 'bz2', 'tgz', 'txz', 'tbz', 'tbz2'],
  },
  {
    id: 'file-manager',
    name: 'File Manager',
    icon: 'FolderOpen',
    defaultWidth: 860,
    defaultHeight: 540,
    multiInstance: true,
  },
  {
    id: 'terminal',
    name: 'Terminal',
    icon: 'TerminalSquare',
    defaultWidth: 750,
    defaultHeight: 480,
    multiInstance: true,
  },
  {
    id: 'system-monitor',
    name: 'System Monitor',
    icon: 'Activity',
    defaultWidth: 800,
    defaultHeight: 520,
  },
  {
    id: 'settings',
    name: 'Settings',
    icon: 'Settings',
    defaultWidth: 780,
    defaultHeight: 520,
  },
  {
    id: 'text-editor',
    name: 'Text Editor',
    icon: 'FileText',
    defaultWidth: 800,
    defaultHeight: 600,
    multiInstance: true,
    fileExtensions: [
      'txt', 'md', 'json', 'js', 'ts', 'tsx', 'jsx', 'html', 'css', 'scss', 'less',
      'yaml', 'yml', 'conf', 'config', 'log', 'sh', 'bash', 'zsh', 'py', 'go', 'rs',
      'c', 'cpp', 'h', 'hpp', 'java', 'kt', 'php', 'rb', 'pl', 'sql', 'env', 'ini',
      'toml', 'xml', 'dockerfile', 'gitignore', 'gitconfig',
    ],
  },
  {
    id: 'image-viewer',
    name: 'Media Viewer',
    icon: 'PlaySquare',
    defaultWidth: 800,
    defaultHeight: 560,
    multiInstance: true,
    fileExtensions: [
      'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico',
      'mp4', 'webm', 'ogg', 'mov', 'm4v',
    ],
  },
  {
    id: 'document-viewer',
    name: 'Document Viewer',
    icon: 'FileText',
    defaultWidth: 920,
    defaultHeight: 680,
    multiInstance: true,
    fileExtensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx'],
  },
];
