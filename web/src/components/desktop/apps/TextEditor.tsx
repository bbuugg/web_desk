import { useState, useEffect, useRef, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import type { AppComponentProps } from '@/types/desktop';
import { FileManagerClient } from '@/lib/ws-client';
import { Save, AlertCircle, Loader2, ChevronDown, FolderOpen, FileCode } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import FolderPicker from '../FolderPicker';
import { getExtensionsForApp } from '@/lib/fileAssociations';

const LANGUAGES: { id: string; label: string }[] = [
  { id: 'plaintext', label: 'Text' },
  { id: 'json', label: 'JSON' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'html', label: 'HTML' },
  { id: 'css', label: 'CSS' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'python', label: 'Python' },
  { id: 'go', label: 'Go' },
  { id: 'rust', label: 'Rust' },
  { id: 'java', label: 'Java' },
  { id: 'cpp', label: 'C/C++' },
  { id: 'php', label: 'PHP' },
  { id: 'yaml', label: 'YAML' },
  { id: 'xml', label: 'XML' },
  { id: 'shell', label: 'Shell' },
  { id: 'sql', label: 'SQL' },
];

export default function TextEditor({ windowId, actions, appState }: AppComponentProps) {
  const filePath = appState?.path || '';
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [showFilePicker, setShowFilePicker] = useState(false);
  // null = auto-detect from extension; non-null = user override
  const [manualLanguage, setManualLanguage] = useState<string | null>(null);

  const clientRef = useRef<FileManagerClient | null>(null);
  const editorRef = useRef<any>(null);

  // Connect to the backend
  useEffect(() => {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/api/ws/files`;
    const client = new FileManagerClient(wsUrl, setConnected);
    clientRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
    };
  }, []);

  // Load file content when connected and path is provided
  useEffect(() => {
    if (connected && filePath && clientRef.current) {
      const loadFile = async () => {
        setLoading(true);
        setError(null);
        try {
          const res = await clientRef.current!.read(filePath);
          setContent(res.content);
          setIsDirty(false);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setLoading(false);
        }
      };
      loadFile();
    }
  }, [connected, filePath]);

  // Drop user-picked language whenever the file changes so auto-detection
  // re-applies for the new file. The user can re-pick a language afterwards.
  useEffect(() => {
    setManualLanguage(null);
  }, [filePath]);

  const handleEditorChange = (value: string | undefined) => {
    setContent(value || '');
    setIsDirty(true);
  };

  const handleEditorDidMount = (editor: any) => {
    editorRef.current = editor;
  };

  const saveFile = useCallback(async () => {
    if (!filePath || !clientRef.current || !connected) return;
    setSaving(true);
    setError(null);
    try {
      await clientRef.current.saveFile(filePath, content);
      setIsDirty(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [filePath, content, connected]);

  // Save on Ctrl+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveFile();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveFile]);

  // Determine language based on file extension
  const getLanguage = (path: string) => {
    const ext = path.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts':
      case 'tsx': return 'typescript';
      case 'js':
      case 'jsx': return 'javascript';
      case 'json': return 'json';
      case 'html': return 'html';
      case 'css': return 'css';
      case 'md': return 'markdown';
      case 'py': return 'python';
      case 'go': return 'go';
      case 'rs': return 'rust';
      case 'java': return 'java';
      case 'c':
      case 'cpp':
      case 'h': return 'cpp';
      case 'php': return 'php';
      case 'yaml':
      case 'yml': return 'yaml';
      case 'xml': return 'xml';
      case 'sh':
      case 'bash': return 'shell';
      case 'sql': return 'sql';
      default: return 'plaintext';
    }
  };

  useEffect(() => {
    if (filePath) {
      const name = filePath.split(/[/\\]/).filter(Boolean).pop() || 'Untitled';
      actions.updateWindowTitle(windowId, name + (isDirty ? '*' : ''));
    } else {
      actions.updateWindowTitle(windowId, 'Text Editor');
    }
  }, [filePath, isDirty, windowId, actions]);

  const handleFileSelect = (newPath: string) => {
    setShowFilePicker(false);
    actions.updateWindowState(windowId, { path: newPath });
  };

  const activeLanguage = manualLanguage ?? getLanguage(filePath);
  const activeLanguageLabel =
    LANGUAGES.find(l => l.id === activeLanguage)?.label ?? 'Text';

  if (!filePath) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center text-gray-400 bg-[#1e1e1e]">
        <div className="rounded-full bg-white/5 p-4">
          <FileCode className="h-10 w-10 text-emerald-500/60" />
        </div>
        <div className="space-y-1">
          <h3 className="text-base font-medium text-gray-300">No file selected</h3>
          <p className="text-sm text-gray-500">Open a text or code file to start editing.</p>
        </div>
        <button
          onClick={() => setShowFilePicker(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-600 active:scale-95"
        >
          <FolderOpen className="h-4 w-4" />
          Open File
        </button>
        {showFilePicker && (
          <FolderPicker
            mode="file"
            title="Open File"
            extensions={getExtensionsForApp('text-editor')}
            onSelect={handleFileSelect}
            onCancel={() => setShowFilePicker(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#1e1e1e] text-gray-200">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-white/5 bg-[#252526]">
        <button
          onClick={() => setShowFilePicker(true)}
          className="inline-flex items-center gap-2 rounded-md bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-white/10 hover:text-white"
          title="Open different file"
        >
          <FolderOpen className="w-4 h-4" />
          Open
        </button>

        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-gray-300 bg-white/5 hover:bg-white/10 transition-colors"
              title="语言"
            >
              {activeLanguageLabel}
              <ChevronDown className="w-3 h-3 opacity-60" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
              {LANGUAGES.map(lang => (
                <DropdownMenuItem
                  key={lang.id}
                  onSelect={() => setManualLanguage(lang.id)}
                  className={lang.id === activeLanguage ? 'text-emerald-400' : ''}
                >
                  {lang.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <button
            onClick={saveFile}
            disabled={!filePath || !isDirty || saving || !connected}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors
              ${(!filePath || !isDirty || saving || !connected)
                ? 'text-gray-500 bg-white/5 cursor-not-allowed'
                : 'text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20'
              }`}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save
          </button>
        </div>
      </div>

      {/* Editor Content */}
      <div className="flex-1 relative">
        {error && (
          <div className="absolute top-0 left-0 right-0 z-10 m-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm shadow-lg">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="flex-1 truncate">{error}</span>
            <button className="text-xs underline hover:text-red-300" onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}

        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[#1e1e1e] z-10">
            <div className="flex flex-col items-center gap-3 text-gray-400">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-500/50" />
              <span className="text-sm">Loading file...</span>
            </div>
          </div>
        ) : !connected && !loading ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[#1e1e1e] z-10">
            <div className="flex flex-col items-center gap-2 text-amber-500/80">
              <AlertCircle className="w-8 h-8" />
              <span>Connecting to server...</span>
            </div>
          </div>
        ) : (
          <Editor
            height="100%"
            language={activeLanguage}
            theme="vs-dark"
            value={content}
            onChange={handleEditorChange}
            onMount={handleEditorDidMount}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              wordWrap: 'on',
              padding: { top: 16, bottom: 16 },
              scrollBeyondLastLine: false,
              smoothScrolling: true,
              cursorBlinking: 'smooth',
            }}
          />
        )}
      </div>
      {showFilePicker && (
        <FolderPicker
          mode="file"
          title="Open File"
          onSelect={handleFileSelect}
          onCancel={() => setShowFilePicker(false)}
        />
      )}
    </div>
  );
}
