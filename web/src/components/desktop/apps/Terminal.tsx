import { useState, useEffect, useRef, useCallback } from 'react';
import { useConfig } from '@/context/ConfigContext';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SerializeAddon } from '@xterm/addon-serialize';
import { Keyboard } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';
import type { AppComponentProps } from '@/types/desktop';
import { createUuid } from '@/lib/uuid';
import VirtualKeyboard from './VirtualKeyboard';

interface TerminalMessage {
  id: string;
  type: 'input' | 'output' | 'resize' | 'exit' | 'error' | 'init' | 'history';
  data?: string;
  cols?: number;
  rows?: number;
}

// Per-window sessionStorage namespacing so multiple terminals in the same tab
// each have their own server session id and screen snapshot.
const SESSION_ID_PREFIX = 'terminal:sessionId:';
const SNAPSHOT_PREFIX = 'terminal:snapshot:';

function createWsMessageId() {
  return createUuid();
}

export default function Terminal(props: AppComponentProps) {
  const { windowId, appState } = props;
  const sessionIdKey = `${SESSION_ID_PREFIX}${windowId}`;
  const snapshotKey = `${SNAPSHOT_PREFIX}${windowId}`;

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const initRef = useRef(false);
  // Set true once the WS closes; flipped back to false when we reconnect.
  // Used by both keyboard input paths to intercept Enter as a reconnect trigger.
  const disconnectedRef = useRef(false);
  // Holds the latest `connect` closure so callbacks defined outside the effect
  // (like sendInput) can trigger a reconnect without going stale.
  const connectRef = useRef<(() => void) | null>(null);
  const { terminalConfig } = useConfig();
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [modifiers, setModifiers] = useState({ ctrl: false, alt: false, shift: false });
  const modifiersRef = useRef(modifiers);
  const copyOnSelectRef = useRef(terminalConfig.copyOnSelect);

  // Keep ref in sync with global config without re-initializing terminal
  useEffect(() => {
    copyOnSelectRef.current = terminalConfig.copyOnSelect;
  }, [terminalConfig.copyOnSelect]);

  // Keep modifiers ref in sync for use in term.onData closure
  useEffect(() => {
    modifiersRef.current = modifiers;
  }, [modifiers]);

  const toggleMod = useCallback((mod: 'ctrl' | 'alt' | 'shift') => {
    setModifiers(prev => ({ ...prev, [mod]: !prev[mod] }));
  }, []);

  const consumeMod = useCallback(() => {
    setModifiers({ ctrl: false, alt: false, shift: false });
  }, []);

  // Send input to WebSocket. When disconnected, treat Enter as a reconnect
  // request so the virtual keyboard keeps parity with the physical one.
  const sendInput = useCallback((data: string) => {
    if (disconnectedRef.current) {
      if (data === '\r') connectRef.current?.();
      return;
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ id: createWsMessageId(), type: 'input', data } satisfies TerminalMessage));
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current || initRef.current) return;
    initRef.current = true;

    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
      lineHeight: 1.2,
      scrollback: 5000,
      theme: {
        background: '#0a0e14',
        foreground: '#b3b1ad',
        cursor: '#4ade80',
        selectionBackground: '#4ade8033',
        black: '#0a0e14',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#facc15',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#e5e7eb',
        brightBlack: '#6b7280',
        brightRed: '#fca5a5',
        brightGreen: '#86efac',
        brightYellow: '#fde68a',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#f9fafb',
      },
    });

    const fitAddon = new FitAddon();
    const serializeAddon = new SerializeAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(serializeAddon);

    term.open(containerRef.current);

    // Small delay to ensure container has dimensions before fitting
    requestAnimationFrame(() => {
      fitAddon.fit();
    });

    termRef.current = term;
    fitRef.current = fitAddon;

    // Paint the last screen snapshot immediately so a refresh does not flash
    // empty content while the WebSocket reconnects and replays history.
    const cachedSnapshot = sessionStorage.getItem(snapshotKey);
    if (cachedSnapshot) {
      term.write(cachedSnapshot);
    }

    let disposed = false;

    // (Re)connect to the server. Reuses the stored sessionId so the existing
    // shell is reattached when available; called both on initial mount and
    // whenever the user presses Enter after a disconnect.
    const connect = () => {
      if (disposed) return;
      disconnectedRef.current = false;

      const storedSessionId = sessionStorage.getItem(sessionIdKey) ?? '';
      const initialCwd = (appState as any)?.cwd ?? '';
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsURL = `${wsProtocol}//${window.location.host}/api/ws/terminal?${
        new URLSearchParams({
          ...(storedSessionId ? { sessionId: storedSessionId } : {}),
          ...(initialCwd ? { cwd: initialCwd } : {}),
        }).toString()
      }`;
      const ws = new WebSocket(wsURL);
      wsRef.current = ws;

      let historyApplied = false;

      ws.onopen = () => {
        const { cols, rows } = term;
        ws.send(JSON.stringify({ id: createWsMessageId(), type: 'resize', cols, rows } satisfies TerminalMessage));
      };

      ws.onmessage = (event) => {
        try {
          const msg: TerminalMessage = JSON.parse(event.data);
          if (msg.type === 'init') {
            if (msg.data) sessionStorage.setItem(sessionIdKey, msg.data);
          } else if (msg.type === 'history') {
            // Server is the source of truth: clear any cached snapshot and replay.
            term.reset();
            term.write(msg.data ?? '');
            historyApplied = true;
          } else if (msg.type === 'output') {
            // If the server has no history (fresh session), drop the cached
            // snapshot once real output starts so it is not double-rendered.
            if (!historyApplied) {
              term.reset();
              historyApplied = true;
            }
            term.write(msg.data ?? '');
          } else if (msg.type === 'exit') {
            sessionStorage.removeItem(sessionIdKey);
            sessionStorage.removeItem(snapshotKey);
            term.write('\r\n\x1b[31m● Process exited\x1b[0m\r\n');
          } else if (msg.type === 'error') {
            term.write(`\r\n\x1b[31m● Error: ${msg.data}\x1b[0m\r\n`);
          }
        } catch {
          term.write(event.data);
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        disconnectedRef.current = true;
        term.write('\r\n\x1b[33m● Disconnected — press Enter to reconnect\x1b[0m\r\n');
      };
    };

    connectRef.current = connect;
    connect();

    // Terminal input → WebSocket. When disconnected, Enter triggers reconnect
    // and any other key is swallowed so users do not type into a dead shell.
    // Virtual keyboard modifiers (Ctrl/Alt/Shift) are applied to native input.
    term.onData((data) => {
      if (disconnectedRef.current) {
        if (data === '\r') {
          term.write('\r\n\x1b[36m● Reconnecting...\x1b[0m\r\n');
          connect();
        }
        return;
      }

      const mods = modifiersRef.current;
      let out = data;

      if (out.length === 1) {
        if (mods.shift) {
          out = out === out.toUpperCase() ? out.toLowerCase() : out.toUpperCase();
        }
        if (mods.ctrl) {
          const code = out.toUpperCase().charCodeAt(0);
          if (code >= 64 && code <= 95) {
            out = String.fromCharCode(code - 64);
          }
          if (mods.alt) out = '\x1b' + out;
        } else if (mods.alt) {
          out = '\x1b' + out;
        }
      }

      if (mods.ctrl || mods.alt || mods.shift) {
        setModifiers({ ctrl: false, alt: false, shift: false });
      }

      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ id: createWsMessageId(), type: 'input', data: out } satisfies TerminalMessage));
      }
    });

    // Auto-copy on selection
    term.onSelectionChange(() => {
      const selection = term.getSelection();
      if (selection && copyOnSelectRef.current) {
        navigator.clipboard.writeText(selection).catch(() => {
          /* Clipboard write might fail in some contexts; ignore */
        });
      }
    });

    // Handle resize
    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        fitAddon.fit();
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          const { cols, rows } = term;
          ws.send(JSON.stringify({ id: createWsMessageId(), type: 'resize', cols, rows } satisfies TerminalMessage));
        }
      });
    });
    observer.observe(containerRef.current);

    // Persist the visible screen so the next mount can paint it instantly,
    // before the server's history replay arrives.
    const saveSnapshot = () => {
      try {
        sessionStorage.setItem(snapshotKey, serializeAddon.serialize());
      } catch {
        /* sessionStorage may be full or unavailable; ignore */
      }
    };
    window.addEventListener('beforeunload', saveSnapshot);

    return () => {
      disposed = true;
      connectRef.current = null;
      window.removeEventListener('beforeunload', saveSnapshot);
      saveSnapshot();
      observer.disconnect();
      wsRef.current?.close();
      wsRef.current = null;
      term.dispose();
      initRef.current = false;
    };
  }, [sessionIdKey, snapshotKey]);

  return (
    <div className="h-full w-full flex flex-col relative" style={{ backgroundColor: '#0a0e14' }}>
      {/* Keyboard toggle button */}
      <button
        className={`absolute top-2 right-2 z-10 p-1.5 rounded-md transition-all duration-150
          ${showKeyboard
            ? 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30'
            : 'bg-white/[0.06] text-gray-500 hover:bg-white/[0.12] hover:text-gray-300'
          }`}
        onClick={() => setShowKeyboard(prev => !prev)}
        title="Toggle virtual keyboard"
      >
        <Keyboard className="w-4 h-4" />
      </button>

      {/* Terminal area */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 w-full"
        style={{ padding: '4px' }}
      />

      {/* Virtual Keyboard */}
      {showKeyboard && (
        <VirtualKeyboard
          onInput={sendInput}
          modifiers={modifiers}
          onToggleMod={toggleMod}
          onConsumeMod={consumeMod}
        />
      )}
    </div>
  );
}
