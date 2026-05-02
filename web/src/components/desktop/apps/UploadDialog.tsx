import { useRef, useState } from 'react';
import {
  Upload, X, File, Globe, CheckCircle2,
  AlertCircle, Loader2, Plus, Play
} from 'lucide-react';
import { Button } from '../../ui/button';
import { toast } from 'sonner';
import { formatSize } from '@/lib/utils';

interface UploadItem {
  id: string;
  name: string;
  type: 'file' | 'url';
  file?: File;
  url?: string;
  progress: number;
  status: 'pending' | 'uploading' | 'completed' | 'error';
  error?: string;
}

interface UploadDialogProps {
  currentPath: string;
  initialFiles?: File[];
  onClose: () => void;
  onComplete: () => void;
}

function createFileUploadItem(file: File): UploadItem {
  return {
    id: Math.random().toString(36).substring(2, 11),
    name: file.name,
    type: 'file',
    file,
    progress: 0,
    status: 'pending',
  };
}

export default function UploadDialog({ currentPath, initialFiles = [], onClose, onComplete }: UploadDialogProps) {
  const [items, setItems] = useState<UploadItem[]>(() => initialFiles.map(createFileUploadItem));
  const [urlInput, setUrlInput] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = (fileList: FileList | File[]) => {
    const newItems = Array.from(fileList).map(createFileUploadItem);
    setItems(prev => [...prev, ...newItems]);
  };

  const addUrl = () => {
    if (!urlInput.trim()) return;
    let name = 'downloaded_file';
    try {
      const url = new URL(urlInput);
      name = url.pathname.split('/').pop() || 'downloaded_file';
    } catch (e) {
      toast.error('Invalid URL');
      return;
    }

    const newItem: UploadItem = {
      id: Math.random().toString(36).substring(2, 11),
      name,
      type: 'url',
      url: urlInput,
      progress: 0,
      status: 'pending'
    };
    setItems(prev => [...prev, newItem]);
    setUrlInput('');
  };

  const removeItem = (id: string) => {
    setItems(prev => prev.filter(item => item.id !== id));
  };

  const uploadFile = async (item: UploadItem) => {
    if (item.type === 'file' && item.file) {
      return new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const formData = new FormData();
        formData.append('path', currentPath);
        formData.append('files', item.file!);

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const progress = Math.round((e.loaded / e.total) * 100);
            setItems(prev => prev.map(it => it.id === item.id ? { ...it, progress } : it));
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            setItems(prev => prev.map(it => it.id === item.id ? { ...it, status: 'completed', progress: 100 } : it));
            resolve();
          } else {
            const error = `Failed (${xhr.status})`;
            setItems(prev => prev.map(it => it.id === item.id ? { ...it, status: 'error', error } : it));
            reject(new Error(error));
          }
        });

        xhr.addEventListener('error', () => {
          const error = 'Network error';
          setItems(prev => prev.map(it => it.id === item.id ? { ...it, status: 'error', error } : it));
          reject(new Error(error));
        });

        setItems(prev => prev.map(it => it.id === item.id ? { ...it, status: 'uploading' } : it));
        xhr.open('POST', '/api/files/upload');
        xhr.send(formData);
      });
    } else if (item.type === 'url' && item.url) {
      setItems(prev => prev.map(it => it.id === item.id ? { ...it, status: 'uploading', progress: 50 } : it));
      try {
        const res = await fetch('/api/files/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: currentPath, url: item.url })
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        setItems(prev => prev.map(it => it.id === item.id ? { ...it, status: 'completed', progress: 100 } : it));
      } catch (e) {
        const error = (e as Error).message;
        setItems(prev => prev.map(it => it.id === item.id ? { ...it, status: 'error', error } : it));
        throw e;
      }
    }
  };

  const startUploadAll = async () => {
    const pending = items.filter(it => it.status === 'pending' || it.status === 'error');
    if (pending.length === 0) return;

    setIsUploading(true);
    let successCount = 0;

    for (const item of pending) {
      try {
        await uploadFile(item);
        successCount++;
      } catch (e) {
        console.error('Upload error:', e);
      }
    }

    setIsUploading(false);
    if (successCount > 0) {
      onComplete();
      toast.success(`Successfully uploaded ${successCount} items`);
    }
  };

  const clearCompleted = () => {
    setItems(prev => prev.filter(it => it.status !== 'completed'));
  };

  return (
    <div className="fixed inset-0 z-[20000] flex items-start justify-center overflow-y-auto bg-black/60 p-3 backdrop-blur-sm animate-in fade-in duration-200 sm:items-center sm:p-4">
      <div className="my-auto flex w-full max-w-[600px] min-h-0 max-h-[calc(100dvh-1.5rem)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#161b22] shadow-2xl sm:max-h-[80vh]">
        {/* Header */}
        <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
          <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
            <Upload className="w-4 h-4 text-blue-400" />
            Upload Files
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-md transition-colors">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* URL Input & Local File Trigger */}
        <div className="p-4 border-b border-white/5 flex flex-col gap-3 bg-white/[0.01]">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                className="w-full bg-black/40 border border-white/10 rounded-lg pl-10 pr-3 py-2 text-sm text-white outline-none focus:border-blue-500/50"
                placeholder="Paste URL here..."
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addUrl()}
              />
            </div>
            <Button onClick={addUrl} variant="secondary" className="px-4 sm:self-auto">
              <Plus className="w-4 h-4 mr-2" /> Add URL
            </Button>
          </div>

          <div 
            className="border-2 border-dashed border-white/10 rounded-xl p-4 sm:p-6 flex flex-col items-center justify-center gap-2 hover:border-blue-500/30 hover:bg-blue-500/5 transition-all cursor-pointer group"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={e => {
              e.preventDefault();
              e.stopPropagation();
              if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
            }}
          >
            <div className="p-3 rounded-full bg-blue-500/10 text-blue-400 group-hover:scale-110 transition-transform">
              <Upload className="w-6 h-6" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-gray-300">Click or drag files here to upload</p>
              <p className="text-xs text-gray-500">Supports multiple files</p>
            </div>
            <input
              type="file"
              multiple
              className="hidden"
              ref={fileInputRef}
              onChange={e => {
                if (e.target.files) {
                  addFiles(e.target.files);
                }
                e.target.value = '';
              }}
            />
          </div>
        </div>

        {/* List */}
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {items.length === 0 ? (
            <div className="flex min-h-[160px] h-full flex-col items-center justify-center py-10 text-gray-500">
              <File className="w-12 h-12 opacity-20 mb-2" />
              <p className="text-sm">No files in queue</p>
            </div>
          ) : (
            <div className="space-y-1">
              {items.map((item) => (
                <div key={item.id} className="bg-white/5 rounded-lg p-3 group relative overflow-hidden">
                  <div className="flex items-center gap-3 relative z-10">
                    <div className={`p-2 rounded-lg ${item.type === 'url' ? 'bg-purple-500/10 text-purple-400' : 'bg-blue-500/10 text-blue-400'}`}>
                      {item.type === 'url' ? <Globe className="w-4 h-4" /> : <File className="w-4 h-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1 gap-2">
                        <div className="flex items-baseline gap-2 min-w-0">
                          <span className="text-sm font-medium text-gray-200 truncate">{item.name}</span>
                          {item.type === 'file' && item.file && (
                            <span className="text-xs text-gray-500 shrink-0">{formatSize(item.file.size)}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {item.status === 'uploading' && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />}
                          {item.status === 'completed' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                          {item.status === 'error' && <AlertCircle className="w-3.5 h-3.5 text-red-400" />}
                          <button 
                            onClick={() => removeItem(item.id)}
                            disabled={item.status === 'uploading'}
                            className="text-gray-500 hover:text-red-400 transition-colors disabled:opacity-0"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="h-1.5 bg-black/40 rounded-full overflow-hidden">
                        <div 
                          className={`h-full transition-all duration-300 ${
                            item.status === 'error' ? 'bg-red-500' : 
                            item.status === 'completed' ? 'bg-emerald-500' : 'bg-blue-500'
                          }`}
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                      {item.status === 'error' && (
                        <p className="text-[10px] text-red-400 mt-1 truncate">{item.error}</p>
                      )}
                    </div>
                  </div>
                  {/* Progress background */}
                  {item.status === 'uploading' && (
                    <div 
                      className="absolute inset-0 bg-blue-500/5 transition-all duration-300"
                      style={{ width: `${item.progress}%` }}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-3 border-t border-white/5 bg-white/[0.02] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-gray-500">
            {items.length} items in queue
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            {items.some(it => it.status === 'completed') && (
              <Button onClick={clearCompleted} variant="ghost" className="text-xs sm:w-auto">
                Clear Completed
              </Button>
            )}
            <Button
              onClick={startUploadAll}
              disabled={isUploading || items.length === 0 || items.every(it => it.status === 'completed')}
              className="min-w-[120px] bg-blue-600 text-white hover:bg-blue-700 sm:w-auto"
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  Start Upload
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
