import type { ComponentType } from 'react';

export interface WindowState {
  id: string;
  title: string;
  icon: string;
  x: number;
  y: number;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  isMinimized: boolean;
  isMaximized: boolean;
  isFocused: boolean;
  zIndex: number;
  appId: string;
  state?: any;
}

export interface DesktopApp {
  id: string;
  name: string;
  icon: string;
  component: ComponentType<AppComponentProps>;
  defaultWidth?: number;
  defaultHeight?: number;
  // When true, opening the app always spawns a new window; otherwise an
  // existing window for the same app is focused/restored instead.
  multiInstance?: boolean;
}

export interface AppComponentProps {
  windowId: string;
  actions: WindowManagerActions;
  appState?: any;
}

export interface WindowManagerActions {
  openWindow: (app: DesktopApp, state?: any) => void;
  closeWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  maximizeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  updateWindowPosition: (id: string, x: number, y: number) => void;
  updateWindowSize: (id: string, width: number, height: number, x?: number, y?: number) => void;
  updateWindowState: (id: string, state: any) => void;
  updateWindowTitle: (id: string, title: string) => void;
  updateWindowIcon: (id: string, icon: string) => void;
}
