import { useState, useEffect } from 'react';
import { Download, ZoomIn, ZoomOut, Maximize2, RotateCw, ExternalLink, FolderOpen, FileImage } from 'lucide-react';
import type { AppComponentProps } from '@/types/desktop';
import FolderPicker from '../FolderPicker';
import { getExtensionsForApp } from '@/lib/fileAssociations';

export default function MediaViewer({ windowId, actions, appState }: AppComponentProps) {
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const path = appState?.path || '';
  const fileName = path.split(/[/\\]/).filter(Boolean).pop() || '';
  const mediaUrl = path ? `/api/files/content?path=${encodeURIComponent(path)}` : '';
  
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'm4v'];
  const isVideo = videoExts.includes(ext);

  useEffect(() => {
    setScale(1);
    setRotation(0);
  }, [path]);

  const handleZoomIn = () => setScale(s => Math.min(s + 0.25, 4));
  const handleZoomOut = () => setScale(s => Math.max(s - 0.25, 0.25));
  const handleRotate = () => setRotation(r => (r + 90) % 360);

  useEffect(() => {
    if (path) {
      actions.updateWindowTitle(windowId, fileName);
    } else {
      actions.updateWindowTitle(windowId, 'Media Viewer');
    }
  }, [path, fileName, windowId, actions]);

  const handleFileSelect = (newPath: string) => {
    setShowFilePicker(false);
    actions.updateWindowState(windowId, { path: newPath });
  };

  if (!path) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center text-gray-500 bg-[#0d1117]">
        <div className="rounded-full bg-white/5 p-4">
          <FileImage className="h-10 w-10 text-purple-500/60" />
        </div>
        <div className="space-y-1">
          <h3 className="text-base font-medium text-gray-300">No media selected</h3>
          <p className="text-sm text-gray-500">Pick an image or video to view it here.</p>
        </div>
        <button
          onClick={() => setShowFilePicker(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-purple-500/20 px-4 py-2 text-sm font-semibold text-purple-400 border border-purple-500/30 transition-all hover:bg-purple-500/30 active:scale-95"
        >
          <FolderOpen className="h-4 w-4" />
          Select Media
        </button>
        {showFilePicker && (
          <FolderPicker
            mode="file"
            title="Open Media"
            extensions={getExtensionsForApp('image-viewer')}
            onSelect={handleFileSelect}
            onCancel={() => setShowFilePicker(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0d1117] text-gray-200 select-none">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 bg-white/[0.02]">
        <button
          onClick={() => setShowFilePicker(true)}
          className="inline-flex items-center gap-2 rounded-md bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-white/10 hover:text-white"
          title="Open File"
        >
          <FolderOpen className="w-4 h-4" />
          Open
        </button>
        <div className="flex items-center gap-1">
          {!isVideo && (
            <>
              <ToolbarBtn onClick={handleZoomOut} title="Zoom Out">
                <ZoomOut className="w-4 h-4" />
              </ToolbarBtn>
              <div className="text-xs font-mono w-12 text-center text-gray-500">
                {Math.round(scale * 100)}%
              </div>
              <ToolbarBtn onClick={handleZoomIn} title="Zoom In">
                <ZoomIn className="w-4 h-4" />
              </ToolbarBtn>
              <div className="w-px h-4 bg-white/10 mx-1" />
              <ToolbarBtn onClick={handleRotate} title="Rotate">
                <RotateCw className="w-4 h-4" />
              </ToolbarBtn>
              <ToolbarBtn onClick={() => setScale(1)} title="Actual Size">
                <Maximize2 className="w-4 h-4" />
              </ToolbarBtn>
              <div className="w-px h-4 bg-white/10 mx-1" />
            </>
          )}
          <ToolbarBtn onClick={() => window.open(mediaUrl, '_blank')} title="Open in new tab">
            <ExternalLink className="w-4 h-4" />
          </ToolbarBtn>
          <a 
            href={mediaUrl} 
            download={fileName}
            className="p-1.5 rounded-md text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
            title="Download"
          >
            <Download className="w-4 h-4" />
          </a>
        </div>
      </div>

      {/* Media Container */}
      <div className="flex-1 overflow-auto flex items-center justify-center p-4 bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAuSURBVHgB7YwxCgAwDANX9f8/u7Z069Ah6BaSBeIBYg4G1E98mXvK/6p3vIu4A+mHAbpSAtKNAAAAAElFTkSuQmCC')] bg-repeat">
        {isVideo ? (
          <video 
            src={mediaUrl} 
            controls 
            autoPlay
            className="max-w-full max-h-full rounded-sm shadow-2xl bg-black"
          />
        ) : (
          <div 
            className="transition-transform duration-200 ease-out shadow-2xl flex items-center justify-center max-w-full max-h-full"
            style={{ 
              transform: `scale(${scale}) rotate(${rotation}deg)`,
            }}
          >
            <img 
              src={mediaUrl} 
              alt="Preview" 
              className="max-w-full max-h-full object-contain rounded-sm bg-white"
              onDragStart={e => e.preventDefault()}
            />
          </div>
        )}
      </div>
      {showFilePicker && (
        <FolderPicker
          mode="file"
          title="Open Media"
          onSelect={handleFileSelect}
          onCancel={() => setShowFilePicker(false)}
        />
      )}
    </div>
  );
}

function ToolbarBtn({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button
      className="p-1.5 rounded-md text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
      onClick={onClick}
      title={title}
    >
      {children}
    </button>
  );
}
