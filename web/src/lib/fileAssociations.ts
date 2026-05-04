import { appConfigs } from '@/config/appMeta';
import { desktopApps } from '@/config/apps';
import type { DesktopApp } from '@/types/desktop';

const STORAGE_KEY = 'desktop:file-associations';

/** Get the effective extensions for an app (defaults merged with user overrides). */
export function getExtensionsForApp(appId: string): string[] {
  const cfg = appConfigs.find(a => a.id === appId);
  if (!cfg?.fileExtensions) return [];
  const defaults = new Set(cfg.fileExtensions);
  const overrides = getUserOverrides();
  for (const [ext, id] of Object.entries(overrides)) {
    if (id === appId) defaults.add(ext);
  }
  for (const ext of defaults) {
    if (overrides[ext] && overrides[ext] !== appId) defaults.delete(ext);
  }
  return [...defaults];
}

/** Get default extension → appId map from app configs. */
export function getDefaultAssociations(): Map<string, string> {
  const map = new Map<string, string>();
  for (const cfg of appConfigs) {
    if (!cfg.fileExtensions) continue;
    for (const ext of cfg.fileExtensions) {
      if (!map.has(ext)) map.set(ext, cfg.id);
    }
  }
  return map;
}

/** Get user override map from localStorage (ext → appId). */
export function getUserOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) return parsed;
  } catch { /* ignore */ }
  return {};
}

/** Save user override map to localStorage. */
export function setUserOverrides(overrides: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch { /* ignore */ }
}

/**
 * Resolve which app should open a given filename.
 * Checks user overrides first, then defaults. Falls back to text-editor for
 * files without extension.
 */
export function resolveAppForFile(filename: string): DesktopApp | null {
  const overrides = getUserOverrides();
  const defaults = getDefaultAssociations();

  const lower = filename.toLowerCase();

  // Check compound extensions first (e.g. "foo.tar.gz")
  const parts = lower.split('.');
  if (parts.length >= 3) {
    const compound = parts.slice(-2).join('.');
    if (overrides[compound]) {
      return desktopApps.find(a => a.id === overrides[compound]) ?? null;
    }
    if (defaults.has(compound)) {
      return desktopApps.find(a => a.id === defaults.get(compound)) ?? null;
    }
  }

  // Single extension
  const ext = parts.pop() || '';
  if (ext && overrides[ext]) {
    return desktopApps.find(a => a.id === overrides[ext]) ?? null;
  }
  if (ext && defaults.has(ext)) {
    return desktopApps.find(a => a.id === defaults.get(ext)) ?? null;
  }

  // No extension → default to text editor
  if (!ext || parts.length === 0) {
    return desktopApps.find(a => a.id === 'text-editor') ?? null;
  }

  return null;
}
