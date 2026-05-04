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
import { toast } from 'sonner';
import { Lock, Loader2, RefreshCw, Upload, LayoutGrid } from 'lucide-react';

type BootState = 'checking' | 'password' | 'error' | 'ready';

const ICON_POS_KEY = 'desktop:icon-positions';
const DESKTOP_APPS_KEY = 'desktop:visible-apps';
const ICON_VIEWPORT_KEY = 'desktop:viewport-height';
const ICON_COL_W = 104;
const ICON_ROW_H = 96;
const ICON_MARGIN_X = 24;
const ICON_MARGIN_Y = 16;

function loadDesktopAppIds(): string[] | null {
  try {
    const raw = localStorage.getItem(DESKTOP_APPS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* ignore */ }
  return null;
}

function loadIconPositions(): Record<string, { x: number; y: number }> {
  try {
    const raw = localStorage.getItem(ICON_POS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) return parsed;
  } catch { /* ignore */ }
  return {};
}

function defaultIconPosition(index: number, areaHeight: number) {
  const maxRows = Math.max(1, Math.floor((areaHeight - ICON_MARGIN_Y) / ICON_ROW_H));
  const col = Math.floor(index / maxRows);
  const row = index % maxRows;
  return {
    x: ICON_MARGIN_X + col * ICON_COL_W,
    y: ICON_MARGIN_Y + row * ICON_ROW_H,
  };
}

interface SecurityStatus {
  passwordEnabled: boolean;
  authenticated: boolean;
  loginTtlDays: number;
}

const defaultSecurityStatus: SecurityStatus = {
  passwordEnabled: false,
  authenticated: true,
  loginTtlDays: 7,
};

export default function Desktop() {
  const [windows, actions] = useWindowManager();
  const [selectedAppIds, setSelectedAppIds] = useState<Set<string>>(new Set());
  const [startMenuOpen, setStartMenuOpen] = useState(false);
  const [wallpaper, setWallpaper] = useState('/wallpaper.png');
  const [uploading, setUploading] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [showLoader, setShowLoader] = useState(true);
  const [bootState, setBootState] = useState<BootState>('checking');
  const [bootError, setBootError] = useState('');
  const [securityStatus, setSecurityStatus] = useState<SecurityStatus>(defaultSecurityStatus);
  const [password, setPassword] = useState('');
  const [passwordSubmitting, setPasswordSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const revealTimerRef = useRef<number | null>(null);
  const [iconPositions, setIconPositions] = useState<Record<string, { x: number; y: number }>>(loadIconPositions);
  const [iconResetKey, setIconResetKey] = useState(0);
  // Use a stable viewport height for grid calculations.
  // On first render, check localStorage for a previously persisted value.
  // If none, use window.innerHeight and persist it immediately.
  const [viewportHeight] = useState(() => {
    try {
      const stored = localStorage.getItem(ICON_VIEWPORT_KEY);
      if (stored) {
        const n = Number(stored);
        if (n > 0) return n;
      }
    } catch { /* ignore */ }
    const h = window.innerHeight;
    try { localStorage.setItem(ICON_VIEWPORT_KEY, String(h)); } catch { /* ignore */ }
    return h;
  });
  const [desktopAppIds, setDesktopAppIds] = useState<string[]>(() => {
    const saved = loadDesktopAppIds();
    return saved ?? desktopApps.map(a => a.id);
  });
  const [selectionRect, setSelectionRect] = useState<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const selectionRectRef = useRef<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const desktopRef = useRef<HTMLDivElement>(null);

  const toggleDesktopApp = useCallback((appId: string) => {
    setDesktopAppIds(prev => {
      const next = prev.includes(appId) ? prev.filter(id => id !== appId) : [...prev, appId];
      try { localStorage.setItem(DESKTOP_APPS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

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

  const loadWallpaper = useCallback(async () => {
    try {
      const wallpaperResponse = await fetch('/api/config/wallpaper');
      if (!wallpaperResponse.ok) return;
      const wallpaperData = await wallpaperResponse.json();
      if (wallpaperData.path) setWallpaper(wallpaperData.path);
    } catch (err) {
      console.error('Failed to fetch wallpaper:', err);
    }
  }, []);

  const loadBootstrap = useCallback(async () => {
    setBootError('');
    setPassword('');
    setShowLoader(true);
    setIsLoaded(false);
    setBootState('checking');

    try {
      const securityResponse = await fetch('/api/config/security');
      if (!securityResponse.ok) {
        throw new Error('Failed to load security config');
      }

      const securityData = (await securityResponse.json()) as SecurityStatus;
      setSecurityStatus({
        passwordEnabled: Boolean(securityData.passwordEnabled),
        authenticated: Boolean(securityData.authenticated),
        loginTtlDays: Number(securityData.loginTtlDays) > 0 ? Number(securityData.loginTtlDays) : 7,
      });

      if (!securityData.passwordEnabled || securityData.authenticated) {
        await loadWallpaper();
        finishBoot();
        return;
      }

      setBootState('password');
    } catch (err) {
      console.error('Failed to load boot config:', err);
      setBootError('无法加载启动配置，请重试');
      setBootState('error');
    }
  }, [finishBoot, loadWallpaper]);

  useEffect(() => {
    void loadBootstrap();

    return () => {
      if (revealTimerRef.current !== null) {
        window.clearTimeout(revealTimerRef.current);
      }
    };
  }, [loadBootstrap]);

  // Compute positions inline — stable because inputs (iconPositions, desktopAppIds) only change on drag/toggle.
  const resolvedPositions: Record<string, { x: number; y: number }> = {};
  let vi = 0;
  desktopApps.forEach((app) => {
    if (!desktopAppIds.includes(app.id)) return;
    resolvedPositions[app.id] = iconPositions[app.id] ?? defaultIconPosition(vi, viewportHeight - 120);
    vi++;
  });

  useEffect(() => {
    if (!startMenuOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setStartMenuOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [startMenuOpen]);

  useEffect(() => {
    if (selectedAppIds.size === 0) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete') {
        selectedAppIds.forEach(id => toggleDesktopApp(id));
        setSelectedAppIds(new Set());
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedAppIds, toggleDesktopApp]);

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

  const justFinishedDragRef = useRef(false);

  const handleDesktopClick = useCallback(() => {
    if (justFinishedDragRef.current) {
      justFinishedDragRef.current = false;
      return;
    }
    setSelectedAppIds(new Set());
    setStartMenuOpen(false);
  }, []);

  // Rubber band selection via window-level capture-phase listeners.
  // Using capture phase to intercept before react-rnd's internal drag handlers.
  useEffect(() => {
    const desktopEl = desktopRef.current;
    if (!desktopEl) return;

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      // Only allow selection on the desktop background (inside #icon-area but not on an icon)
      const iconArea = document.getElementById('icon-area');
      if (!iconArea || !iconArea.contains(target)) return;
      if (target.closest('[data-app-id]')) return;
      // Clear any lingering selection
      selectionRectRef.current = null;
      setSelectionRect(null);
      isDraggingRef.current = false;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
        isDraggingRef.current = true;
        const rect = {
          startX: dragStartRef.current.x,
          startY: dragStartRef.current.y,
          endX: e.clientX,
          endY: e.clientY,
        };
        selectionRectRef.current = rect;
        setSelectionRect(rect);
      }
    };

    const handleMouseUp = () => {
      if (!isDraggingRef.current || !selectionRectRef.current) {
        dragStartRef.current = null;
        return;
      }
      isDraggingRef.current = false;
      justFinishedDragRef.current = true;
      dragStartRef.current = null;

      const rect = selectionRectRef.current;
      selectionRectRef.current = null;
      setSelectionRect(null);

      const left = Math.min(rect.startX, rect.endX);
      const top = Math.min(rect.startY, rect.endY);
      const right = Math.max(rect.startX, rect.endX);
      const bottom = Math.max(rect.startY, rect.endY);

      const selected = new Set<string>();
      desktopEl.querySelectorAll<HTMLElement>('[data-app-id]').forEach(el => {
        const btn = el.querySelector('button');
        const r = (btn || el).getBoundingClientRect();
        if (r.left < right && r.right > left && r.top < bottom && r.bottom > top) {
          selected.add(el.getAttribute('data-app-id')!);
        }
      });
      if (selected.size > 0) {
        setSelectedAppIds(prev => {
          const next = new Set(prev);
          selected.forEach(id => next.add(id));
          return next;
        });
      }
    };

    window.addEventListener('mousedown', handleMouseDown, true);
    window.addEventListener('mousemove', handleMouseMove, true);
    window.addEventListener('mouseup', handleMouseUp, true);

    return () => {
      window.removeEventListener('mousedown', handleMouseDown, true);
      window.removeEventListener('mousemove', handleMouseMove, true);
      window.removeEventListener('mouseup', handleMouseUp, true);
    };
  }, []);

  const handleIconDragStop = useCallback((appId: string, x: number, y: number) => {
    // Clamp so the icon stays within the desktop area (accounting for taskbar).
    const ICON_W = 88;
    const ICON_H = 100;
    const BOTTOM_MARGIN = 120;
    const clampedX = Math.max(0, Math.min(x, window.innerWidth - ICON_W));
    const clampedY = Math.max(0, Math.min(y, window.innerHeight - BOTTOM_MARGIN - ICON_H));
    setIconPositions(prev => {
      const next = { ...prev, [appId]: { x: clampedX, y: clampedY } };
      try { localStorage.setItem(ICON_POS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const organizeDesktop = useCallback(() => {
    // Check if any icon has a saved position that differs from its default grid position.
    // Undefined saved position means the icon is already at its default — no reset needed.
    const areaH = viewportHeight - 120;
    let vi = 0;
    let needsReset = false;
    desktopApps.forEach((app) => {
      if (!desktopAppIds.includes(app.id)) return;
      const saved = iconPositions[app.id];
      if (saved) {
        const def = defaultIconPosition(vi, areaH);
        if (saved.x !== def.x || saved.y !== def.y) {
          needsReset = true;
        }
      }
      vi++;
    });

    setIconPositions({});
    try { localStorage.removeItem(ICON_POS_KEY); } catch { /* ignore */ }
    if (needsReset) setIconResetKey(k => k + 1);
    toast.success('桌面已整理');
  }, [iconPositions, desktopAppIds]);




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
      toast.error('请输入密码');
      return;
    }

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

      setPassword('');
      setSecurityStatus(prev => ({ ...prev, passwordEnabled: true, authenticated: true }));
      await loadWallpaper();
      finishBoot();
    } catch {
      toast.error('密码错误，请重试');
    } finally {
      setPasswordSubmitting(false);
    }
  };

  const handleLogout = useCallback(() => {
    if (!securityStatus.passwordEnabled) return;

    void fetch('/api/config/security/logout', { method: 'POST' }).catch(() => {});
    if (revealTimerRef.current !== null) {
      window.clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
    setPassword('');
    setBootError('');
    setSecurityStatus(prev => ({ ...prev, authenticated: false }));
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
                  <div className="text-lg font-medium tracking-wide text-white">输入密码</div>
                  <div className="text-xs text-gray-500">登录后 7 天内刷新无需再次输入</div>
                </div>

                <Input
                  autoFocus
                  type="password"
                  value={password}
                  placeholder="密码"
                  onChange={e => setPassword(e.target.value)}
                  disabled={passwordSubmitting}
                />

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
        ref={desktopRef}
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
              onClick={organizeDesktop}
            >
              <LayoutGrid className="mr-2 h-4 w-4" />
              整理桌面
            </ContextMenuItem>
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

        <div id="icon-area" className="absolute inset-0 bottom-[120px] z-10 pointer-events-none">
          {desktopApps.filter(a => desktopAppIds.includes(a.id)).map(app => {
            const pos = resolvedPositions[app.id];
            return (
              <div key={`${app.id}-${iconResetKey}`} className="pointer-events-auto" data-app-id={app.id}>
                <DesktopIcon
                  app={app}
                  isSelected={selectedAppIds.has(app.id)}
                  defaultPosition={pos}
                  rndKey={`${app.id}-${iconResetKey}-${pos.x}-${pos.y}`}
                  onSelect={(e) => {
                    if (e?.shiftKey || e?.ctrlKey || e?.metaKey) {
                      setSelectedAppIds(prev => {
                        const next = new Set(prev);
                        if (next.has(app.id)) next.delete(app.id); else next.add(app.id);
                        return next;
                      });
                    } else {
                      setSelectedAppIds(new Set([app.id]));
                    }
                  }}
                  onOpen={() => {
                    actions.openWindow(app);
                    setSelectedAppIds(new Set());
                  }}
                  onDragStop={(x, y) => handleIconDragStop(app.id, x, y)}
                  onRemove={() => toggleDesktopApp(app.id)}
                />
              </div>
            );
          })}
        </div>

        {selectionRect && (
          <div
            className="pointer-events-none z-[10001] fixed border border-emerald-400/60 bg-emerald-400/10"
            style={{
              left: Math.min(selectionRect.startX, selectionRect.endX),
              top: Math.min(selectionRect.startY, selectionRect.endY),
              width: Math.abs(selectionRect.endX - selectionRect.startX),
              height: Math.abs(selectionRect.endY - selectionRect.startY),
            }}
          />
        )}

        <div className="absolute inset-0 bottom-[120px] z-20 pointer-events-none">
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
          desktopAppIds={desktopAppIds}
          onToggleDesktopApp={toggleDesktopApp}
          onToggleStartMenu={toggleStartMenu}
          startMenuOpen={startMenuOpen}
          onLogout={canLogout ? handleLogout : undefined}
        />
      </div>
    </div>
  );
}
