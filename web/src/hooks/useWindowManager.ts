import { useState, useCallback, useEffect, useMemo } from 'react';
import type { WindowState, DesktopApp, WindowManagerActions } from '@/types/desktop';
import { getTaskbarReservedHeight } from '@/lib/window-layout';

let nextZIndex = 100;

const WINDOW_MARGIN = 16;
const STORAGE_KEY = 'desktop:windows';

function getViewportBounds() {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const taskbarHeight = getTaskbarReservedHeight(viewportWidth);
  const availableWidth = Math.max(280, viewportWidth - WINDOW_MARGIN * 2);
  const availableHeight = Math.max(220, viewportHeight - taskbarHeight - WINDOW_MARGIN * 2);

  return {
    viewportWidth,
    viewportHeight,
    availableWidth,
    availableHeight,
  };
}

function loadPersistedWindows(): WindowState[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((w): w is WindowState =>
      !!w && typeof (w as WindowState).id === 'string' && typeof (w as WindowState).appId === 'string'
    );
  } catch {
    return [];
  }
}

export function useWindowManager(): [WindowState[], WindowManagerActions] {
  const [windows, setWindows] = useState<WindowState[]>(() => {
    const persisted = loadPersistedWindows();
    if (persisted.length > 0) {
      // Resume above any z-index seen in the saved layout.
      nextZIndex = Math.max(nextZIndex, ...persisted.map(w => w.zIndex)) + 1;
    }
    return persisted;
  });

  // Persist on every change so refresh restores the same windows (with stable
  // ids), letting per-window state like terminal sessions reattach.
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(windows));
    } catch {
      /* sessionStorage may be full; ignore */
    }
  }, [windows]);

  const openWindow = useCallback((app: DesktopApp, state?: any) => {
    setWindows(prev => {
      // Single-instance apps reuse the existing window.
      if (!app.multiInstance) {
        const existing = prev.find(w => w.appId === app.id);
        if (existing) {
          return prev.map(w => ({
            ...w,
            isFocused: w.id === existing.id,
            isMinimized: w.id === existing.id ? false : w.isMinimized,
            zIndex: w.id === existing.id ? ++nextZIndex : w.zIndex,
          }));
        }
      }

      const { viewportWidth, availableWidth, availableHeight } = getViewportBounds();
      const taskbarHeight = getTaskbarReservedHeight(viewportWidth);
      const width = Math.min(app.defaultWidth ?? Math.min(900, window.innerWidth * 0.65), availableWidth);
      const height = Math.min(app.defaultHeight ?? Math.min(600, window.innerHeight * 0.65), availableHeight);
      const minWidth = Math.min(420, availableWidth);
      const minHeight = Math.min(300, availableHeight);
      const offset = (prev.length * 32) % 160;
      const maxX = Math.max(WINDOW_MARGIN, viewportWidth - width - WINDOW_MARGIN);
      const maxY = Math.max(WINDOW_MARGIN, window.innerHeight - taskbarHeight - height - WINDOW_MARGIN);
      const x = Math.min(Math.max(WINDOW_MARGIN, (viewportWidth - width) / 2 + offset), maxX);
      const y = Math.min(Math.max(WINDOW_MARGIN, (availableHeight - height) / 2 + offset), maxY);

      // Number additional instances so users can tell them apart in the taskbar.
      let title = app.name;
      if (app.multiInstance) {
        const sameAppCount = prev.filter(w => w.appId === app.id).length;
        if (sameAppCount > 0) title = `${app.name} ${sameAppCount + 1}`;
      }

      const newWindow: WindowState = {
        id: `window-${app.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title,
        icon: app.icon,
        x, y, width, height,
        minWidth,
        minHeight,
        isMinimized: false,
        isMaximized: false,
        isFocused: true,
        zIndex: ++nextZIndex,
        appId: app.id,
        state,
      };

      return [
        ...prev.map(w => ({ ...w, isFocused: false })),
        newWindow,
      ];
    });
  }, []);

  const closeWindow = useCallback((id: string) => {
    setWindows(prev => prev.filter(w => w.id !== id));
  }, []);

  const minimizeWindow = useCallback((id: string) => {
    setWindows(prev => prev.map(w =>
      w.id === id
        ? { ...w, isMinimized: true, isFocused: false }
        : w
    ));
  }, []);

  const maximizeWindow = useCallback((id: string) => {
    setWindows(prev => prev.map(w =>
      w.id === id
        ? { ...w, isMaximized: !w.isMaximized, isFocused: true, zIndex: ++nextZIndex }
        : { ...w, isFocused: false }
    ));
  }, []);

  const focusWindow = useCallback((id: string) => {
    setWindows(prev => prev.map(w => ({
      ...w,
      isFocused: w.id === id,
      isMinimized: w.id === id ? false : w.isMinimized,
      zIndex: w.id === id ? ++nextZIndex : w.zIndex,
    })));
  }, []);

  const updateWindowPosition = useCallback((id: string, x: number, y: number) => {
    setWindows(prev => prev.map(w =>
      w.id === id
        ? {
            ...w,
            x: Math.min(Math.max(0, x), Math.max(0, window.innerWidth - w.width)),
            y: Math.min(Math.max(0, y), Math.max(0, window.innerHeight - getTaskbarReservedHeight(window.innerWidth) - w.height)),
          }
        : w
    ));
  }, []);

  const updateWindowSize = useCallback((id: string, width: number, height: number, x?: number, y?: number) => {
    setWindows(prev => prev.map(w =>
      w.id === id
        ? (() => {
            const { availableWidth, availableHeight } = getViewportBounds();
            const nextWidth = Math.min(Math.max(w.minWidth, width), availableWidth);
            const nextHeight = Math.min(Math.max(w.minHeight, height), availableHeight);
            const nextX = x !== undefined
              ? Math.min(Math.max(0, x), Math.max(0, window.innerWidth - nextWidth))
              : w.x;
            const nextY = y !== undefined
              ? Math.min(Math.max(0, y), Math.max(0, window.innerHeight - getTaskbarReservedHeight(window.innerWidth) - nextHeight))
              : w.y;

            return {
              ...w,
              width: nextWidth,
              height: nextHeight,
              x: nextX,
              y: nextY,
            };
          })()
        : w
    ));
  }, []);

  const updateWindowState = useCallback((id: string, state: any) => {
    setWindows(prev => prev.map(w =>
      w.id === id ? { ...w, state: typeof state === 'function' ? state(w.state) : state } : w
    ));
  }, []);

  const updateWindowTitle = useCallback((id: string, title: string) => {
    setWindows(prev => prev.map(w =>
      w.id === id ? { ...w, title } : w
    ));
  }, []);

  const updateWindowIcon = useCallback((id: string, icon: string) => {
    setWindows(prev => prev.map(w =>
      w.id === id ? { ...w, icon } : w
    ));
  }, []);

  const actions = useMemo(() => ({
    openWindow,
    closeWindow,
    minimizeWindow,
    maximizeWindow,
    focusWindow,
    updateWindowPosition,
    updateWindowSize,
    updateWindowState,
    updateWindowTitle,
    updateWindowIcon,
  }), [
    openWindow,
    closeWindow,
    minimizeWindow,
    maximizeWindow,
    focusWindow,
    updateWindowPosition,
    updateWindowSize,
    updateWindowState,
    updateWindowTitle,
    updateWindowIcon,
  ]);

  return [windows, actions];
}
