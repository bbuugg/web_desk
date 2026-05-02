const AUTH_CACHE_KEY = 'linux_web.boot_auth';
const AUTH_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface CachedAuth {
  expiresAt: number;
}

function getStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof window === 'undefined' || !window.localStorage) return null;
  return window.localStorage;
}

export function getBootAuthCacheTtlMs() {
  return AUTH_CACHE_TTL_MS;
}

export function hasValidBootAuth(storage?: StorageLike, now = Date.now()) {
  const activeStorage = getStorage(storage);
  if (!activeStorage) return false;

  try {
    const raw = activeStorage.getItem(AUTH_CACHE_KEY);
    if (!raw) return false;

    const parsed = JSON.parse(raw) as Partial<CachedAuth>;
    return typeof parsed.expiresAt === 'number' && parsed.expiresAt > now;
  } catch {
    return false;
  }
}

export function saveBootAuth(storage?: StorageLike, now = Date.now()) {
  const activeStorage = getStorage(storage);
  if (!activeStorage) return;

  try {
    const payload: CachedAuth = { expiresAt: now + AUTH_CACHE_TTL_MS };
    activeStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore unavailable or full storage.
  }
}

export function clearBootAuth(storage?: StorageLike) {
  const activeStorage = getStorage(storage);
  if (!activeStorage) return;

  try {
    activeStorage.removeItem(AUTH_CACHE_KEY);
  } catch {
    // Ignore unavailable storage.
  }
}
