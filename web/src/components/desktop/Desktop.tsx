import { useState, useCallback, useEffect, useRef } from 'react';
import { useWindowManager } from '@/hooks/useWindowManager';
import { desktopApps } from '@/config/apps';
import DesktopIcon from './DesktopIcon';
import Window from './Window';
import Taskbar from './Taskbar';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Upload, Loader2 } from 'lucide-react';

export default function Desktop() {
  const [windows, actions] = useWindowManager();
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [startMenuOpen, setStartMenuOpen] = useState(false);
  const [wallpaper, setWallpaper] = useState('/wallpaper.png');
  const [uploading, setUploading] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [showLoader, setShowLoader] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/config/wallpaper')
      .then(res => res.json())
      .then(data => {
        if (data.path) setWallpaper(data.path);
      })
      .catch(err => console.error('Failed to fetch wallpaper:', err))
      .finally(() => {
        // Start showing the desktop
        setIsLoaded(true);
        // Remove loader from DOM after transition completes
        setTimeout(() => setShowLoader(false), 1000);
      });
  }, []);

  const handleWallpaperUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('wallpaper', file);

    try {
      const res = await fetch('/api/config/wallpaper', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      setWallpaper(data.path);
    } catch (err) {
      console.error('Wallpaper upload error:', err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDesktopClick = useCallback(() => {
    setSelectedAppId(null);
    setStartMenuOpen(false);
  }, []);

  const isVideo = (path: string) => {
    const videoExtensions = ['.mp4', '.webm', '.ogg', '.mov'];
    return videoExtensions.some(ext => path.toLowerCase().endsWith(ext));
  };

  const toggleStartMenu = useCallback(() => {
    setStartMenuOpen(prev => !prev);
  }, []);

  return (
    <div className="relative w-screen h-[100dvh] overflow-hidden bg-[#0a0c12]">
      {/* Loading Overlay */}
      {showLoader && (
        <div 
          className={`absolute inset-0 z-[20000] flex flex-col items-center justify-center gap-8 bg-[#0a0c12] transition-all duration-1000 ease-in-out
            ${isLoaded ? 'opacity-0 scale-110 pointer-events-none' : 'opacity-100 scale-100'}`}
        >
          {/* Background Decorative Blurs */}
          <div className="absolute top-1/4 -left-20 w-80 h-80 bg-emerald-500/10 blur-[120px] rounded-full" />
          <div className="absolute bottom-1/4 -right-20 w-80 h-80 bg-blue-500/10 blur-[120px] rounded-full" />
          
          <div className="relative flex flex-col items-center gap-6 z-10">
            <div className="relative">
              <div className="w-16 h-16 rounded-2xl bg-white/[0.03] border border-white/10 flex items-center justify-center backdrop-blur-sm shadow-2xl">
                <Loader2 className="w-8 h-8 text-emerald-400 animate-spin-slow" />
              </div>
              <div className="absolute inset-0 rounded-2xl shadow-[0_0_20px_rgba(52,211,153,0.2)]" />
            </div>
            
            <div className="flex flex-col items-center gap-2">
              <div className="text-white text-lg font-medium tracking-wide animate-pulse">
                System Loading
              </div>
              <div className="flex gap-1.5 mt-1">
                {[0, 1, 2].map(i => (
                  <div 
                    key={i} 
                    className="w-1.5 h-1.5 rounded-full bg-emerald-400/40 animate-bounce" 
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Desktop Content */}
      <div 
        id="desktop"
        className={`desktop-container relative w-full h-full overflow-hidden select-none transition-all duration-1000 ease-out
          ${isLoaded ? 'opacity-100 scale-100 blur-0' : 'opacity-0 scale-95 blur-md'}`}
        onClick={handleDesktopClick}
      >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="absolute inset-0 z-0">
            {/* Wallpaper */}
            {isVideo(wallpaper) ? (
              <video
                key={wallpaper}
                src={wallpaper}
                autoPlay
                muted
                loop
                playsInline
                className="absolute inset-0 w-full h-full object-cover transition-opacity duration-700"
              />
            ) : (
              <div
                className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-all duration-700"
                style={{ backgroundImage: `url(${wallpaper})` }}
              />
            )}

            {/* Wallpaper overlay for consistent tint */}
            <div className="absolute inset-0 bg-black/20" />
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48 z-[10002] liquid-glass text-gray-200 border-white/10">
          <ContextMenuItem className="focus:liquid-glass-active focus:text-white" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Upload className="w-4 h-4 mr-2" />
            )}
            更换壁纸
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Hidden file input for wallpaper */}
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept="image/*,video/*"
        onChange={handleWallpaperUpload}
      />

      {/* Desktop icons */}
      <div className="absolute inset-0 bottom-14 p-4 flex flex-col flex-wrap content-start gap-1 z-10 pointer-events-none">
        {desktopApps.map(app => (
          <div key={app.id} className="pointer-events-auto">
            <DesktopIcon
              app={app}
              isSelected={selectedAppId === app.id}
              onSelect={() => setSelectedAppId(app.id)}
              onOpen={() => {
                actions.openWindow(app);
                setSelectedAppId(null);
              }}
            />
          </div>
        ))}
      </div>

      {/* Windows layer */}
      <div className="absolute inset-0 bottom-14 z-20 pointer-events-none">
        {windows.map(win => {
          const app = desktopApps.find(a => a.id === win.appId);
          if (!app) return null;
          const AppComponent = app.component;

          return (
            <div key={win.id} className="pointer-events-auto" style={{ display: win.isMinimized ? 'none' : 'contents' }}>
              <Window windowState={win} actions={actions}>
                <AppComponent windowId={win.id} actions={actions} appState={win.state} />
              </Window>
            </div>
          );
        })}
      </div>



      {/* Taskbar */}
      <Taskbar
        windows={windows}
        actions={actions}
        apps={desktopApps}
        onToggleStartMenu={toggleStartMenu}
        startMenuOpen={startMenuOpen}
      />
      </div>
    </div>
  );
}
