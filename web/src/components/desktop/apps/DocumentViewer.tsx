import type { AppComponentProps } from '@/types/desktop';
import { Download, ExternalLink, FileText, FileWarning, FolderOpen, Loader2 } from 'lucide-react';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import FolderPicker from '../FolderPicker';
import { getExtensionsForApp } from '@/lib/fileAssociations';

GlobalWorkerOptions.workerSrc = pdfWorker;

type DocumentState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'pdf'; path: string; source: 'file' | 'converted' }
  | { kind: 'spreadsheet'; workbook: XLSX.WorkBook; sheetName: string };

const SUPPORTED_SPREADSHEET_EXTS = new Set(['xls', 'xlsx', 'csv']);
const SUPPORTED_PRESENTATION_EXTS = new Set(['ppt', 'pptx', 'doc', 'docx']);

function getFileName(path: string) {
  if (!path) return 'document';
  return path.split(/[/\\]/).filter(Boolean).pop() || 'document';
}

function getExtension(path: string) {
  return getFileName(path).split('.').pop()?.toLowerCase() || '';
}

const API_URL = '/api/files/content';
const PREVIEW_PDF_URL = '/api/files/preview-pdf';

async function fetchFileContent(path: string): Promise<ArrayBuffer> {
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (!resp.ok) {
    throw new Error(`Failed to load document (${resp.status})`);
  }
  return resp.arrayBuffer();
}

async function fetchConvertedPdf(path: string): Promise<ArrayBuffer> {
  const resp = await fetch(PREVIEW_PDF_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ error: `Failed to convert document (${resp.status})` }));
    throw new Error(body.error || `Failed to convert document (${resp.status})`);
  }
  return resp.arrayBuffer();
}

async function downloadFile(path: string) {
  const name = getFileName(path);
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, download: true, name }),
  });
  if (!resp.ok) throw new Error(`Download failed (${resp.status})`);
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function PdfPreview({ path, source }: { path: string; source: 'file' | 'converted' }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const renderPdf = async () => {
      setLoading(true);
      setError(null);
      container.innerHTML = '';

      try {
        const buffer = source === 'converted' ? await fetchConvertedPdf(path) : await fetchFileContent(path);
        if (cancelled) return;

        const blob = new Blob([buffer], { type: 'application/pdf' });
        const blobUrl = URL.createObjectURL(blob);

        const loadingTask = getDocument(blobUrl);
        const pdf = await loadingTask.promise;
        if (cancelled) {
          URL.revokeObjectURL(blobUrl);
          await loadingTask.destroy();
          return;
        }

        const containerWidth = Math.max(container.clientWidth - 32, 320);

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          const page = await pdf.getPage(pageNumber);
          if (cancelled) break;

          const viewport = page.getViewport({ scale: 1 });
          const scale = Math.min(2, Math.max(1, containerWidth / viewport.width));
          const scaledViewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          if (!context) {
            throw new Error('Canvas rendering is not available in this browser.');
          }

          canvas.width = scaledViewport.width;
          canvas.height = scaledViewport.height;
          canvas.className = 'mx-auto mb-4 block max-w-full rounded-lg bg-white shadow-2xl';

          await page.render({ canvas, canvasContext: context, viewport: scaledViewport }).promise;
          if (cancelled) break;

          container.appendChild(canvas);
          if (pageNumber === 1) {
            setLoading(false);
          }
        }

        URL.revokeObjectURL(blobUrl);
        await loadingTask.destroy();
      } catch (renderError) {
        if (!cancelled) {
          setError((renderError as Error).message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    renderPdf();

    return () => {
      cancelled = true;
      if (container) {
        container.innerHTML = '';
      }
    };
  }, [path, source]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-gray-400">
        <div className="space-y-3">
          <FileWarning className="mx-auto h-10 w-10 text-amber-400" />
          <p className="text-sm leading-6">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-auto bg-[#11161f] p-4">
      {loading && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-[#11161f]/85 text-gray-400">
          <div className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        </div>
      )}
      <div ref={containerRef} className="min-h-full" />
    </div>
  );
}

export default function DocumentViewer({ windowId, actions, appState }: AppComponentProps) {
  const path = appState?.path || '';
  const [state, setState] = useState<DocumentState>({ kind: 'idle' });
  const [showPicker, setShowPicker] = useState(false);

  const extension = useMemo(() => getExtension(path), [path]);

  useEffect(() => {
    if (!path) {
      setState({ kind: 'idle' });
      return;
    }

    if (extension === 'pdf') {
      setState({ kind: 'pdf', path, source: 'file' });
      return;
    }

    if (SUPPORTED_PRESENTATION_EXTS.has(extension)) {
      setState({ kind: 'pdf', path, source: 'converted' });
      return;
    }

    let cancelled = false;

    const loadDocument = async () => {
      setState({ kind: 'loading' });

      try {
        const buffer = await fetchFileContent(path);
        if (cancelled) return;

        if (SUPPORTED_SPREADSHEET_EXTS.has(extension)) {
          const workbook = XLSX.read(buffer, { type: 'array' });
          const firstSheet = workbook.SheetNames[0];
          if (!firstSheet) {
            throw new Error('Spreadsheet has no visible sheets');
          }
          setState({ kind: 'spreadsheet', workbook, sheetName: firstSheet });
          return;
        }

        setState({ kind: 'error', message: `Unsupported document type: .${extension || 'unknown'}` });
      } catch (error) {
        if (!cancelled) {
          setState({ kind: 'error', message: (error as Error).message });
        }
      }
    };

    loadDocument();

    return () => {
      cancelled = true;
    };
  }, [extension, path]);

  useEffect(() => {
    if (path) {
      actions.updateWindowTitle(windowId, getFileName(path));
    } else {
      actions.updateWindowTitle(windowId, 'Document Viewer');
    }
  }, [path, windowId, actions]);

  const handleFileSelect = (newPath: string) => {
    setShowPicker(false);
    actions.updateWindowState(windowId, { path: newPath });
  };

  const renderBody = () => {
    if (state.kind === 'idle') {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center text-gray-500">
          <div className="rounded-full bg-white/5 p-4">
            <FileText className="h-10 w-10 text-gray-600" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-medium text-gray-300">No document selected</h3>
            <p className="text-sm text-gray-500">Pick a file from your computer to preview it here.</p>
          </div>
          <button
            onClick={() => setShowPicker(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-600 active:scale-95"
          >
            <FolderOpen className="h-4 w-4" />
            Select File
          </button>
        </div>
      );
    }

    if (state.kind === 'loading') {
      return (
        <div className="flex h-full items-center justify-center text-gray-500 gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading document...
        </div>
      );
    }

    if (state.kind === 'error') {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center text-gray-400">
          <FileWarning className="h-10 w-10 text-amber-400" />
          <div className="space-y-1">
            <p className="max-w-xl text-sm leading-6">{state.message}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowPicker(true)}
              className="inline-flex items-center gap-2 rounded-md bg-white/8 px-3 py-2 text-sm text-white hover:bg-white/12 transition-colors"
            >
              <FolderOpen className="h-4 w-4" />
              Select another file
            </button>
            <button
              onClick={() => downloadFile(path)}
              className="inline-flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-sm text-gray-300 hover:bg-white/5 transition-colors"
            >
              <Download className="h-4 w-4" />
              Download instead
            </button>
          </div>
        </div>
      );
    }

    if (state.kind === 'pdf') {
      return <PdfPreview path={state.path} source={state.source} />;
    }

    const sheet = state.workbook.Sheets[state.sheetName];
    const rows = XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, {
      header: 1,
      blankrows: false,
      defval: '',
    });

    return (
      <div className="flex h-full min-h-0 flex-col bg-[#0d1117]">
        <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2 overflow-x-auto">
          {state.workbook.SheetNames.map(sheetName => (
            <button
              key={sheetName}
              className={`rounded-md px-2.5 py-1 text-xs transition-colors ${sheetName === state.sheetName ? 'bg-emerald-500/15 text-emerald-300' : 'text-gray-400 hover:bg-white/8 hover:text-white'}`}
              onClick={() => setState({ kind: 'spreadsheet', workbook: state.workbook, sheetName })}
            >
              {sheetName}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="min-w-full border-separate border-spacing-0 text-sm text-gray-200">
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td className="px-4 py-6 text-center text-gray-500">Empty sheet</td>
                </tr>
              )}
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="odd:bg-white/[0.02]">
                  <td className="sticky left-0 z-10 border-b border-r border-white/5 bg-[#101722] px-3 py-2 text-xs text-gray-500">
                    {rowIndex + 1}
                  </td>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="whitespace-nowrap border-b border-r border-white/5 px-3 py-2 align-top">
                      {String(cell ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col bg-[#0d1117] text-gray-200">
      <div className="flex items-center justify-between gap-3 border-b border-white/5 bg-white/[0.02] px-3 py-2">
        <button
          onClick={() => setShowPicker(true)}
          className="inline-flex items-center gap-2 rounded-md bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-white/10 hover:text-white"
          title="Open File"
        >
          <FolderOpen className="h-4 w-4" />
          Open
        </button>
        <div className="flex items-center gap-1">
          {path && (
            <>
              <button
                onClick={async () => {
                  const buffer = await fetchFileContent(path);
                  const blob = new Blob([buffer]);
                  const url = URL.createObjectURL(blob);
                  window.open(url, '_blank');
                  setTimeout(() => URL.revokeObjectURL(url), 60000);
                }}
                className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
                title="Open in new tab"
              >
                <ExternalLink className="h-4 w-4" />
              </button>
              <button
                onClick={() => downloadFile(path)}
                className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
                title="Download"
              >
                <Download className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 relative">
        {renderBody()}
        {showPicker && (
          <FolderPicker
            mode="file"
            title="Open Document"
            extensions={getExtensionsForApp('document-viewer')}
            onSelect={handleFileSelect}
            onCancel={() => setShowPicker(false)}
          />
        )}
      </div>
    </div>
  );
}
