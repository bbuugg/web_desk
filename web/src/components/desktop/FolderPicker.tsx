import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  FolderOpen, ChevronRight, Home, Monitor, Plus, Loader2,
  X, Check, ArrowLeft, ArrowRight, ArrowUp
} from 'lucide-react';
import { FileManagerClient, type FileInfo } from '@/lib/ws-client';
import { getParentPath, getBreadcrumbModel } from '@/lib/path-utils';
import { toast } from 'sonner';
import { Button } from '../ui/button';

interface FolderPickerProps {
  initialPath?: string;
  onSelect: (path: string) => void;
  onCancel: () => void;
  title?: string;
  mode?: 'folder' | 'file';
  /** When set, only files matching these extensions (without dot) are shown. */
  extensions?: string[];
}

export default function FolderPicker({ initialPath = '~', onSelect, onCancel, title = 'Select Destination', mode = 'folder', extensions }: FolderPickerProps) {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [items, setItems] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [creating, setCreating] = useState(false);

  const [history, setHistory] = useState<string[]>([initialPath]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const clientRef = useRef<FileManagerClient | null>(null);

  // Persist WebSocket connection
  useEffect(() => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/api/ws/files`;
    const client = new FileManagerClient(wsUrl, setConnected);
    clientRef.current = client;
    client.connect();
    return () => client.disconnect();
  }, []);

  const loadItems = useCallback(async (path: string) => {
    if (!clientRef.current) return;
    setLoading(true);
    try {
      const resp = await clientRef.current.list(path);
      const extSet = extensions && extensions.length > 0 ? new Set(extensions.map(e => e.toLowerCase())) : null;
      const filtered = (resp.files || []).filter(f => {
        if (f.isDir) return true;
        if (mode !== 'file') return true;
        if (!extSet) return true;
        const ext = f.name.split('.').pop()?.toLowerCase() || '';
        return extSet.has(ext);
      });
      setItems(filtered);
      setCurrentPath(resp.path);
    } catch (e) {
      toast.error('Failed to load items: ' + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [mode]);

  // Initial load once connected
  useEffect(() => {
    if (connected) {
      loadItems(initialPath);
    }
  }, [connected, initialPath, loadItems]);

  const navigateTo = useCallback((path: string) => {
    const newHistory = [...history.slice(0, historyIndex + 1), path];
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
    loadItems(path);
  }, [history, historyIndex, loadItems]);

  const goBack = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      loadItems(history[newIndex]);
    }
  }, [historyIndex, history, loadItems]);

  const goForward = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      loadItems(history[newIndex]);
    }
  }, [historyIndex, history, loadItems]);

  const goUp = useCallback(() => {
    const parentPath = getParentPath(currentPath);
    if (parentPath !== currentPath) {
      navigateTo(parentPath);
    }
  }, [currentPath, navigateTo]);

  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || !clientRef.current) return;
    setCreating(true);
    try {
      const sep = currentPath.includes('\\') ? '\\' : '/';
      const newPath = currentPath.endsWith(sep) ? currentPath + newFolderName : currentPath + sep + newFolderName;

      await clientRef.current.mkdir(newPath);

      setNewFolderName('');
      setShowNewFolder(false);
      loadItems(currentPath);
      toast.success('Folder created');
    } catch (e) {
      toast.error('Failed to create folder: ' + (e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const breadcrumb = getBreadcrumbModel(currentPath);

  const navBtnClass = (disabled: boolean) =>
    `p-1.5 rounded-md transition-colors ${disabled ? 'text-gray-600 cursor-default' : 'text-gray-400 hover:bg-white/10 hover:text-gray-200'}`;

  const selectLabel = mode === 'file' ? 'Select' : 'Select Folder';
  const emptyLabel = mode === 'file' ? 'No items found' : 'No subfolders found';

  return createPortal(
    <div className="fixed inset-0 z-[20000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-[92vw] sm:w-[480px] h-[85vh] sm:h-[560px] bg-[#161b22] border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
          <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
            {mode === 'file' ? <Monitor className="w-4 h-4 text-emerald-400" /> : <FolderOpen className="w-4 h-4 text-amber-400" />}
            {title}
          </h3>
          <button onClick={onCancel} className="p-1 hover:bg-white/10 rounded-md transition-colors">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="px-3 py-2 border-b border-white/5 bg-white/[0.01] flex items-center gap-1.5">
          <button onClick={goBack} disabled={historyIndex <= 0} className={navBtnClass(historyIndex <= 0)} title="Back">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button onClick={goForward} disabled={historyIndex >= history.length - 1} className={navBtnClass(historyIndex >= history.length - 1)} title="Forward">
            <ArrowRight className="w-4 h-4" />
          </button>
          <button onClick={goUp} className={navBtnClass(currentPath === '/' || currentPath === '')} title="Up">
            <ArrowUp className="w-4 h-4" />
          </button>

          <div className="w-px h-5 bg-white/[0.06] mx-0.5" />

          <button
            onClick={() => navigateTo('computer://')}
            className="p-1.5 hover:bg-white/10 rounded-md text-gray-400"
            title="This PC"
          >
            <Monitor className="w-4 h-4" />
          </button>
          <button
            onClick={() => navigateTo('~')}
            className="p-1.5 hover:bg-white/10 rounded-md text-gray-400"
            title="Home"
          >
            <Home className="w-4 h-4" />
          </button>

          {/* Breadcrumb */}
          <div className="flex items-center gap-0.5 mx-1 px-2 py-1.5 rounded-lg bg-white/5 flex-1 text-xs overflow-x-auto no-scrollbar min-w-[120px]">
            {currentPath === 'computer://' ? (
              <span className="text-white font-medium px-1">This PC</span>
            ) : (
              <>
                <button
                  className="text-gray-400 hover:text-white shrink-0"
                  onClick={() => navigateTo(breadcrumb.rootPath)}
                >
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

          <button
            onClick={() => setShowNewFolder(true)}
            className="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 rounded-md text-emerald-400 transition-colors"
            title="New Folder"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-auto min-h-[150px] sm:min-h-[300px]">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : (
            <div className="grid grid-cols-1 divide-y divide-white/5">
              {items.map((item, i) => (
                <button
                  key={i}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 text-left transition-colors group"
                  onClick={() => {
                    if (item.isDir) {
                      navigateTo(item.path);
                    } else if (mode === 'file') {
                      onSelect(item.path);
                    }
                  }}
                >
                  {item.isDir ? (
                    <FolderOpen className="w-4 h-4 text-amber-400/60 group-hover:text-amber-400" />
                  ) : (
                    <Monitor className="w-4 h-4 text-emerald-400/60 group-hover:text-emerald-400" />
                  )}
                  <span className="text-sm text-gray-300 group-hover:text-white truncate">{item.name}</span>
                  {item.isDir && <ChevronRight className="w-3 h-3 text-gray-600 ml-auto" />}
                </button>
              ))}
              {items.length === 0 && (
                <div className="p-8 text-center text-gray-500 text-xs italic">
                  {emptyLabel}
                </div>
              )}
            </div>
          )}
        </div>

        {/* New Folder Overlay */}
        {showNewFolder && (
          <div className="px-4 py-3 bg-emerald-500/5 border-t border-emerald-500/20 flex gap-2 animate-in slide-in-from-bottom-2 duration-200">
            <input
              autoFocus
              className="flex-1 bg-black/40 border border-emerald-500/30 rounded px-3 py-1.5 text-sm text-white outline-none focus:border-emerald-500/60"
              placeholder="New folder name..."
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreateFolder()}
            />
            <button
              onClick={handleCreateFolder}
              disabled={creating || !newFolderName.trim()}
              className="px-3 py-1.5 bg-emerald-500 text-white rounded text-xs font-medium hover:bg-emerald-600 disabled:opacity-50"
            >
              {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-4 h-4" />}
            </button>
            <button
              onClick={() => setShowNewFolder(false)}
              className="px-3 py-1.5 bg-white/5 text-gray-400 rounded text-xs hover:bg-white/10"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Footer */}
        <div className="px-4 py-4 border-t border-white/5 bg-white/[0.02] flex justify-end gap-3">
          <Button
            onClick={onCancel}
            variant="ghost"
            className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </Button>
          {mode === 'folder' && (
            <Button
              onClick={() => onSelect(currentPath)}
              className="px-6 py-2 bg-emerald-500 text-white rounded-xl text-sm font-semibold hover:bg-emerald-600 hover:shadow-[0_0_15px_rgba(16,185,129,0.4)] transition-all active:scale-95"
            >
              {selectLabel}
            </Button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
