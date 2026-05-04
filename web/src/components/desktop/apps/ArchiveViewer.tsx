import { useState, useEffect, useCallback, useMemo } from 'react';
import { FileArchive, File, FolderOpen, PackageOpen, Loader2, AlertCircle, ChevronRight, Home, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import type { AppComponentProps } from '@/types/desktop';
import { FileManagerClient, type FileInfo } from '@/lib/ws-client';
import FolderPicker from '@/components/desktop/FolderPicker';
import { getExtensionsForApp } from '@/lib/fileAssociations';
import { getParentPath } from '@/lib/path-utils';
import { formatSize } from '@/lib/utils';

export default function ArchiveViewer({ windowId, actions, appState }: AppComponentProps) {
  const [allFiles, setAllFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [currentDir, setCurrentDir] = useState(''); // Relative path inside zip
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastSelectedPath, setLastSelectedPath] = useState<string | null>(null);
  
  const path = appState?.path || '';

  const loadArchive = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    setError(null);
    try {
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}/api/ws/files`;
      const client = new FileManagerClient(wsUrl, (connected) => {
        if (!connected && !loading) {
           // Handle disconnection
        }
      });
      client.connect();
      
      // Wait for connect - more robustly
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Connection timeout')), 5000);
        const check = setInterval(() => {
          // Accessing private ws for check, using cast to bypass private access if needed or just wait
          const ws = (client as any).ws as WebSocket | null;
          if (ws?.readyState === WebSocket.OPEN) {
            clearTimeout(timeout);
            clearInterval(check);
            resolve(true);
          }
        }, 100);
      });

      const resp = await client.listArchive(path);
      setAllFiles(resp.files || []);
      client.disconnect();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    loadArchive();
  }, [loadArchive]);

  // Filter files for current directory level
  const displayedFiles = useMemo(() => {
    const filtered: FileInfo[] = [];
    const seenDirs = new Set<string>();

    allFiles.forEach(f => {
      let name = f.name;
      // Normalizing path separators
      name = name.replace(/\\/g, '/');
      const dir = currentDir.replace(/\\/g, '/');

      if (name === dir) return; // Skip the directory itself if listed

      if (name.startsWith(dir)) {
        const relative = name.slice(dir.length).replace(/^\//, '');
        if (!relative) return;

        const parts = relative.split('/');
        const shortName = parts[0];

        if (parts.length > 1) {
          // It's a directory
          if (!seenDirs.has(shortName)) {
            filtered.push({
              name: shortName,
              path: (dir ? dir + '/' : '') + shortName,
              isDir: true,
              size: 0,
              modTime: f.modTime,
              mode: 'd'
            });
            seenDirs.add(shortName);
          }
        } else {
          // It's a file or an explicit directory entry
          filtered.push({
            ...f,
            name: shortName,
            path: name
          });
        }
      }
    });

    return filtered.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [allFiles, currentDir]);

  const performExtract = async (destPath: string) => {
    if (!path) return;
    setShowPicker(false);
    setExtracting(true);
    const toastId = toast.loading('Extracting archive...');
    try {
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}/api/ws/files`;
      const client = new FileManagerClient(wsUrl);
      await client.connect();
      
      const filesToExtract = selected.size > 0 ? Array.from(selected) : undefined;
      // If we are in a subfolder, strip the current directory prefix during extraction
      const stripPrefix = currentDir || undefined;
      await client.unzip(path, destPath, filesToExtract, stripPrefix);
      
      client.disconnect();
      toast.success('Archive extracted successfully!', { id: toastId });
      if (selected.size > 0) setSelected(new Set());
    } catch (e) {
      toast.error('Extraction failed: ' + (e as Error).message, { id: toastId });
    } finally {
      setExtracting(false);
    }
  };

  const handleItemClick = useCallback((e: React.MouseEvent, file: FileInfo, index: number) => {
    e.stopPropagation();
    
    let newSelected = new Set(selected);
    if (e.ctrlKey || e.metaKey) {
      if (newSelected.has(file.path)) {
        newSelected.delete(file.path);
      } else {
        newSelected.add(file.path);
      }
    } else if (e.shiftKey && lastSelectedPath) {
      const lastIndex = displayedFiles.findIndex(f => f.path === lastSelectedPath);
      const start = Math.min(lastIndex, index);
      const end = Math.max(lastIndex, index);
      const rangePaths = displayedFiles.slice(start, end + 1).map(f => f.path);
      
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
  }, [selected, lastSelectedPath, displayedFiles]);

  const goBack = () => {
    if (!currentDir) return;
    const parts = currentDir.replace(/\\/g, '/').split('/').filter(Boolean);
    parts.pop();
    setCurrentDir(parts.join('/'));
    setSelected(new Set());
    setLastSelectedPath(null);
  };

  useEffect(() => {
    if (path) {
      const name = path.split(/[/\\]/).filter(Boolean).pop() || 'Archive';
      actions.updateWindowTitle(windowId, name);
    } else {
      actions.updateWindowTitle(windowId, 'Archive Viewer');
    }
  }, [path, windowId, actions]);

  const handleArchiveSelect = (newPath: string) => {
    setShowFilePicker(false);
    actions.updateWindowState(windowId, { path: newPath });
  };

  if (!path) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center text-gray-500 bg-[#0d1117]">
        <div className="rounded-full bg-white/5 p-4">
          <FileArchive className="h-10 w-10 text-amber-500/60" />
        </div>
        <div className="space-y-1">
          <h3 className="text-base font-medium text-gray-300">No archive selected</h3>
          <p className="text-sm text-gray-500">Select a ZIP or TAR archive to view its contents.</p>
        </div>
        <button
          onClick={() => setShowFilePicker(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-amber-500/20 px-4 py-2 text-sm font-semibold text-amber-400 border border-amber-500/30 transition-all hover:bg-amber-500/30 active:scale-95"
        >
          <FolderOpen className="h-4 w-4" />
          Open Archive
        </button>
        {showFilePicker && (
          <FolderPicker
            mode="file"
            title="Open Archive"
            extensions={getExtensionsForApp('archive-viewer')}
            onSelect={handleArchiveSelect}
            onCancel={() => setShowFilePicker(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0d1117] text-gray-200 select-none" onClick={() => { setSelected(new Set()); setLastSelectedPath(null); }}>
      {/* Toolbar */}
      <div className="flex flex-col border-b border-white/5 bg-white/[0.02]">
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); setShowFilePicker(true); }}
              className="flex items-center gap-1.5 rounded-md bg-white/5 px-3 py-1 text-xs font-semibold text-gray-300 transition-colors hover:bg-white/10 hover:text-white"
              title="Open different archive"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              Open
            </button>
          </div>
          <div className="flex items-center gap-2">
            {selected.size > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); setShowPicker(true); }}
                disabled={extracting || loading}
                className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors text-xs font-semibold disabled:opacity-50"
              >
                {extracting ? <Loader2 className="w-3 h-3 animate-spin" /> : <PackageOpen className="w-3.5 h-3.5" />}
                Extract Selected ({selected.size})
              </button>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); setSelected(new Set()); setShowPicker(true); }}
              disabled={extracting || loading}
              className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors text-xs font-semibold disabled:opacity-50"
            >
              {extracting ? <Loader2 className="w-3 h-3 animate-spin" /> : <PackageOpen className="w-3.5 h-3.5" />}
              Extract All
            </button>
          </div>
        </div>

        {/* Navigation Bar */}
        <div className="flex items-center gap-1 px-2 py-1.5 bg-black/20 border-t border-white/5 overflow-x-auto no-scrollbar">
          <button 
            onClick={(e) => { e.stopPropagation(); setCurrentDir(''); setSelected(new Set()); setLastSelectedPath(null); }} 
            className={`p-1 rounded hover:bg-white/10 transition-colors ${!currentDir ? 'text-white' : 'text-gray-500'}`}
          >
            <Home className="w-3.5 h-3.5" />
          </button>
          <button 
            onClick={(e) => { e.stopPropagation(); goBack(); }} 
            disabled={!currentDir}
            className="p-1 rounded hover:bg-white/10 disabled:opacity-30 text-gray-400"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
          </button>
          <div className="w-px h-3 bg-white/10 mx-1" />
          <div className="flex items-center gap-1 text-[11px] text-gray-400 whitespace-nowrap">
            <button
              onClick={(e) => { e.stopPropagation(); setCurrentDir(''); setSelected(new Set()); setLastSelectedPath(null); }}
              className="opacity-50 hover:opacity-100 transition-opacity hover:text-white"
            >
              root
            </button>
            {currentDir.split('/').filter(Boolean).map((part, i, parts) => (
              <span key={i} className="flex items-center gap-1">
                <ChevronRight className="w-3 h-3 opacity-30" />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const newDir = parts.slice(0, i + 1).join('/');
                    setCurrentDir(newDir);
                    setSelected(new Set());
                    setLastSelectedPath(null);
                  }}
                  className="text-gray-300 font-medium hover:text-white transition-colors"
                >
                  {part}
                </button>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-2">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-500">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="text-xs font-medium">Analyzing archive...</span>
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm animate-in zoom-in-95">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-px">
            {displayedFiles.map((file, i) => (
              <div 
                key={i} 
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm group cursor-pointer active:scale-[0.98]
                  ${selected.has(file.path) ? 'bg-emerald-500/10 ring-1 ring-emerald-500/30' : 'hover:bg-white/5'}
                `}
                onClick={(e) => handleItemClick(e, file, i)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (file.isDir) {
                    setCurrentDir(file.path);
                    setSelected(new Set());
                    setLastSelectedPath(null);
                  }
                }}
              >
                {file.isDir ? (
                  <FolderOpen className="w-4 h-4 text-amber-400 group-hover:scale-110 transition-transform" />
                ) : (
                  <File className="w-4 h-4 text-gray-400" />
                )}
                <span className={`flex-1 truncate ${file.isDir ? 'font-medium text-gray-200' : 'text-gray-400'}`}>{file.name}</span>
                {!file.isDir && (
                  <span className="text-[10px] text-gray-600 group-hover:text-gray-400 tabular-nums">
                    {formatSize(file.size)}
                  </span>
                )}
                {file.isDir && <ChevronRight className="w-3 h-3 text-gray-700 opacity-0 group-hover:opacity-100 transition-opacity" />}
              </div>
            ))}
            {displayedFiles.length === 0 && (
              <div className="flex flex-col items-center justify-center h-64 text-gray-600 italic text-xs">
                This directory is empty
              </div>
            )}
          </div>
        )}
      </div>

      {/* Picker Modal */}
      {showPicker && (
        <FolderPicker
          initialPath={path ? getParentPath(path) : '~'}
          onSelect={performExtract}
          onCancel={() => setShowPicker(false)}
        />
      )}
      {showFilePicker && (
        <FolderPicker
          mode="file"
          title="Open Archive"
          onSelect={handleArchiveSelect}
          onCancel={() => setShowFilePicker(false)}
        />
      )}
    </div>
  );
}

