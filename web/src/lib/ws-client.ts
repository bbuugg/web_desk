// WebSocket client for file manager communication with the Go backend

import { createUuid } from '@/lib/uuid';

function createWsMessageId() {
  return createUuid();
}

export interface FileInfo {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mode: string;
  modTime: number; // unix ms
}

export interface ListResponse {
  path: string;
  files: FileInfo[];
}

export interface ReadResponse {
  path: string;
  content: string;
  size: number;
}

type WSResponse = {
  id: string;
  ok: boolean;
  error?: string;
  data?: unknown;
};

type PendingRequest = {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
};

export class FileManagerClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private url: string;
  private onStatusChange?: (connected: boolean) => void;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;

  constructor(url: string, onStatusChange?: (connected: boolean) => void) {
    this.url = url;
    this.onStatusChange = onStatusChange;
  }

  connect(): Promise<void> {
    this.shouldReconnect = true;
    return this._connect();
  }

  private _connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve();

    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log('[FileManager WS] Connected');
        this.onStatusChange?.(true);
        resolve();
      };

      this.ws.onclose = () => {
        console.log('[FileManager WS] Disconnected');
        this.onStatusChange?.(false);
        for (const [, p] of this.pending) {
          p.reject(new Error('WebSocket disconnected'));
        }
        this.pending.clear();
        if (this.shouldReconnect) {
          this.reconnectTimer = setTimeout(() => this._connect(), 2000);
        }
      };

      this.ws.onerror = (e) => {
        console.error('[FileManager WS] Error:', e);
        reject(new Error('WebSocket connection failed'));
      };

      this.ws.onmessage = (event) => {
        try {
          const resp: WSResponse = JSON.parse(event.data);
          const p = this.pending.get(resp.id);
          if (p) {
            this.pending.delete(resp.id);
            if (resp.ok) {
              p.resolve(resp.data);
            } else {
              p.reject(new Error(resp.error || 'Unknown error'));
            }
          }
        } catch (e) {
          console.error('[FileManager WS] Parse error:', e);
        }
      };
    });
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  private send<T>(action: string, data: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      const id = createWsMessageId();
      this.pending.set(id, {
        resolve: resolve as (d: unknown) => void,
        reject,
      });

      this.ws.send(JSON.stringify({ id, action, data }));

      // Timeout after 15s
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 15000);
    });
  }

  // --- Public API ---

  list(path: string, showHidden = false): Promise<ListResponse> {
    return this.send<ListResponse>('list', { path, showHidden });
  }

  read(path: string): Promise<ReadResponse> {
    return this.send<ReadResponse>('read', { path });
  }

  createFile(path: string, content = ''): Promise<{ path: string }> {
    return this.send('create', { path, content, isDir: false });
  }

  saveFile(path: string, content: string): Promise<{ path: string }> {
    return this.send('create', { path, content, isDir: false });
  }

  mkdir(path: string): Promise<{ path: string }> {
    return this.send('mkdir', { path });
  }

  delete(path: string): Promise<{ path: string }> {
    return this.send('delete', { path });
  }

  rename(oldPath: string, newPath: string): Promise<{ oldPath: string; newPath: string }> {
    return this.send('rename', { oldPath, newPath });
  }

  copy(src: string, dst: string): Promise<{ src: string; dst: string }> {
    return this.send('copy', { src, dst });
  }

  move(src: string, dst: string): Promise<{ src: string; dst: string }> {
    return this.send('move', { src, dst });
  }

  stat(path: string): Promise<FileInfo> {
    return this.send<FileInfo>('stat', { path });
  }

  listArchive(path: string): Promise<ListResponse> {
    return this.send<ListResponse>('list_archive', { path });
  }

  unzip(path: string, dest?: string, files?: string[], stripPrefix?: string): Promise<{ path: string }> {
    return this.send('unzip', { path, dest, files, stripPrefix });
  }

  compress(paths: string[], dest: string): Promise<{ path: string }> {
    return this.send('compress', { paths, dest });
  }

  restore(path: string): Promise<{ path: string }> {
    return this.send('restore', { path });
  }

  emptyTrash(): Promise<{ status: string }> {
    return this.send('empty_trash', {});
  }

  permanentDelete(path: string): Promise<{ path: string }> {
    return this.send('permanent_delete', { path });
  }
}
