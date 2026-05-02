import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useIsMobile } from '@/hooks/use-mobile';
import { getBreadcrumbModel, getParentPath, joinPath } from '@/lib/path-utils';
import { FileManagerClient, type FileInfo, type ProgressInfo } from '@/lib/ws-client';
import { formatSize } from '@/lib/utils';
import type { AppComponentProps } from '@/types/desktop';
import {
  AlertCircle,
  ArrowLeft, ArrowRight,
  ChevronRight,
  ClipboardPaste,
  Copy,
  Download,
  Eye, EyeOff,
  File,
  FileArchive,
  FileCode, FileImage,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  FolderPlus,
  Home,
  Loader2,
  Monitor,
  Pencil,
  Plus,
  Presentation,
  RefreshCw,
  Scissors,
  Terminal,
  Trash,
  Trash2,
  Undo2,
  Upload,
} from 'lucide-react';
import UploadDialog from './UploadDialog';
import { useCallback, useEffect, useRef, useState } from 'react';

// --- File icon helper ---
function getFileIcon(name: string, isDir: boolean, path?: string, variant: 'grid' | 'list' = 'grid') {
  const iconSizeClass = variant === 'grid' ? 'w-10 h-10' : 'w-4 h-4';
  const previewSizeClass = variant === 'grid' ? 'w-10 h-10' : 'w-5 h-5';

  const renderBadgedIcon = (icon: React.ReactNode, label: string, badgeClass: string) => {
    if (variant === 'list') {
      return icon;
    }

    return (
      <div className="relative flex h-10 w-10 items-center justify-center">
        {icon}
        <span className={`absolute -bottom-1 left-1/2 -translate-x-1/2 rounded px-1 py-px text-[8px] font-bold leading-none text-white shadow-sm ${badgeClass}`}>
          {label}
        </span>
      </div>
    );
  };

  if (path === 'This PC' || isDir && /^[A-Z]:\\?$/.test(path || '')) {
    return <Monitor className={`${iconSizeClass} text-blue-400 group-hover:text-blue-300 transition-colors`} />;
  }
  if (isDir) return <FolderOpen className={`${iconSizeClass} text-amber-400/80 group-hover:text-amber-400 transition-colors`} />;

  const ext = name.split('.').pop()?.toLowerCase() || '';
  const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'];
  const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'm4v'];
  const pdfExts = ['pdf'];
  const wordExts = ['doc', 'docx'];
  const presentationExts = ['ppt', 'pptx'];
  const spreadsheetExts = ['xls', 'xlsx', 'csv'];
  
  if (imageExts.includes(ext) && path) {
    return (
      <div className={`${previewSizeClass} rounded-md overflow-hidden bg-white/5 border border-white/10 group-hover:border-white/20 transition-all flex items-center justify-center`}>
        <img 
          src={`/api/files/content?path=${encodeURIComponent(path)}`} 
          alt={name} 
          className="w-full h-full object-cover"
          loading="lazy"
        />
      </div>
    );
  }

  const codeExts = ['ts', 'tsx', 'js', 'jsx', 'go', 'py', 'rs', 'java', 'c', 'cpp', 'h', 'css', 'html', 'json', 'yaml', 'yml', 'toml', 'sh', 'bash', 'zsh'];
  const archiveExts = ['zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar'];
  const textExts = ['txt', 'md', 'log', 'conf', 'cfg', 'ini', 'env'];

  if (codeExts.includes(ext)) return <FileCode className={`${iconSizeClass} text-sky-400/80 group-hover:text-sky-400 transition-colors`} />;
  if (videoExts.includes(ext)) return renderBadgedIcon(<File className={`${iconSizeClass} text-rose-400/80 group-hover:text-rose-400 transition-colors`} />, 'VID', 'bg-rose-500/90');
  if (pdfExts.includes(ext)) return renderBadgedIcon(<FileText className={`${iconSizeClass} text-red-400/80 group-hover:text-red-400 transition-colors`} />, 'PDF', 'bg-red-500/90');
  if (wordExts.includes(ext)) return renderBadgedIcon(<FileText className={`${iconSizeClass} text-blue-400/80 group-hover:text-blue-400 transition-colors`} />, 'DOC', 'bg-blue-500/90');
  if (presentationExts.includes(ext)) return renderBadgedIcon(<Presentation className={`${iconSizeClass} text-orange-400/80 group-hover:text-orange-400 transition-colors`} />, 'PPT', 'bg-orange-500/90');
  if (spreadsheetExts.includes(ext)) return renderBadgedIcon(<FileSpreadsheet className={`${iconSizeClass} text-emerald-400/80 group-hover:text-emerald-400 transition-colors`} />, 'XLS', 'bg-emerald-500/90');
  if (imageExts.includes(ext)) return <FileImage className={`${iconSizeClass} text-purple-400/80 group-hover:text-purple-400 transition-colors`} />;
  if (archiveExts.includes(ext)) return <FileArchive className={`${iconSizeClass} text-orange-400/80 group-hover:text-orange-400 transition-colors`} />;
  if (textExts.includes(ext)) return <FileText className={`${iconSizeClass} text-emerald-400/80 group-hover:text-emerald-400 transition-colors`} />;
  return <File className={`${iconSizeClass} text-gray-500 group-hover:text-gray-400 transition-colors`} />;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

async function downloadFile(path: string, name: string) {
  const resp = await fetch('/api/files/content', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, download: true, name }),
  });
  if (!resp.ok) {
    throw new Error(`Download failed (${resp.status})`);
  }
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function FileManager({ actions }: AppComponentProps) {
  const clientRef = useRef<FileManagerClient | null>(null);
  const [connected, setConnected] = useState(false);
  const [currentPath, setCurrentPath] = useState('~');
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>(['~']);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [showHidden, setShowHidden] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastSelectedPath, setLastSelectedPath] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [appMode, setAppMode] = useState<'files' | 'trash'>('files');
  const [selectionBox, setSelectionBox] = useState<{ startX: number, startY: number, currentX: number, currentY: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Dialogs
  const [renameTarget, setRenameTarget] = useState<FileInfo | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [batchRenameTargets, setBatchRenameTargets] = useState<FileInfo[] | null>(null);
  const [batchRenameBase, setBatchRenameBase] = useState('');
  const [createDialog, setCreateDialog] = useState<'file' | 'dir' | null>(null);
  const [createName, setCreateName] = useState('');
  const [deleteConfirmBulk, setDeleteConfirmBulk] = useState<FileInfo[] | null>(null);
  const [emptyTrashConfirm, setEmptyTrashConfirm] = useState(false);
  const [compressDialog, setCompressDialog] = useState<string[] | null>(null);
  const [compressName, setCompressName] = useState('');
  const [clipboard, setClipboard] = useState<{ paths: string[], mode: 'copy' | 'cut' } | null>(null);
  const [pasteProgress, setPasteProgress] = useState<{
    mode: 'copy' | 'cut';
    index: number;        // 1-based index of clipboard item being processed
    total: number;        // total clipboard items
    currentName: string;  // basename of current clipboard item
    innerDone: number;    // files completed inside current item (0 until backend reports)
    innerTotal: number;   // total files inside current item (0 if unknown)
  } | null>(null);
  const [showUploadDialog, setShowUploadDialog] = useState(false);
  const [uploadDialogInitialFiles, setUploadDialogInitialFiles] = useState<File[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [contextMenusDisabled, setContextMenusDisabled] = useState(false);
  const dragDepthRef = useRef(0);
  const contextMenuSuppressUntilRef = useRef(0);
  const contextMenuReenableTimerRef = useRef<number | null>(null);
  const isMobile = useIsMobile();

  const canUpload = appMode === 'files' && currentPath !== 'computer://' && currentPath !== 'This PC';

  const armContextMenuInteractionGuard = useCallback(() => {
    contextMenuSuppressUntilRef.current = performance.now() + 250;
    setContextMenusDisabled(true);
    if (contextMenuReenableTimerRef.current !== null) {
      window.clearTimeout(contextMenuReenableTimerRef.current);
    }
    contextMenuReenableTimerRef.current = window.setTimeout(() => {
      setContextMenusDisabled(false);
      contextMenuReenableTimerRef.current = null;
    }, 250);
  }, []);

  const shouldSuppressPostMenuInteraction = useCallback(() => {
    return performance.now() < contextMenuSuppressUntilRef.current;
  }, []);

  const swallowSuppressedInteraction = useCallback((event: { preventDefault(): void; stopPropagation(): void }) => {
    if (!shouldSuppressPostMenuInteraction()) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    return true;
  }, [shouldSuppressPostMenuInteraction]);

  useEffect(() => {
    return () => {
      if (contextMenuReenableTimerRef.current !== null) {
        window.clearTimeout(contextMenuReenableTimerRef.current);
      }
    };
  }, []);

  // Connect WebSocket
  useEffect(() => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/api/ws/files`;
    const client = new FileManagerClient(wsUrl, setConnected);
    clientRef.current = client;
    client.connect();
    return () => client.disconnect();
  }, []);

  // Load files when path or connection changes
  const loadFiles = useCallback(async (path: string) => {
    if (!clientRef.current || !connected) return;
    setLoading(true);
    setError(null);
    setSelected(new Set());
    setSelectionBox(null);
    try {
      let res;
      if (appMode === 'trash' && (path === '~' || path === 'computer://' || path === 'This PC' || path === '~/.trash')) {
        res = await clientRef.current.list('~/.trash');
      } else {
        res = await clientRef.current.list(path, showHidden);
      }
      setFiles(res.files || []);
      setCurrentPath(res.path);
    } catch (e) {
      setError((e as Error).message);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [connected, showHidden, appMode]);

  const openUploadDialog = useCallback((fileList?: FileList | File[]) => {
    if (!canUpload) return;
    setUploadDialogInitialFiles(fileList ? Array.from(fileList) : []);
    setShowUploadDialog(true);
  }, [canUpload]);

  const closeUploadDialog = useCallback(() => {
    setShowUploadDialog(false);
    setUploadDialogInitialFiles([]);
  }, []);

  useEffect(() => {
    if (connected) loadFiles(currentPath);
  }, [connected, showHidden]); // eslint-disable-line react-hooks/exhaustive-deps

  // Navigation
  const navigateTo = useCallback((path: string) => {
    const newHistory = [...history.slice(0, historyIndex + 1), path];
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    loadFiles(path);
  }, [history, historyIndex, loadFiles]);

  const goBack = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      loadFiles(history[newIndex]);
    }
  }, [historyIndex, history, loadFiles]);

  const goForward = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      loadFiles(history[newIndex]);
    }
  }, [historyIndex, history, loadFiles]);

  const goUp = useCallback(() => {
    const parentPath = getParentPath(currentPath);
    if (parentPath !== currentPath) {
      navigateTo(parentPath);
    }
  }, [currentPath, navigateTo]);

  // Actions
  const handleOpenTerminal = useCallback((path: string) => {
    import('@/config/apps').then(({ desktopApps }) => {
      const terminal = desktopApps.find(app => app.id === 'terminal');
      if (terminal) {
        actions.openWindow(terminal, { cwd: path });
      }
    });
  }, [actions]);

  const handleOpen = useCallback((file: FileInfo) => {
    if (file.isDir) {
      navigateTo(file.path);
    } else {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';
      const lowerName = file.name.toLowerCase();
      const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'];
      const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'm4v'];
      const archiveExts = ['zip', 'tar', 'gz', 'xz', 'bz2', 'tgz', 'txz', 'tbz', 'tbz2'];
      const compoundArchiveExts = ['.tar.gz', '.tar.xz', '.tar.bz2'];
      const documentExts = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx'];
      const isImage = imageExts.includes(ext);
      const isVideo = videoExts.includes(ext);
      const isArchive = archiveExts.includes(ext) || compoundArchiveExts.some(e => lowerName.endsWith(e));
      const isDocument = documentExts.includes(ext);

      const textExts = [
        'txt', 'md', 'json', 'js', 'ts', 'tsx', 'jsx', 'html', 'css', 'scss', 'less',
        'yaml', 'yml', 'conf', 'config', 'log', 'sh', 'bash', 'zsh', 'py', 'go', 'rs',
        'c', 'cpp', 'h', 'hpp', 'java', 'kt', 'php', 'rb', 'pl', 'sql', 'env', 'ini',
        'toml', 'xml', 'dockerfile', 'gitignore', 'gitconfig'
      ];
      const isText = textExts.includes(ext) || !ext; // Treat files without extension as text by default, or you can be stricter

      import('@/config/apps').then(({ desktopApps }) => {
        let appId: string | null = null;
        if (isImage || isVideo) {
          appId = 'image-viewer';
        } else if (isArchive) {
          appId = 'archive-viewer';
        } else if (isDocument) {
          appId = 'document-viewer';
        } else if (isText) {
          appId = 'text-editor';
        }

        if (appId) {
          const app = desktopApps.find(a => a.id === appId);
          if (app) {
            actions.openWindow(app, { path: file.path });
          }
        }
      });
    }
  }, [navigateTo, actions]);

  const handleItemClick = useCallback((e: React.MouseEvent, file: FileInfo, index: number) => {
    if (swallowSuppressedInteraction(e)) {
      return;
    }

    e.stopPropagation();
    if (isMobile) {
      handleOpen(file);
      return;
    }

    let newSelected = new Set(selected);
    if (e.ctrlKey || e.metaKey) {
      if (newSelected.has(file.path)) {
        newSelected.delete(file.path);
      } else {
        newSelected.add(file.path);
      }
    } else if (e.shiftKey && lastSelectedPath) {
      const lastIndex = files.findIndex(f => f.path === lastSelectedPath);
      const start = Math.min(lastIndex, index);
      const end = Math.max(lastIndex, index);
      const rangePaths = files.slice(start, end + 1).map(f => f.path);
      
      // If Ctrl is also held, add to existing selection, otherwise replace
      if (e.ctrlKey || e.metaKey) {
        rangePaths.forEach(p => newSelected.add(p));
      } else {
        newSelected = new Set(rangePaths);
      }
    } else {
      newSelected = new Set([file.path]);
    }
    setSelected(newSelected);
    setLastSelectedPath(file.path);
  }, [isMobile, handleOpen, selected, lastSelectedPath, files, swallowSuppressedInteraction]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (swallowSuppressedInteraction(e)) {
      return;
    }

    // Prevent selection if any dialog is open
    if (renameTarget || batchRenameTargets || createDialog || compressDialog || deleteConfirmBulk || emptyTrashConfirm || pasteProgress) return;

    // Only left click on background starts drag selection
    if (e.button !== 0 || (e.target as HTMLElement).closest('.file-item')) return;
    
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const startX = e.clientX - rect.left + (containerRef.current?.scrollLeft || 0);
    const startY = e.clientY - rect.top + (containerRef.current?.scrollTop || 0);

    setSelectionBox({
      startX,
      startY,
      currentX: startX,
      currentY: startY,
    });

    if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
      setSelected(new Set());
      setLastSelectedPath(null);
    }
  }, [renameTarget, batchRenameTargets, createDialog, compressDialog, deleteConfirmBulk, emptyTrashConfirm, pasteProgress, swallowSuppressedInteraction]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!selectionBox || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const currentX = e.clientX - rect.left + containerRef.current.scrollLeft;
    const currentY = e.clientY - rect.top + containerRef.current.scrollTop;

    setSelectionBox(prev => prev ? { ...prev, currentX, currentY } : null);

    // Calculate overlaps
    const boxRect = {
      left: Math.min(selectionBox.startX, currentX),
      top: Math.min(selectionBox.startY, currentY),
      right: Math.max(selectionBox.startX, currentX),
      bottom: Math.max(selectionBox.startY, currentY),
    };

    const newSelected = new Set(e.ctrlKey || e.metaKey ? selected : []);
    const items = containerRef.current.querySelectorAll('.file-item');
    
    items.forEach(item => {
      const itemElem = item as HTMLElement;
      const itemOffsetTop = itemElem.offsetTop;
      const itemOffsetLeft = itemElem.offsetLeft;
      const itemWidth = itemElem.offsetWidth;
      const itemHeight = itemElem.offsetHeight;

      const overlap = !(
        itemOffsetLeft > boxRect.right ||
        itemOffsetLeft + itemWidth < boxRect.left ||
        itemOffsetTop > boxRect.bottom ||
        itemOffsetTop + itemHeight < boxRect.top
      );

      if (overlap) {
        const path = itemElem.getAttribute('data-path');
        if (path) newSelected.add(path);
      }
    });

    setSelected(newSelected);
  }, [selectionBox, selected]);

  const handleMouseUp = useCallback(() => {
    setSelectionBox(null);
  }, []);

  // Global mouse up to ensure selection box is cleared
  useEffect(() => {
    if (selectionBox) {
      window.addEventListener('mouseup', handleMouseUp);
      return () => window.removeEventListener('mouseup', handleMouseUp);
    }
  }, [selectionBox, handleMouseUp]);

  const handleDeleteBulk = useCallback(async () => {
    if (!deleteConfirmBulk || !clientRef.current) return;
    const targets = [...deleteConfirmBulk];
    setDeleteConfirmBulk(null);
    try {
      for (const f of targets) {
        if (appMode === 'trash') {
          await clientRef.current.permanentDelete(f.path);
        } else {
          await clientRef.current.delete(f.path);
        }
      }
      setSelected(new Set());
      loadFiles(currentPath);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [deleteConfirmBulk, currentPath, loadFiles, appMode]);

  const handleRestoreBulk = useCallback(async () => {
    if (selected.size === 0 || !clientRef.current) return;
    const paths = Array.from(selected);
    setSelected(new Set());
    try {
      for (const path of paths) {
        await clientRef.current.restore(path);
      }
      loadFiles(currentPath);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [selected, currentPath, loadFiles]);

  const handleEmptyTrash = useCallback(async () => {
    if (!clientRef.current) return;
    setEmptyTrashConfirm(false);
    try {
      await clientRef.current.emptyTrash();
      loadFiles(currentPath);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [currentPath, loadFiles]);

  const handleRename = useCallback(async () => {
    if (!renameTarget || !renameValue.trim() || !clientRef.current) return;
    const oldPath = renameTarget.path;
    const newPath = joinPath(getParentPath(oldPath), renameValue.trim());
    setRenameTarget(null);
    setRenameValue('');
    try {
      await clientRef.current.rename(oldPath, newPath);
      loadFiles(currentPath);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [renameTarget, renameValue, currentPath, loadFiles]);

  const handleBatchRename = useCallback(async () => {
    if (!batchRenameTargets || !batchRenameBase.trim() || !clientRef.current) return;
    const targets = [...batchRenameTargets];
    const base = batchRenameBase.trim();
    setBatchRenameTargets(null);
    setBatchRenameBase('');
    try {
      let i = 1;
      for (const f of targets) {
        const dotIndex = f.name.lastIndexOf('.');
        const hasExt = !f.isDir && dotIndex > 0;
        const ext = hasExt ? f.name.substring(dotIndex) : '';
        const newName = `${base} (${i})${ext}`;
        const newPath = joinPath(getParentPath(f.path), newName);
        if (newPath !== f.path) {
          await clientRef.current.rename(f.path, newPath);
        }
        i++;
      }
      setSelected(new Set());
      loadFiles(currentPath);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [batchRenameTargets, batchRenameBase, currentPath, loadFiles]);

  const handleCreate = useCallback(async () => {
    if (!createName.trim() || !clientRef.current) return;
    const path = joinPath(currentPath, createName.trim());
    const type = createDialog;
    setCreateDialog(null);
    setCreateName('');
    try {
      if (type === 'dir') {
        await clientRef.current.mkdir(path);
      } else {
        await clientRef.current.createFile(path);
      }
      loadFiles(currentPath);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [createDialog, createName, currentPath, loadFiles]);

  const handleCompress = useCallback(async () => {
    if (!compressDialog || !compressName.trim() || !clientRef.current) return;
    const paths = [...compressDialog];
    const name = compressName.trim();
    const lower = name.toLowerCase();
    const knownExts = [
      '.tar.gz', '.tar.xz', '.tar.bz2', '.tgz', '.txz', '.tbz', '.tbz2',
      '.zip', '.tar', '.gz', '.xz',
    ];
    const hasKnownExt = knownExts.some(e => lower.endsWith(e));
    const dest = joinPath(currentPath, hasKnownExt ? name : `${name}.zip`);
    setCompressDialog(null);
    setCompressName('');
    try {
      await clientRef.current.compress(paths, dest);
      loadFiles(currentPath);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [compressDialog, compressName, currentPath, loadFiles]);

  const handleCopy = useCallback(() => {
    if (selected.size === 0) return;
    setClipboard({ paths: Array.from(selected), mode: 'copy' });
  }, [selected]);

  const handleCut = useCallback(() => {
    if (selected.size === 0) return;
    setClipboard({ paths: Array.from(selected), mode: 'cut' });
  }, [selected]);

  const handlePaste = useCallback(async () => {
    if (!clipboard || !clientRef.current) return;
    const client = clientRef.current;
    const normalize = (p: string) => p.replace(/\\/g, '/');

    // Names already chosen by previous iterations of this paste session.
    // We must consult this in addition to `files`, because `files` reflects
    // a snapshot from before the loop and won't update until loadFiles runs
    // afterwards. Without it, two sources with the same basename both pass
    // the existence check and the second silently overwrites the first.
    const claimed = new Set<string>();
    const isTaken = (dst: string) => {
      const key = normalize(dst);
      return claimed.has(key) || files.some(f => normalize(f.path) === key);
    };

    try {
      for (let i = 0; i < clipboard.paths.length; i++) {
        const src = clipboard.paths[i];
        const originalName = normalize(src).split('/').pop() || '';
        let name = originalName;
        let dst = joinPath(currentPath, name);

        if (isTaken(dst)) {
          const extIndex = originalName.lastIndexOf('.');
          const hasExt = extIndex > 0;
          const base = hasExt ? originalName.substring(0, extIndex) : originalName;
          const ext = hasExt ? originalName.substring(extIndex) : '';

          let counter = 1;
          let newName = `${base} - copy${ext}`;
          while (isTaken(joinPath(currentPath, newName))) {
            counter++;
            newName = `${base} - copy ${counter}${ext}`;
          }
          name = newName;
          dst = joinPath(currentPath, name);
        }
        claimed.add(normalize(dst));

        setPasteProgress({
          mode: clipboard.mode,
          index: i + 1,
          total: clipboard.paths.length,
          currentName: name,
          innerDone: 0,
          innerTotal: 0,
        });

        const onProgress = (p: ProgressInfo) => {
          setPasteProgress(prev =>
            prev ? { ...prev, innerDone: p.done, innerTotal: p.total } : prev,
          );
        };

        if (clipboard.mode === 'copy') {
          await client.copy(src, dst, onProgress);
        } else {
          await client.move(src, dst, onProgress);
        }
      }
      if (clipboard.mode === 'cut') {
        setClipboard(null);
      }
      loadFiles(currentPath);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPasteProgress(null);
    }
  }, [clipboard, currentPath, loadFiles, files]);

  const handleDownload = useCallback((paths?: string[]) => {
    const targetPaths = paths ?? Array.from(selected);
    if (targetPaths.length === 0) return;

    const targetFiles = files.filter(file => targetPaths.includes(file.path));
    const downloadableFiles = targetFiles.filter(file => !file.isDir);
    const skippedDirs = targetFiles.length - downloadableFiles.length;

    if (downloadableFiles.length === 0) {
      setError('Directories cannot be downloaded directly. Compress them first, then download the archive.');
      return;
    }

    if (skippedDirs > 0) {
      setError(`${skippedDirs} selected item${skippedDirs > 1 ? 's are' : ' is'} a directory and was skipped. Compress folders first to download them.`);
    } else {
      setError(null);
    }

    for (const file of downloadableFiles) {
      downloadFile(file.path, file.name).catch(e => {
        setError((e as Error).message);
      });
    }
  }, [selected, files]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if we're in an input
      const isInput = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (isInput) return;

      // Swallow shortcuts while a paste/move is in progress so the user
      // can't queue another paste, delete, or rename mid-operation.
      if (pasteProgress) return;

      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'c') { e.preventDefault(); handleCopy(); }
        if (e.key === 'v') { e.preventDefault(); handlePaste(); }
        if (e.key === 'x') { e.preventDefault(); handleCut(); }
        if (e.key === 'a') { e.preventDefault(); setSelected(new Set(files.map(f => f.path))); }
      }
      if (e.key === 'Delete') {
        if (selected.size > 0) {
          const selectedFiles = files.filter(f => selected.has(f.path));
          setDeleteConfirmBulk(selectedFiles);
        }
      }
      if (e.key === 'F2') {
        const selectedList = Array.from(selected);
        if (selectedList.length === 1) {
          const f = files.find(f => f.path === selectedList[0]);
          if (f) { setRenameTarget(f); setRenameValue(f.name); }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selected, files, handleCopy, handleCut, handlePaste, pasteProgress]);

  // Breadcrumb
  const breadcrumb = getBreadcrumbModel(currentPath);

  return (
    <div className="flex flex-col h-full bg-[#0d1117] text-gray-200 relative">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-2 border-b border-white/5 bg-white/[0.02] overflow-x-auto no-scrollbar whitespace-nowrap">
        <div className="flex items-center gap-0.5 shrink-0">
          <ToolbarBtn onClick={goBack} disabled={historyIndex <= 0} title="Back">
            <ArrowLeft className="w-4 h-4" />
          </ToolbarBtn>
          <ToolbarBtn onClick={goForward} disabled={historyIndex >= history.length - 1} title="Forward">
            <ArrowRight className="w-4 h-4" />
          </ToolbarBtn>
          <ToolbarBtn onClick={goUp} title="Up">
            <ArrowRight className="w-4 h-4 rotate-[-90deg]" />
          </ToolbarBtn>
          <ToolbarBtn onClick={() => navigateTo('computer://')} title="This PC">
            <Monitor className="w-4 h-4" />
          </ToolbarBtn>
          <ToolbarBtn onClick={() => navigateTo('~')} title="Home">
            <Home className="w-4 h-4" />
          </ToolbarBtn>
          <ToolbarBtn onClick={() => loadFiles(currentPath)} title="Refresh">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </ToolbarBtn>
        </div>

        {/* Breadcrumb */}
        <div className="flex items-center gap-0.5 mx-1 px-2 py-1.5 rounded-lg bg-white/5 flex-1 text-sm overflow-x-auto no-scrollbar min-w-[120px]">
          {currentPath === 'This PC' ? (
            <span className="text-white font-medium px-1">This PC</span>
          ) : (
            <>
              <button className="text-gray-400 hover:text-white shrink-0" onClick={() => navigateTo(breadcrumb.rootPath)}>
                {breadcrumb.rootLabel}
              </button>
              {breadcrumb.parts.map((part, i) => (
                <span key={i} className="flex items-center gap-0.5 shrink-0">
                  <ChevronRight className="w-3 h-3 text-gray-600" />
                  <button
                    className={`hover:text-white transition-colors whitespace-nowrap ${i === breadcrumb.parts.length - 1 ? 'text-white font-medium' : 'text-gray-400'}`}
                    onClick={() => navigateTo(breadcrumb.buildPath(i))}
                  >
                    {part}
                  </button>
                </span>
              ))}
            </>
          )}
        </div>

        {/* Toolbar right */}
        <div className="flex items-center gap-0.5 shrink-0">
          <ToolbarBtn 
            onClick={() => {
              const newMode = appMode === 'files' ? 'trash' : 'files';
              setAppMode(newMode);
              navigateTo(newMode === 'trash' ? '~/.trash' : '~');
            }} 
            title={appMode === 'files' ? 'Recycle Bin' : 'Back to Files'}
            active={appMode === 'trash'}
          >
            {appMode === 'files' ? <Trash className="w-4 h-4" /> : <FolderOpen className="w-4 h-4" />}
          </ToolbarBtn>
          <div className="w-px h-4 bg-white/10 mx-1" />
          <ToolbarBtn onClick={() => setShowHidden(h => !h)} title={showHidden ? 'Hide hidden files' : 'Show hidden files'} active={showHidden}>
            {showHidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </ToolbarBtn>
          {!isMobile && (
            <>
              <ToolbarBtn onClick={() => setCreateDialog('file')} title="New File">
                <Plus className="w-4 h-4" />
              </ToolbarBtn>
              <ToolbarBtn onClick={() => setCreateDialog('dir')} title="New Folder">
                <FolderPlus className="w-4 h-4" />
              </ToolbarBtn>
              <ToolbarBtn onClick={() => openUploadDialog()} title="Upload to current directory" disabled={!canUpload}>
                <Upload className="w-4 h-4" />
              </ToolbarBtn>
              <div className="w-px h-4 bg-white/10 mx-1" />
              <ToolbarBtn onClick={handleCopy} title="Copy" disabled={selected.size === 0}>
                <Copy className="w-4 h-4" />
              </ToolbarBtn>
              <ToolbarBtn onClick={handleCut} title="Cut" disabled={selected.size === 0}>
                <Scissors className="w-4 h-4" />
              </ToolbarBtn>
              <ToolbarBtn onClick={() => handleDownload()} title="Download" disabled={selected.size === 0}>
                <Download className="w-4 h-4" />
              </ToolbarBtn>
              <ToolbarBtn onClick={handlePaste} title="Paste" disabled={!clipboard}>
                <ClipboardPaste className={`w-4 h-4 ${clipboard ? 'text-emerald-400' : ''}`} />
              </ToolbarBtn>
            </>
          )}
          {isMobile && (
            <ToolbarBtn onClick={() => openUploadDialog()} title="Upload" disabled={!canUpload}>
              <Upload className="w-4 h-4" />
            </ToolbarBtn>
          )}
        </div>
      </div>

      {/* Content */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto p-3 flex flex-col relative select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDragEnter={e => {
          if (!canUpload) return;
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          dragDepthRef.current++;
          setDragActive(true);
        }}
        onDragOver={e => {
          if (!canUpload) return;
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={e => {
          if (!canUpload) return;
          if (!e.dataTransfer.types.includes('Files')) return;
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) setDragActive(false);
        }}
        onDrop={e => {
          if (!canUpload) return;
          if (!e.dataTransfer.types.includes('Files')) return;
          e.preventDefault();
          dragDepthRef.current = 0;
          setDragActive(false);
          if (e.dataTransfer.files.length > 0) {
            openUploadDialog(e.dataTransfer.files);
          }
        }}
      >
        {dragActive && canUpload && (
          <div className="absolute inset-2 z-20 flex items-center justify-center pointer-events-none rounded-lg border-2 border-dashed border-emerald-400/60 bg-emerald-500/10 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-2 text-emerald-300">
              <Upload className="w-8 h-8" />
              <span className="text-sm">Drop files to upload to {currentPath}</span>
            </div>
          </div>
        )}
        {selectionBox && (
          <div 
            className="absolute border border-emerald-500 bg-emerald-500/10 pointer-events-none z-10 rounded-sm"
            style={{
              left: Math.min(selectionBox.startX, selectionBox.currentX),
              top: Math.min(selectionBox.startY, selectionBox.currentY),
              width: Math.abs(selectionBox.currentX - selectionBox.startX),
              height: Math.abs(selectionBox.currentY - selectionBox.startY),
            }}
          />
        )}
        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
            <button className="ml-auto text-xs underline" onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}

        {/* Loading */}
        {loading && connected && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#0d1117]/40 text-gray-300 backdrop-blur-[1px] pointer-events-none">
            <div className="flex items-center rounded-lg border border-white/10 bg-black/30 px-4 py-2 shadow-lg">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading...
            </div>
          </div>
        )}

        {/* Not connected */}
        {!connected && !loading && (
          <div className="flex flex-col items-center justify-center py-16 text-gray-500 gap-2">
            <AlertCircle className="w-8 h-8 text-amber-500" />
            <span>Connecting to server...</span>
            <span className="text-xs text-gray-600">Make sure the Go backend is running on port 8080</span>
          </div>
        )}

        {/* File grid/list */}
        {connected && (
          <ContextMenu>
            <ContextMenuTrigger
              disabled={contextMenusDisabled || isMobile}
              className="flex-1 min-h-full flex flex-col"
              onContextMenu={e => {
                if ((e.target as HTMLElement).closest('.file-item')) {
                  e.preventDefault();
                  e.stopPropagation();
                  return;
                }
                swallowSuppressedInteraction(e);
              }}
            >
              {viewMode === 'grid' ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] gap-1">
                  {files.map((f, i) => (
                    <ContextMenu key={f.path}>
                      <ContextMenuTrigger
                        asChild
                        disabled={contextMenusDisabled}
                        onContextMenu={e => {
                          if (swallowSuppressedInteraction(e)) {
                            return;
                          }
                          e.stopPropagation();
                        }}
                      >
                        <div
                          data-path={f.path}
                          className={`file-item flex flex-col items-center gap-1.5 p-3 rounded-lg cursor-pointer transition-all group
                            ${selected.has(f.path) ? 'bg-emerald-500/10 ring-1 ring-emerald-500/30' : 'hover:bg-white/5'}
                          `}
                          onMouseDown={e => {
                            if (swallowSuppressedInteraction(e)) {
                              return;
                            }
                            if (e.button === 2 && !selected.has(f.path)) {
                              setSelected(new Set([f.path]));
                              setLastSelectedPath(f.path);
                            }
                          }}
                          onClick={e => handleItemClick(e, f, i)}
                          onDoubleClick={e => {
                            if (swallowSuppressedInteraction(e)) {
                              return;
                            }
                            if (isMobile) return;
                            e.stopPropagation();
                            handleOpen(f);
                          }}
                        >
                          {getFileIcon(f.name, f.isDir, f.path)}
                          <span className="text-xs text-center text-gray-400 group-hover:text-gray-200 truncate w-full transition-colors">{f.name}</span>
                        </div>
                      </ContextMenuTrigger>
                      {renderFileContextMenu(f)}
                    </ContextMenu>
                  ))}
                  {files.length === 0 && !loading && (
                    <div className="col-span-full text-center py-12 text-gray-600 text-sm">Empty directory</div>
                  )}
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-500 text-xs uppercase border-b border-white/5">
                      <th className="text-left px-2 py-1.5">Name</th>
                      <th className="text-right px-2 py-1.5 w-24">Size</th>
                      <th className="text-right px-2 py-1.5 w-40">Modified</th>
                      <th className="text-left px-2 py-1.5 w-24">Mode</th>
                    </tr>
                  </thead>
                  <tbody>
                    {files.map((f, i) => (
                      <ContextMenu key={f.path}>
                        <ContextMenuTrigger
                          asChild
                          disabled={contextMenusDisabled}
                          onContextMenu={e => {
                            if (swallowSuppressedInteraction(e)) {
                              return;
                            }
                            e.stopPropagation();
                          }}
                        >
                          <tr
                            data-path={f.path}
                            className={`file-item border-b border-white/5 cursor-pointer transition-colors ${selected.has(f.path) ? 'bg-emerald-500/10' : 'hover:bg-white/5'}`}
                            onMouseDown={e => {
                              if (swallowSuppressedInteraction(e)) {
                                return;
                              }
                              if (e.button === 2 && !selected.has(f.path)) {
                                setSelected(new Set([f.path]));
                                setLastSelectedPath(f.path);
                              }
                            }}
                            onClick={e => handleItemClick(e, f, i)}
                            onDoubleClick={e => { 
                              if (swallowSuppressedInteraction(e)) {
                                return;
                              }
                              if (isMobile) return;
                              e.stopPropagation(); 
                              handleOpen(f); 
                            }}
                          >
                            <td className="px-2 py-1.5 flex items-center gap-2">
                              <div className="w-5 h-5 flex items-center justify-center shrink-0 overflow-hidden rounded-[3px]">
                                {getFileIcon(f.name, f.isDir, f.path, 'list')}
                              </div>
                              {f.name}
                            </td>
                            <td className="text-right px-2 py-1.5 text-gray-500 font-mono">{f.isDir ? '-' : formatSize(f.size)}</td>
                            <td className="text-right px-2 py-1.5 text-gray-500">{formatTime(f.modTime)}</td>
                            <td className="px-2 py-1.5 text-gray-600 font-mono text-xs">{f.mode}</td>
                          </tr>
                        </ContextMenuTrigger>
                        {renderFileContextMenu(f)}
                      </ContextMenu>
                    ))}
                  </tbody>
                </table>
              )}
            </ContextMenuTrigger>
            <ContextMenuContent
              className="w-52 liquid-glass text-gray-200 border-white/10"
              onPointerDownCapture={() => armContextMenuInteractionGuard()}
            >
              <ContextMenuItem className="focus:liquid-glass-active focus:text-white" onSelect={() => {
                armContextMenuInteractionGuard();
                handleOpenTerminal(currentPath);
              }}>
                <Terminal className="w-4 h-4 mr-2" /> Open in Terminal
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => {
                armContextMenuInteractionGuard();
                loadFiles(currentPath);
              }}>
                <RefreshCw className="w-4 h-4 mr-2" /> Refresh
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => {
                armContextMenuInteractionGuard();
                setCreateDialog('file');
              }}>
                <Plus className="w-4 h-4 mr-2" /> New File
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => {
                armContextMenuInteractionGuard();
                setCreateDialog('dir');
              }}>
                <FolderPlus className="w-4 h-4 mr-2" /> New Folder
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => {
                armContextMenuInteractionGuard();
                openUploadDialog();
              }} disabled={!canUpload}>
                <Upload className="w-4 h-4 mr-2" /> Upload Files
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => {
                armContextMenuInteractionGuard();
                handlePaste();
              }} disabled={!clipboard}>
                <ClipboardPaste className="w-4 h-4 mr-2" /> Paste
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )}
      </div>

      {/* Statusbar */}
      <div className="flex items-center px-3 py-1.5 border-t border-white/5 bg-white/[0.02] text-xs text-gray-500 gap-4">
        <span>{files.length} items</span>
        {selected.size > 0 && <span>{selected.size} selected</span>}

        {/* Selected file actions */}
        {selected.size > 0 && (
          <div className="flex items-center gap-1 ml-2">
            {appMode === 'trash' ? (
              <ActionBtn onClick={handleRestoreBulk}>
                <Undo2 className="w-3 h-3" /> Restore
              </ActionBtn>
            ) : (
              <ActionBtn onClick={() => {
                const paths = Array.from(selected);
                const firstFile = files.find(f => f.path === paths[0]);
                const defaultName = paths.length === 1 && firstFile ? `${firstFile.name}.zip` : 'archive.zip';
                setCompressDialog(paths);
                setCompressName(defaultName);
              }}>
                <FileArchive className="w-3 h-3" /> Compress
              </ActionBtn>
            )}
            {appMode === 'files' && (
              <ActionBtn onClick={() => handleDownload()}>
                <Download className="w-3 h-3" /> Download
              </ActionBtn>
            )}
            {selected.size === 1 && appMode === 'files' && (
              <ActionBtn onClick={() => {
                const f = files.find(f => f.path === [...selected][0]);
                if (f) { setRenameTarget(f); setRenameValue(f.name); }
              }}>
                <Pencil className="w-3 h-3" /> Rename
              </ActionBtn>
            )}
            {selected.size > 1 && appMode === 'files' && (
              <ActionBtn onClick={() => {
                const targets = files.filter(f => selected.has(f.path));
                if (targets.length === 0) return;
                setBatchRenameTargets(targets);
                const firstDot = targets[0].name.lastIndexOf('.');
                const baseGuess = !targets[0].isDir && firstDot > 0
                  ? targets[0].name.substring(0, firstDot)
                  : targets[0].name;
                setBatchRenameBase(baseGuess);
              }}>
                <Pencil className="w-3 h-3" /> 批量重命名
              </ActionBtn>
            )}
            <ActionBtn onClick={() => {
              const selectedFiles = files.filter(f => selected.has(f.path));
              setDeleteConfirmBulk(selectedFiles);
            }} variant="danger">
              <Trash2 className="w-3 h-3" /> {appMode === 'trash' ? 'Delete Permanently' : 'Delete'}
            </ActionBtn>
          </div>
        )}

        {appMode === 'trash' && files.length > 0 && selected.size === 0 && (
          <ActionBtn onClick={() => setEmptyTrashConfirm(true)} variant="danger">
            <Trash className="w-3 h-3" /> Empty Trash
          </ActionBtn>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            className={`px-1.5 py-0.5 rounded text-xs ${viewMode === 'grid' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'}`}
            onClick={() => setViewMode('grid')}
          >Grid</button>
          <button
            className={`px-1.5 py-0.5 rounded text-xs ${viewMode === 'list' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300'}`}
            onClick={() => setViewMode('list')}
          >List</button>

          <div className="w-px h-3 bg-white/10" />
          <div className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-red-400'}`} />
          <span>{connected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </div>

      {/* ===== Dialogs ===== */}

      {/* Paste progress modal — blocks all interaction while in flight */}
      {pasteProgress && <PasteProgressDialog progress={pasteProgress} />}

      {/* Rename Dialog */}
      {renameTarget && (
        <Dialog title={`Rename: ${renameTarget.name}`} onClose={() => setRenameTarget(null)}>
          <input
            autoFocus
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white outline-none focus:border-emerald-500/50"
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleRename()}
          />
          <div className="flex justify-end gap-2 mt-3">
            <DialogBtn onClick={() => setRenameTarget(null)}>Cancel</DialogBtn>
            <DialogBtn primary onClick={handleRename}>Rename</DialogBtn>
          </div>
        </Dialog>
      )}

      {/* Batch Rename Dialog */}
      {batchRenameTargets && (
        <Dialog title={`批量重命名 ${batchRenameTargets.length} 项`} onClose={() => setBatchRenameTargets(null)}>
          <input
            autoFocus
            placeholder="基础名称"
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white outline-none focus:border-emerald-500/50"
            value={batchRenameBase}
            onChange={e => setBatchRenameBase(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleBatchRename()}
          />
          <p className="text-xs text-gray-500 mt-2">
            将重命名为 <code className="text-gray-300">{batchRenameBase || '名称'} (1).ext</code>、<code className="text-gray-300">{batchRenameBase || '名称'} (2).ext</code>……
          </p>
          <div className="flex justify-end gap-2 mt-3">
            <DialogBtn onClick={() => setBatchRenameTargets(null)}>Cancel</DialogBtn>
            <DialogBtn primary onClick={handleBatchRename}>Rename</DialogBtn>
          </div>
        </Dialog>
      )}

      {/* Create Dialog */}
      {createDialog && (
        <Dialog title={createDialog === 'dir' ? 'New Folder' : 'New File'} onClose={() => setCreateDialog(null)}>
          <input
            autoFocus
            placeholder={createDialog === 'dir' ? 'Folder name' : 'File name'}
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white outline-none focus:border-emerald-500/50"
            value={createName}
            onChange={e => setCreateName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
          />
          <div className="flex justify-end gap-2 mt-3">
            <DialogBtn onClick={() => setCreateDialog(null)}>Cancel</DialogBtn>
            <DialogBtn primary onClick={handleCreate}>Create</DialogBtn>
          </div>
        </Dialog>
      )}

      {/* Compress Dialog */}
      {compressDialog && (
        <Dialog title="Compress" onClose={() => setCompressDialog(null)}>
          <input
            autoFocus
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white outline-none focus:border-emerald-500/50"
            value={compressName}
            onChange={e => setCompressName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCompress()}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {(['zip', 'tar', 'tar.gz', 'tar.xz', 'gz', 'xz'] as const).map(fmt => (
              <button
                key={fmt}
                type="button"
                className="px-2 py-0.5 rounded-md text-xs bg-white/5 border border-white/10 text-gray-300 hover:text-white hover:border-emerald-500/50 transition-colors"
                onClick={() => {
                  const base = compressName.trim().replace(/\.(tar\.gz|tar\.xz|tar\.bz2|tgz|txz|tbz2?|zip|tar|gz|xz|bz2)$/i, '');
                  setCompressName(`${base || 'archive'}.${fmt}`);
                }}
              >
                .{fmt}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Format is determined by the extension. Supported: .zip, .tar, .tar.gz / .tgz, .tar.xz / .txz, .gz, .xz
          </p>
          <div className="flex justify-end gap-2 mt-3">
            <DialogBtn onClick={() => setCompressDialog(null)}>Cancel</DialogBtn>
            <DialogBtn primary onClick={handleCompress}>Compress</DialogBtn>
          </div>
        </Dialog>
      )}

      {/* Empty Trash Confirm */}
      {emptyTrashConfirm && (
        <Dialog title="Empty Trash" onClose={() => setEmptyTrashConfirm(false)}>
          <p className="text-sm text-gray-400">Are you sure you want to permanently delete all items in the Recycle Bin?</p>
          <div className="flex justify-end gap-2 mt-3">
            <DialogBtn onClick={() => setEmptyTrashConfirm(false)}>Cancel</DialogBtn>
            <DialogBtn danger onClick={handleEmptyTrash}>Empty Trash</DialogBtn>
          </div>
        </Dialog>
      )}

      {/* Delete Confirm Dialog */}
      {deleteConfirmBulk && (
        <Dialog 
          title={deleteConfirmBulk.length === 1 ? `Delete: ${deleteConfirmBulk[0].name}` : `Delete ${deleteConfirmBulk.length} items`} 
          onClose={() => setDeleteConfirmBulk(null)}
        >
          <p className="text-sm text-gray-400 break-words">
            {deleteConfirmBulk.length === 1 ? (
              <>
                Are you sure you want to delete <strong className="text-white">{deleteConfirmBulk[0].name}</strong>?
                {deleteConfirmBulk[0].isDir && <span className="text-amber-400"> This will delete all contents.</span>}
              </>
            ) : (
              <>Are you sure you want to delete <strong className="text-white">{deleteConfirmBulk.length} items</strong>?</>
            )}
          </p>
          <div className="flex justify-end gap-2 mt-3">
            <DialogBtn onClick={() => setDeleteConfirmBulk(null)}>Cancel</DialogBtn>
            <DialogBtn danger onClick={handleDeleteBulk}>Delete</DialogBtn>
          </div>
        </Dialog>
      )}
      {showUploadDialog && (
        <UploadDialog
          currentPath={currentPath}
          initialFiles={uploadDialogInitialFiles}
          onClose={closeUploadDialog}
          onComplete={() => loadFiles(currentPath)}
        />
      )}
    </div>
  );

  // Note: this is a plain render function (NOT a React component). Defining it
  // as a component nested inside FileManager would create a fresh component
  // type on every render, causing the menu to remount and capture a stale
  // `selected` set — that's why right-click actions only operated on the
  // single right-clicked file even when multiple were drag-selected.
  function renderFileContextMenu(file: FileInfo) {
    const targetPaths = selected.has(file.path) ? Array.from(selected) : [file.path];
    const targetFiles = selected.has(file.path)
      ? files.filter(f => selected.has(f.path))
      : [file];
    const isMultiTarget = targetPaths.length > 1;
    const runContextMenuAction = (action: () => void) => () => {
      armContextMenuInteractionGuard();
      action();
    };

    return (
      <ContextMenuContent
        className="w-52 liquid-glass text-gray-200 border-white/10"
        onPointerDownCapture={() => armContextMenuInteractionGuard()}
      >
        {appMode === 'trash' ? (
          <>
            <ContextMenuItem className="focus:liquid-glass-active focus:text-white" onSelect={runContextMenuAction(() => {
              Promise.all(targetPaths.map(p => clientRef.current?.restore(p))).then(() => loadFiles(currentPath));
            })}>
              <Undo2 className="w-4 h-4 mr-2" /> {isMultiTarget ? `恢复 ${targetPaths.length} 项` : 'Restore'}
            </ContextMenuItem>
            <ContextMenuItem
              variant="destructive"
              className="focus:liquid-glass-active focus:text-red-300"
              onSelect={runContextMenuAction(() => {
                setDeleteConfirmBulk(targetFiles);
              })}
            >
              <Trash2 className="w-4 h-4 mr-2" /> {isMultiTarget ? `永久删除 ${targetPaths.length} 项` : 'Delete Permanently'}
            </ContextMenuItem>
          </>
        ) : (
          <>
            {!isMultiTarget && (
              <ContextMenuItem className="focus:liquid-glass-active focus:text-white" onSelect={runContextMenuAction(() => handleOpen(file))}>
                {file.isDir ? <FolderOpen className="w-4 h-4 mr-2" /> : <FileText className="w-4 h-4 mr-2" />}
                Open
              </ContextMenuItem>
            )}
            <ContextMenuItem className="focus:liquid-glass-active focus:text-white" onSelect={runContextMenuAction(() => handleDownload(targetPaths))}>
              <Download className="w-4 h-4 mr-2" /> {isMultiTarget ? `下载 ${targetPaths.length} 项` : 'Download'}
            </ContextMenuItem>
            {!isMultiTarget && file.isDir && (
              <ContextMenuItem className="focus:liquid-glass-active focus:text-white" onSelect={runContextMenuAction(() => handleOpenTerminal(file.path))}>
                <Terminal className="w-4 h-4 mr-2" /> Open Terminal here
              </ContextMenuItem>
            )}
            {!isMultiTarget && <ContextMenuSeparator />}
            <ContextMenuItem className="focus:liquid-glass-active focus:text-white" onSelect={runContextMenuAction(() => {
              setClipboard({ paths: targetPaths, mode: 'copy' });
            })}>
              <Copy className="w-4 h-4 mr-2" /> {isMultiTarget ? `复制 ${targetPaths.length} 项` : 'Copy'}
            </ContextMenuItem>
            <ContextMenuItem className="focus:liquid-glass-active focus:text-white" onSelect={runContextMenuAction(() => {
              setClipboard({ paths: targetPaths, mode: 'cut' });
            })}>
              <Scissors className="w-4 h-4 mr-2" /> {isMultiTarget ? `剪切 ${targetPaths.length} 项` : 'Cut'}
            </ContextMenuItem>
            <ContextMenuItem className="focus:liquid-glass-active focus:text-white" onSelect={runContextMenuAction(() => {
              const defaultName = isMultiTarget ? 'archive.zip' : `${file.name}.zip`;
              setCompressDialog(targetPaths);
              setCompressName(defaultName);
            })}>
              <FileArchive className="w-4 h-4 mr-2" /> Compress
            </ContextMenuItem>
            <ContextMenuSeparator />
            {isMultiTarget ? (
              <ContextMenuItem className="focus:liquid-glass-active focus:text-white" onSelect={runContextMenuAction(() => {
                setBatchRenameTargets(targetFiles);
                const firstDot = targetFiles[0].name.lastIndexOf('.');
                const baseGuess = !targetFiles[0].isDir && firstDot > 0
                  ? targetFiles[0].name.substring(0, firstDot)
                  : targetFiles[0].name;
                setBatchRenameBase(baseGuess);
              })}>
                <Pencil className="w-4 h-4 mr-2" /> 批量重命名
              </ContextMenuItem>
            ) : (
              <ContextMenuItem className="focus:liquid-glass-active focus:text-white" onSelect={runContextMenuAction(() => {
                setRenameTarget(file);
                setRenameValue(file.name);
              })}>
                <Pencil className="w-4 h-4 mr-2" /> Rename
              </ContextMenuItem>
            )}
            <ContextMenuItem
              variant="destructive"
              className="focus:liquid-glass-active focus:text-red-300"
              onSelect={runContextMenuAction(() => {
                setDeleteConfirmBulk(targetFiles);
              })}
            >
              <Trash2 className="w-4 h-4 mr-2" /> {isMultiTarget ? `删除 ${targetPaths.length} 项` : 'Delete'}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    );
  }
}

// --- Sub-components ---

function PasteProgressDialog({ progress }: {
  progress: {
    mode: 'copy' | 'cut';
    index: number;
    total: number;
    currentName: string;
    innerDone: number;
    innerTotal: number;
  };
}) {
  const { mode, index, total, currentName, innerDone, innerTotal } = progress;
  // Overall percentage across the whole paste session: completed items
  // contribute fully; the in-flight item contributes its inner ratio.
  const inFlightFraction = innerTotal > 0 ? innerDone / innerTotal : 0;
  const overall = total > 0 ? Math.min(100, Math.round(((index - 1 + inFlightFraction) / total) * 100)) : 0;
  const verb = mode === 'cut' ? 'Moving' : 'Copying';
  const innerLabel = innerTotal > 1 ? `${innerDone} / ${innerTotal} files` : '';
  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      // Swallow every interaction so nothing behind the modal responds
      // while the paste/move is in flight.
      onMouseDown={e => { e.preventDefault(); e.stopPropagation(); }}
      onMouseUp={e => { e.preventDefault(); e.stopPropagation(); }}
      onClick={e => { e.preventDefault(); e.stopPropagation(); }}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); }}
    >
      <div
        className="bg-[#161b22] border border-white/10 rounded-xl p-4 w-96 shadow-2xl"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-3">
          <Loader2 className="w-4 h-4 shrink-0 animate-spin text-emerald-400" />
          <h3 className="text-sm font-semibold text-gray-200">{verb}…</h3>
          <span className="ml-auto text-xs text-gray-500">{index} / {total}</span>
        </div>
        <div className="text-xs text-gray-400 mb-2 truncate" title={currentName}>{currentName}</div>
        <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
          <div
            className="h-full bg-emerald-400/80 transition-[width] duration-150"
            style={{ width: `${overall}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-gray-500">
          <span>{innerLabel}</span>
          <span>{overall}%</span>
        </div>
      </div>
    </div>
  );
}

function ToolbarBtn({ children, onClick, disabled, title, active }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean; title?: string; active?: boolean;
}) {
  return (
    <button
      className={`p-1.5 rounded-md transition-colors ${disabled ? 'text-gray-600 cursor-not-allowed' : active ? 'bg-emerald-500/10 text-emerald-400' : 'text-gray-400 hover:bg-white/10 hover:text-white'}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

function ActionBtn({ children, onClick, variant }: {
  children: React.ReactNode; onClick: () => void; variant?: 'danger';
}) {
  return (
    <button
      className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors ${variant === 'danger' ? 'text-red-400 hover:bg-red-500/10' : 'text-gray-400 hover:bg-white/10 hover:text-white'}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Dialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  // Only treat a click as "click on backdrop" when the mousedown also landed
  // directly on the backdrop. Without this, a mouseup that mounts the dialog
  // (e.g. selecting a context-menu item that opens it) generates a synthesized
  // click on the freshly-mounted backdrop and immediately closes it.
  const downOnBackdropRef = useRef(false);
  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onMouseDown={e => {
        downOnBackdropRef.current = e.target === e.currentTarget;
        e.stopPropagation();
      }}
      onMouseUp={e => e.stopPropagation()}
      onClick={() => {
        if (downOnBackdropRef.current) onClose();
        downOnBackdropRef.current = false;
      }}
    >
      <div className="bg-[#161b22] border border-white/10 rounded-xl p-4 w-80 shadow-2xl" onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
        <h3 className="text-sm font-semibold mb-3 text-gray-200 break-words">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function DialogBtn({ children, onClick, primary, danger }: {
  children: React.ReactNode; onClick: () => void; primary?: boolean; danger?: boolean;
}) {
  const base = 'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors';
  const cls = danger
    ? `${base} bg-red-500/20 text-red-400 hover:bg-red-500/30`
    : primary
      ? `${base} bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30`
      : `${base} text-gray-400 hover:bg-white/10`;
  return <button className={cls} onClick={onClick}>{children}</button>;
}
