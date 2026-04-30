export function isWindowsDrivePath(path: string) {
  return /^[A-Za-z]:[/\\]?$/.test(path);
}

export function toForwardSlashPath(path: string) {
  return path.replace(/\\/g, '/');
}

export function joinPath(base: string, name: string) {
  const normalizedBase = toForwardSlashPath(base).replace(/\/+$/, '');
  return normalizedBase ? `${normalizedBase}/${name}` : `/${name}`;
}

export function getParentPath(path: string) {
  const normalizedPath = toForwardSlashPath(path).replace(/\/+$/, '');
  if (normalizedPath === '' || normalizedPath === '/') {
    return '/';
  }

  const parts = normalizedPath.split('/').filter(Boolean);
  if (parts.length <= 1) {
    return isWindowsDrivePath(parts[0] ?? '') ? `${parts[0]}/` : '/';
  }

  const nextParts = parts.slice(0, -1);
  if (isWindowsDrivePath(nextParts[0] ?? '') && nextParts.length === 1) {
    return `${nextParts[0]}/`;
  }

  return normalizedPath.startsWith('/')
    ? `/${nextParts.join('/')}`
    : nextParts.join('/');
}

export function getBreadcrumbModel(path: string) {
  const normalizedPath = toForwardSlashPath(path);
  const parts = normalizedPath.split('/').filter(Boolean);
  const rootPart = parts[0] ?? '/';
  const windowsPath = /^[A-Za-z]:$/.test(rootPart);

  return {
    rootLabel: windowsPath ? rootPart : '/',
    rootPath: windowsPath ? `${rootPart}/` : '/',
    parts: windowsPath ? parts.slice(1) : parts,
    buildPath(index: number) {
      if (windowsPath) {
        const pathParts = parts.slice(0, index + 2);
        return pathParts.length === 1 ? `${rootPart}/` : pathParts.join('/');
      }
      return `/${parts.slice(0, index + 1).join('/')}`;
    },
  };
}
