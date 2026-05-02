import { useState, useCallback, useEffect, useRef, type ChangeEvent, type FormEvent } from 'react';
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
} from '@/components/ui/context-menu';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { clearBootAuth, hasValidBootAuth, saveBootAuth } from '@/lib/auth';
import { Lock, Loader2, RefreshCw, Upload } from 'lucide-react';

type BootState = 'checking' | 'password' | 'error' | 'ready';

interface SecurityStatus {
  passwordEnabled: boolean;
  loginTtlDays: number;
}

const defaultSecurityStatus: SecurityStatus = {
  passwordEnabled: false,
  loginTtlDays: 7,
};

export default function Desktop() {
  const [windows, actions] = useWindowManager();
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);
  const [startMenuOpen, setStartMenuOpen] = useState(false);
  const [wallpaper, setWallpaper] = useState('/wallpaper.png');
  const [uploading, setUploading] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [showLoader, setShowLoader] = useState(true);
  const [bootState, setBootState] = useState<BootState>('checking');
  const [bootError, setBootError] = useState('');
  const [securityStatus, setSecurityStatus] = useState<SecurityStatus>(defaultSecurityStatus);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const revealTimerRef = useRef<number | null>(null);

  const finishBoot = useCallback(() => {
    setBootState('ready');
    setIsLoaded(true);
    if (revealTimerRef.current !== null) {
      window.clearTimeout(revealTimerRef.current);
    }
    revealTimerRef.current = window.setTimeout(() => {
      setShowLoader(false);
      revealTimerRef.current = null;
    }, 1000);
  }, []);

  const loadBootstrap = useCallback(async () => {
    setBootError('');
    setPasswordError('');
    setPassword('');
    setShowLoader(true);
    setIsLoaded(false);
    setBootState('checking');

    try {
      const [wallpaperResult, securityResult] = await Promise.allSettled([
        fetch('/api/config/wallpaper'),
        fetch('/api/config/security'),
      ]);

      if (wallpaperResult.status === 'fulfilled' && wallpaperResult.value.ok) {
        const wallpaperData = await wallpaperResult.value.json();
        if (wallpaperData.path) setWallpaper(wallpaperData.path);
      }

      if (securityResult.status !== 'fulfilled' || !securityResult.value.ok) {
        throw new Error('Failed to load security config');
      }

      const securityData = (await securityResult.value.json()) as SecurityStatus;
      setSecurityStatus({
        passwordEnabled: Boolean(securityData.passwordEnabled),
        loginTtlDays: Number(securityData.loginTtlDays) > 0 ? Number(securityData.loginTtlDays) : 7,
      });

      if (!securityData.passwordEnabled || hasValidBootAuth()) {
        finishBoot();
        return;
      }

      setBootState('password');
    } catch (err) {
      console.error('Failed to load boot config:', err);
      setBootError('无法加载启动配置，请重试');
      setBootState('error');
    }
  }, [finishBoot]);

  useEffect(() => {
    void loadBootstrap();

    return () => {
      if (revealTimerRef.current !== null) {
        window.clearTimeout(revealTimerRef.current);
      }
    };
  }, [loadBootstrap]);

  const handleWallpaperUpload = async (e: ChangeEvent<HTMLInputElement>) => {
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

  const handlePasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!password.trim()) {
      setPasswordError('请输入密码');
      return;
    }

    setPasswordError('');
    setPasswordSubmitting(true);

    try {
      const res = await fetch('/api/config/security/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (!res.ok) {
        throw new Error('invalid password');
      }

      saveBootAuth();
      setPassword('');
      finishBoot();
    } catch {
      setPasswordError('密码错误，请重试');
    } finally {
      setPasswordSubmitting(false);
    }
  };

  const handleLogout = useCallback(() => {
    if (!securityStatus.passwordEnabled) return;

    clearBootAuth();
    setPassword('');
    setPasswordError('');
    setBootError('');
    setBootState('password');
    setIsLoaded(false);
    setShowLoader(true);
    setStartMenuOpen(false);
  }, [securityStatus.passwordEnabled]);

  const canLogout = securityStatus.passwordEnabled && bootState === 'ready';

  return (
    <div className="relative h-[100dvh] w-screen overflow-hidden bg-[#0a0c12]">
      {showLoader && (
        <div
          className={`absolute inset-0 z-[20000] flex flex-col items-center justify-center gap-8 bg-[#0a0c12] transition-all duration-1000 ease-in-out
            ${isLoaded ? 'pointer-events-none scale-110 opacity-0' : 'scale-100 opacity-100'}`}
        >
          <div className="absolute -left-20 top-1/4 h-80 w-80 rounded-full bg-emerald-500/10 blur-[120px]" />
          <div className="absolute -right-20 bottom-1/4 h-80 w-80 rounded-full bg-blue-500/10 blur-[120px]" />

          <div className="relative z-10 flex flex-col items-center gap-6">
            <div className="relative">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] shadow-2xl backdrop-blur-sm">
                {bootState === 'password' ? (
                  <Lock className="h-8 w-8 text-emerald-400" />
                ) : bootState === 'error' ? (
                  <RefreshCw className="h-8 w-8 text-red-400" />
                ) : (
                  <Loader2 className="h-8 w-8 animate-spin-slow text-emerald-400" />
                )}
              </div>
              <div className="absolute inset-0 rounded-2xl shadow-[0_0_20px_rgba(52,211,153,0.2)]" />
            </div>

            {bootState === 'password' ? (
              <form className="w-[min(92vw,360px)] space-y-4" onSubmit={handlePasswordSubmit}>
                <div className="space-y-2 text-center">
                  <div className="text-lg font-medium tracking-wide text-white">输入开机密码</div>
                  <div className="text-xs text-gray-500">登录后 7 天内刷新无需再次输入</div>
                </div>

                <Input
                  autoFocus
                  type="password"
                  value={password}
                  placeholder="密码"
                  onChange={e => {
                    setPassword(e.target.value);
                    setPasswordError('');
                  }}
                  disabled={passwordSubmitting}
                />

                {passwordError && <div className="text-center text-xs text-red-400">{passwordError}</div>}

                <Button className="w-full" type="submit" disabled={passwordSubmitting}>
                  {passwordSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      验证中
                    </>
                  ) : (
                    '进入系统'
                  )}
                </Button>
              </form>
            ) : bootState === 'error' ? (
              <div className="w-[min(92vw,360px)] space-y-4 text-center">
                <div className="text-lg font-medium text-white">启动失败</div>
                <div className="text-sm text-gray-500">{bootError}</div>
                <Button type="button" variant="outline" className="w-full" onClick={loadBootstrap}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  重试
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <div className="text-white text-lg font-medium tracking-wide animate-pulse">System Loading</div>
                <div className="mt-1 flex gap-1.5">
                  {[0, 1, 2].map(i => (
                    <div
                      key={i}
                      className="h-1.5 w-1.5 animate-bounce rounded-full bg-emerald-400/40"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div
        id="desktop"
        className={`desktop-container relative h-full w-full overflow-hidden select-none transition-all duration-1000 ease-out
          ${isLoaded ? 'scale-100 opacity-100 blur-0' : 'scale-95 opacity-0 blur-md'}`}
        onClick={handleDesktopClick}
      >
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="absolute inset-0 z-0">
              {isVideo(wallpaper) ? (
                <video
                  key={wallpaper}
                  src={wallpaper}
                  autoPlay
                  muted
                  loop
                  playsInline
                  className="absolute inset-0 h-full w-full object-cover transition-opacity duration-700"
                />
              ) : (
                <div
                  className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-all duration-700"
                  style={{ backgroundImage: `url(${wallpaper})` }}
                />
              )}

              <div className="absolute inset-0 bg-black/20" />
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="z-[10002] w-48 border-white/10 text-gray-200 liquid-glass">
            <ContextMenuItem
              className="focus:liquid-glass-active focus:text-white"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              替换壁纸
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>

        <input
          ref={fileInputRef}
          className="hidden"
          type="file"
          accept="image/*,video/*"
          onChange={handleWallpaperUpload}
        />

        <div className="absolute inset-0 bottom-14 z-10 flex flex-col flex-wrap content-start gap-1 p-4 pointer-events-none">
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

        <Taskbar
          windows={windows}
          actions={actions}
          apps={desktopApps}
          onToggleStartMenu={toggleStartMenu}
          startMenuOpen={startMenuOpen}
          onLogout={canLogout ? handleLogout : undefined}
        />
      </div>
    </div>
  );
}
