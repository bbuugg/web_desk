import { useCallback } from 'react';

interface VirtualKeyboardProps {
  onInput: (data: string) => void;
  modifiers: { ctrl: boolean; alt: boolean; shift: boolean };
  onToggleMod: (mod: 'ctrl' | 'alt' | 'shift') => void;
  onConsumeMod: () => void;
}

interface KeyDef {
  label: string;
  data?: string;
  type: 'special';
}

const SPECIAL_KEYS: KeyDef[] = [
  { label: 'Esc', data: '\x1b', type: 'special' },
  { label: 'Tab', data: '\x09', type: 'special' },
  { label: 'Space', data: ' ', type: 'special' },
  { label: '↵', data: '\r', type: 'special' },
  { label: '⌫', data: '\x7f', type: 'special' },
  { label: 'Del', data: '\x1b[3~', type: 'special' },
];

const NAV_KEYS: KeyDef[] = [
  { label: '←', data: '\x1b[D', type: 'special' },
  { label: '↑', data: '\x1b[A', type: 'special' },
  { label: '↓', data: '\x1b[B', type: 'special' },
  { label: '→', data: '\x1b[C', type: 'special' },
  { label: 'Home', data: '\x1b[H', type: 'special' },
  { label: 'End', data: '\x1b[F', type: 'special' },
  { label: 'PgUp', data: '\x1b[5~', type: 'special' },
  { label: 'PgDn', data: '\x1b[6~', type: 'special' },
];

const FUNC_KEYS: KeyDef[] = [
  { label: 'F1', data: '\x1bOP', type: 'special' },
  { label: 'F2', data: '\x1bOQ', type: 'special' },
  { label: 'F3', data: '\x1bOR', type: 'special' },
  { label: 'F4', data: '\x1bOS', type: 'special' },
  { label: 'F5', data: '\x1b[15~', type: 'special' },
  { label: 'F6', data: '\x1b[17~', type: 'special' },
  { label: 'F7', data: '\x1b[18~', type: 'special' },
  { label: 'F8', data: '\x1b[19~', type: 'special' },
  { label: 'F9', data: '\x1b[20~', type: 'special' },
  { label: 'F10', data: '\x1b[21~', type: 'special' },
  { label: 'F11', data: '\x1b[23~', type: 'special' },
  { label: 'F12', data: '\x1b[24~', type: 'special' },
];

export default function VirtualKeyboard({ onInput, modifiers, onToggleMod, onConsumeMod }: VirtualKeyboardProps) {
  const handleKey = useCallback((key: KeyDef) => {
    if (!key.data) return;

    let data = key.data;

    if (modifiers.ctrl) {
      const code = data.toUpperCase().charCodeAt(0);
      if (code >= 64 && code <= 95) {
        data = String.fromCharCode(code - 64);
      }
      if (modifiers.alt) data = '\x1b' + data;
    } else if (modifiers.alt) {
      data = '\x1b' + data;
    }

    onInput(data);
    onConsumeMod();
  }, [modifiers, onInput, onConsumeMod]);

  const keyClass = (active = false) =>
    `flex items-center justify-center rounded-md text-[11px] font-medium
     select-none cursor-pointer transition-all duration-100
     ${active
      ? 'bg-emerald-500/30 text-emerald-300 ring-1 ring-emerald-500/50 shadow-[0_0_8px_rgba(74,222,128,0.2)]'
      : 'bg-white/[0.06] text-gray-300 hover:bg-white/[0.12] active:bg-white/[0.18] ring-1 ring-white/[0.06]'
    }`;

  return (
    <div
      className="shrink-0 border-t border-white/[0.06] overflow-y-auto"
      style={{ backgroundColor: '#080b10', maxHeight: '280px' }}
      onClick={e => e.stopPropagation()}
    >
      {/* Modifiers + Special + Navigation */}
      <div className="px-2 py-2 flex flex-wrap gap-1">
        {(['ctrl', 'alt', 'shift'] as const).map(mod => (
          <button
            key={mod}
            className={`${keyClass(modifiers[mod])} px-3 h-7`}
            onMouseDown={e => { e.preventDefault(); onToggleMod(mod); }}
          >
            {mod.charAt(0).toUpperCase() + mod.slice(1)}
          </button>
        ))}
        <div className="w-px h-7 bg-white/[0.06] mx-0.5" />
        {SPECIAL_KEYS.map(k => (
          <button key={k.label} className={`${keyClass()} px-2 h-7`} onMouseDown={e => { e.preventDefault(); handleKey(k); }}>
            {k.label}
          </button>
        ))}
        <div className="w-px h-7 bg-white/[0.06] mx-0.5" />
        {NAV_KEYS.map(k => (
          <button key={k.label} className={`${keyClass()} px-2 h-7`} onMouseDown={e => { e.preventDefault(); handleKey(k); }}>
            {k.label}
          </button>
        ))}
      </div>

      {/* Function keys */}
      <div className="px-2 pb-2 flex gap-1 overflow-x-auto scrollbar-none">
        {FUNC_KEYS.map(k => (
          <button key={k.label} className={`${keyClass()} px-2 h-6 text-[10px]`} onMouseDown={e => { e.preventDefault(); handleKey(k); }}>
            {k.label}
          </button>
        ))}
      </div>
    </div>
  );
}
