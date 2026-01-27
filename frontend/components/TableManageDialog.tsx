'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ProjectInfo } from '../lib/projectsApi';
import { createTable, updateTable, deleteTable } from '../lib/projectsApi';
import { refreshProjects } from '../lib/hooks/useData';
import { useAuth } from '../app/supabase/SupabaseAuthProvider';
import { ImportModal } from './editors/tree/components/ImportModal';
import { uploadAndSubmit } from '../lib/etlApi';
import {
  addPendingTasks,
  replacePlaceholderTasks,
  removeFailedPlaceholders,
  removeAllPlaceholdersForTable,
} from './BackgroundTaskNotifier';
import {
  parseUrl,
  importData,
  type ParseUrlResponse,
  type CrawlOptions,
} from '../lib/connectApi';
import CrawlOptionsPanel from './CrawlOptionsPanel';

type StartOption = 'empty' | 'documents' | 'url' | 'connect';
type DialogMode = 'create' | 'edit' | 'delete';

type TableManageDialogProps = {
  mode: DialogMode;
  projectId: string | null;
  tableId: string | null;
  parentId?: string | null;
  projects: ProjectInfo[];
  onClose: () => void;
  onModeChange?: (mode: DialogMode) => void;
  defaultStartOption?: StartOption;
};

// ... helper functions omitted for brevity, they are unchanged ...
function needsETL(file: File): boolean {
  const etlExtensions = [
    '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.jpg', '.jpeg', '.png', '.tiff', '.bmp',
  ];
  return etlExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
}

async function isTextFileType(file: File): Promise<boolean> {
  if (needsETL(file)) return false;
  const textExts = [
    '.txt', '.md', '.json', '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c', '.h', '.html', '.css', '.xml', '.yaml', '.yml', '.csv', '.sql', '.sh',
  ];
  const binaryExts = [
    '.zip', '.rar', '.tar', '.gz', '.gif', '.svg', '.webp', '.mp3', '.mp4', '.exe', '.dll', '.xls', '.xlsx',
  ];
  const fileName = file.name.toLowerCase();
  if (binaryExts.some(ext => fileName.endsWith(ext))) return false;
  if (textExts.some(ext => fileName.endsWith(ext))) return true;
  const buffer = await file.slice(0, 1024).arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.includes(0)) return false;
  let printable = 0;
  for (let i = 0; i < Math.min(bytes.length, 512); i++) {
    const b = bytes[i];
    if ((b >= 32 && b <= 126) || b === 9 || b === 10 || b === 13) printable++;
  }
  return printable / Math.min(bytes.length, 512) > 0.7;
}

function sanitizeUnicode(s: string): string {
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFE\uFFFF]/g, '').trim();
}

export function TableManageDialog({
  mode,
  projectId,
  tableId,
  parentId = null,
  projects,
  onClose,
  onModeChange,
  defaultStartOption = 'empty',
}: TableManageDialogProps) {
  const { session } = useAuth();
  const project = projectId ? projects.find(p => p.id === projectId) : null;
  const table = tableId && project ? project.nodes.find(t => t.id === tableId) : null;

  const [name, setName] = useState(table?.name || '');
  const [loading, setLoading] = useState(false);
  const [startOption, setStartOption] = useState<StartOption>(defaultStartOption);
  const [isDragging, setIsDragging] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
  const [importMessage, setImportMessage] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [crawlOptions, setCrawlOptions] = useState<CrawlOptions>({
    limit: 50,
    maxDepth: 3,
    crawlEntireDomain: true,
    sitemap: 'include',
  });
  const [connectUrlInput, setConnectUrlInput] = useState('');
  const [connectParseResult, setConnectParseResult] = useState<ParseUrlResponse | null>(null);
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectNeedsAuth, setConnectNeedsAuth] = useState(false);
  const [connectImporting, setConnectImporting] = useState(false);
  
  const connectStatusMeta = (() => {
    if (connectNeedsAuth) return { label: 'Authorization required', color: '#ef4444' };
    if (connectImporting) return { label: 'Importing...', color: '#22c55e' };
    if (connectParseResult) return { label: `Ready to import • ${connectParseResult.total_items} items`, color: '#22c55e' };
    if (connectLoading) return { label: 'Parsing...', color: '#3b82f6' };
    if (connectError) return { label: 'Parsing failed', color: '#ef4444' };
    if (connectUrlInput.trim()) return { label: 'Click Parse to continue', color: '#eab308' };
    return { label: 'Waiting for connector URL', color: '#595959' };
  })();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropzoneRef = useRef<HTMLDivElement>(null);

  const resetConnectState = useCallback(() => {
    setConnectUrlInput('');
    setConnectParseResult(null);
    setConnectError(null);
    setConnectNeedsAuth(false);
    setConnectLoading(false);
    setConnectImporting(false);
  }, []);

  const isNotionUrl = (value: string) => value.includes('notion.so') || value.includes('notion.site');

  useEffect(() => {
    if (table) setName(table.name);
  }, [table]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); 
    if (e.currentTarget === dropzoneRef.current) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      setSelectedFiles(files);
      if (!name.trim()) {
        const firstFile = files[0];
        if (firstFile.webkitRelativePath) {
          const folderName = firstFile.webkitRelativePath.split('/')[0];
          setName(folderName);
        } else {
          const fn = firstFile.name;
          setName(fn.substring(0, fn.lastIndexOf('.')) || fn);
        }
      }
    }
  }, [name]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFiles(e.target.files);
      if (!name.trim()) {
        const firstFile = e.target.files[0];
        if (firstFile.webkitRelativePath) {
          const folderName = firstFile.webkitRelativePath.split('/')[0];
          setName(folderName);
        } else {
          const fn = firstFile.name;
          setName(fn.substring(0, fn.lastIndexOf('.')) || fn);
        }
      }
    }
  };

  const handleConnectParse = useCallback(async () => {
    if (!connectUrlInput.trim()) return;
    setConnectLoading(true);
    setConnectError(null);
    setConnectNeedsAuth(false);
    setConnectParseResult(null);
    try {
      const result = await parseUrl(connectUrlInput.trim());
      setConnectParseResult(result);
      if (!name.trim()) setName(result.title || 'Imported Data');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to parse URL';
      setConnectError(message);
      const lower = message.toLowerCase();
      if (lower.includes('auth') || lower.includes('401') || isNotionUrl(connectUrlInput)) {
        setConnectNeedsAuth(true);
      }
    } finally {
      setConnectLoading(false);
    }
  }, [connectUrlInput, name]);

  const handleConnectImport = useCallback(async () => {
    if (!connectParseResult || !projectId) return;
    try {
      setConnectImporting(true);
      setConnectError(null);
      await importData({
        url: connectParseResult.url,
        project_id: projectId,
        table_id: undefined,
        table_name: name.trim() || connectParseResult.title || 'Imported Data',
        table_description: `Imported from ${connectParseResult.source_type}`,
      });
      await refreshProjects();
      resetConnectState();
      onClose();
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : 'Failed to import data');
    } finally {
      setConnectImporting(false);
    }
  }, [connectParseResult, name, projectId, onClose, resetConnectState]);

  const parseFolderStructure = async (files: FileList, onProgress?: (c: number, t: number) => void): Promise<{ structure: Record<string, any>; etlFiles: File[] }> => {
    const structure: Record<string, any> = {};
    const etlFiles: File[] = [];
    const fileArray = Array.from(files);
    let processed = 0;

    for (const file of fileArray) {
      const pathParts = file.webkitRelativePath ? file.webkitRelativePath.split('/').filter(Boolean).slice(1) : [file.name];
      if (pathParts.length === 0) { processed++; onProgress?.(processed, fileArray.length); continue; }
      let current = structure;
      for (let i = 0; i < pathParts.length - 1; i++) {
        const folderName = pathParts[i];
        if (!current[folderName] || typeof current[folderName] !== 'object') current[folderName] = {};
        current = current[folderName];
      }
      const fileName = pathParts[pathParts.length - 1];
      try {
        if (needsETL(file)) {
          current[fileName] = null;
          etlFiles.push(file);
          setImportMessage(`Found ${fileName} for processing...`);
        } else {
          const isText = await isTextFileType(file);
          if (isText) current[fileName] = sanitizeUnicode(await file.text());
          else current[fileName] = null;
        }
      } catch (err) { current[fileName] = null; }
      processed++;
      onProgress?.(processed, fileArray.length);
    }
    return { structure, etlFiles };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      setLoading(true);
      if (mode === 'edit' && tableId) {
        await updateTable(projectId || '', tableId, name.trim());
        await refreshProjects();
        onClose();
      } else if (startOption === 'documents' && selectedFiles && selectedFiles.length > 0) {
        setImportMessage('Preparing files...');
        const finalName = name.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
        const { structure, etlFiles } = await parseFolderStructure(selectedFiles);
        setImportMessage('Creating context...');
        const newTable = await createTable(
          projectId,
          finalName,
          structure,
          parentId
        );
        const newTableId = newTable.id;
        if (etlFiles.length > 0 && projectId) {
          const placeholderTasks = etlFiles.map((file, index) => ({
            taskId: -(Date.now() + index),
            projectId: projectId,
            tableId: String(newTableId),
            tableName: finalName,
            filename: file.name,
            status: 'pending' as const,
          }));
          addPendingTasks(placeholderTasks);
        }
        await refreshProjects();
        onClose();
        if (etlFiles.length > 0 && projectId && session?.access_token && newTableId) {
          const filenameMap = new Map<string, string>();
          etlFiles.forEach(f => {
            filenameMap.set(f.name, f.name);
            if (f.webkitRelativePath) filenameMap.set(f.webkitRelativePath, f.name);
          });
          setTimeout(async () => {
            try {
              const response = await uploadAndSubmit({ projectId: Number(projectId), files: etlFiles, nodeId: String(newTableId), jsonPath: '' }, session.access_token);
              const realTasks = response.items.filter(item => item.status !== 'failed').map(item => ({
                taskId: item.task_id, projectId: projectId, tableId: String(newTableId), tableName: finalName, filename: filenameMap.get(item.filename) || item.filename, status: 'pending' as const,
              }));
              if (realTasks.length > 0) replacePlaceholderTasks(String(newTableId), realTasks);
              const failedFiles = response.items.filter(item => item.status === 'failed');
              if (failedFiles.length > 0) {
                const failedFileNames = failedFiles.map(f => filenameMap.get(f.filename) || f.filename);
                removeFailedPlaceholders(String(newTableId), failedFileNames);
              }
            } catch (etlError) { removeAllPlaceholdersForTable(String(newTableId)); }
          }, 100);
        }
        return;
      } else {
        await createTable(projectId, name.trim(), [], parentId);
        await refreshProjects();
        onClose();
      }
    } catch (error) {
      console.error('Failed to save table:', error);
      alert('Operation failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setLoading(false);
      setIsImporting(false);
      setImportProgress(0);
      setImportMessage('');
    }
  };

  const handleDelete = async () => {
    if (!tableId) return;
    try {
      setLoading(true);
      await deleteTable(projectId || '', tableId);
      await refreshProjects();
      onClose();
    } catch (error) {
      alert('Delete failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  // Title logic
  const getDialogTitle = () => {
    if (mode === 'delete') return 'Delete Context';
    if (mode === 'edit') return 'Edit Context';
    switch (startOption) {
      case 'empty': return 'Create JSON Context';
      case 'documents': return 'Import from Files';
      case 'url': return 'Import from Web';
      case 'connect': return 'Connect Data Source';
      default: return 'Create Context';
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        backdropFilter: 'blur(2px)'
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#1C1C1E',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12,
          width: 520, // Slightly simpler width
          maxWidth: '90vw',
          boxShadow: '0 24px 48px rgba(0,0,0,0.4), 0 12px 24px rgba(0,0,0,0.4)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          animation: 'dialog-fade-in 0.2s ease-out',
        }}
        onClick={e => e.stopPropagation()}
      >
        <style jsx>{`
          @keyframes dialog-fade-in {
            from { opacity: 0; transform: scale(0.98); }
            to { opacity: 1; transform: scale(1); }
          }
          input::placeholder { color: #525252; }
        `}</style>

        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 500, color: '#E4E4E7' }}>
            {getDialogTitle()}
          </h2>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: '#71717A',
            cursor: 'pointer', padding: 4, display: 'flex', borderRadius: 4,
            transition: 'color 0.15s, background 0.15s'
          }}
          onMouseEnter={e => {
            e.currentTarget.style.color = '#E4E4E7';
            e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color = '#71717A';
            e.currentTarget.style.background = 'transparent';
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {mode === 'delete' ? (
          <div style={{ padding: 24 }}>
            <p style={{ color: '#A1A1AA', fontSize: 13, lineHeight: 1.6, margin: '0 0 24px' }}>
              Are you sure you want to delete <strong style={{ color: '#E4E4E7' }}>{table?.name}</strong>? This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={buttonStyle(false)}>Cancel</button>
              <button onClick={handleDelete} disabled={loading} style={buttonStyle(true, true)}>
                {loading ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
              
              {/* CONTENT BASED ON START OPTION */}
              
              {startOption === 'empty' && (
                <div>
                  <label style={labelStyle}>Name</label>
                  <input
                    type='text'
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder='e.g. User Configuration'
                    style={inputStyle}
                    autoFocus
                  />
                </div>
              )}

              {startOption === 'documents' && (
                <>
                  <input
                    ref={fileInputRef}
                    type='file'
                    {...({ webkitdirectory: '', directory: '' } as any)}
                    multiple
                    onChange={handleFileSelect}
                    style={{ display: 'none' }}
                  />
                  
                  {isImporting ? (
                    <div style={{ padding: '24px', textAlign: 'center', background: '#27272A', borderRadius: 8, border: '1px solid #3F3F46' }}>
                      <div style={{ fontSize: 13, color: '#A1A1AA', marginBottom: 12 }}>{importMessage} {Math.round(importProgress)}%</div>
                      <div style={{ height: 4, background: '#3F3F46', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ width: `${importProgress}%`, height: '100%', background: '#10B981', transition: 'width 0.2s' }} />
                      </div>
                    </div>
                  ) : selectedFiles && selectedFiles.length > 0 ? (
                    <div style={{ border: '1px solid #3F3F46', borderRadius: 8, background: '#27272A', overflow: 'hidden' }}>
                      <div style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #3F3F46', background: 'rgba(255,255,255,0.02)' }}>
                         <span style={{ fontSize: 12, color: '#A1A1AA' }}>{selectedFiles.length} files selected</span>
                         <button type="button" onClick={() => { setSelectedFiles(null); setName(''); }} style={{ background: 'none', border: 'none', color: '#A1A1AA', fontSize: 12, cursor: 'pointer', padding: '2px 6px' }}>Clear</button>
                      </div>
                      <div style={{ maxHeight: 180, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {Array.from(selectedFiles).slice(0, 5).map((file, i) => (
                           <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.03)' }}>
                              <span style={{ fontSize: 13, color: '#E4E4E7', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
                              <span style={{ fontSize: 11, color: '#71717A', marginLeft: 'auto', whiteSpace: 'nowrap' }}>{(file.size/1024).toFixed(0)}KB</span>
                           </div>
                        ))}
                        {selectedFiles.length > 5 && <div style={{ fontSize: 11, color: '#71717A', textAlign: 'center', padding: 4 }}>+{selectedFiles.length - 5} more</div>}
                      </div>
                    </div>
                  ) : (
                    <div
                      ref={dropzoneRef}
                      onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        padding: '32px 24px',
                        border: '1px dashed',
                        borderColor: isDragging ? '#3B82F6' : '#3F3F46',
                        borderRadius: 8,
                        background: isDragging ? 'rgba(59,130,246,0.1)' : '#27272A',
                        cursor: 'pointer',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                        transition: 'all 0.15s'
                      }}
                    >
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={isDragging ? '#3B82F6' : '#71717A'} strokeWidth="1.5">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="17 8 12 3 7 8"></polyline>
                        <line x1="12" y1="3" x2="12" y2="15"></line>
                      </svg>
                      <div style={{ fontSize: 13, color: '#E4E4E7' }}>Drop files here or click to upload</div>
                      <div style={{ fontSize: 12, color: '#71717A' }}>Supports PDF, MD, CSV, JSON</div>
                    </div>
                  )}

                  {selectedFiles && selectedFiles.length > 0 && (
                     <div>
                        <label style={labelStyle}>Name</label>
                        <input type='text' value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
                     </div>
                  )}
                </>
              )}

              {startOption === 'url' && (
                <>
                  <div>
                    <label style={labelStyle}>URL</label>
                    <input
                      type='text'
                      placeholder='https://...'
                      value={urlInput}
                      onChange={e => setUrlInput(e.target.value)}
                      style={inputStyle}
                      autoFocus
                    />
                  </div>
                  <CrawlOptionsPanel url={urlInput} options={crawlOptions} onChange={setCrawlOptions} />
                  {urlInput.trim() && (
                    <div>
                      <label style={labelStyle}>Name</label>
                      <input type='text' value={name} onChange={e => setName(e.target.value)} placeholder='e.g. Website Content' style={inputStyle} />
                    </div>
                  )}
                </>
              )}

              {startOption === 'connect' && (
                <>
                  <div>
                     <label style={labelStyle}>Connector URL</label>
                     <div style={{ display: 'flex', gap: 8 }}>
                       <input
                         type='text'
                         placeholder='https://notion.so/...'
                         value={connectUrlInput}
                         onChange={e => setConnectUrlInput(e.target.value)}
                         onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleConnectParse(); } }}
                         style={{ ...inputStyle, flex: 1 }}
                         autoFocus
                       />
                       <button
                         type='button'
                         onClick={() => void handleConnectParse()}
                         disabled={connectLoading || !connectUrlInput.trim()}
                         style={{
                           ...buttonStyle(false),
                           opacity: connectLoading || !connectUrlInput.trim() ? 0.5 : 1
                         }}
                       >
                         {connectLoading ? 'Parsing...' : 'Parse'}
                       </button>
                     </div>
                  </div>

                  {connectStatusMeta && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: connectStatusMeta.color }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: connectStatusMeta.color }}></span>
                      {connectStatusMeta.label}
                    </div>
                  )}

                  {connectParseResult && (
                    <div style={{ padding: 12, background: '#27272A', borderRadius: 8, border: '1px solid #3F3F46', display: 'flex', flexDirection: 'column', gap: 12 }}>
                       <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#A1A1AA' }}>
                          <span>{connectParseResult.source_type}</span>
                          <span>{connectParseResult.total_items} items</span>
                       </div>
                       <div>
                          <label style={labelStyle}>Name</label>
                          <input type='text' value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
                       </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            <div style={{
              padding: '16px 20px',
              borderTop: '1px solid rgba(255,255,255,0.06)',
              display: 'flex', justifyContent: 'flex-end', gap: 10,
              background: '#1C1C1E',
            }}>
              <button type='button' onClick={onClose} style={buttonStyle(false)}>Cancel</button>
              <button
                type={startOption === 'url' || startOption === 'connect' ? 'button' : 'submit'}
                onClick={
                  startOption === 'url' ? (urlInput.trim() ? () => setShowImportModal(true) : undefined) :
                  startOption === 'connect' ? (connectParseResult ? () => void handleConnectImport() : undefined) :
                  undefined
                }
                disabled={
                  loading || isImporting || connectImporting ||
                  (startOption === 'empty' && !name.trim()) ||
                  (startOption === 'documents' && (!selectedFiles || selectedFiles.length === 0 || !name.trim())) ||
                  (startOption === 'url' && !urlInput.trim()) ||
                  (startOption === 'connect' && !connectParseResult)
                }
                style={buttonStyle(true)}
              >
                {mode === 'edit' ? 'Save Changes' : 'Create'}
              </button>
            </div>
          </form>
        )}
      </div>
      
      {showImportModal && projectId && (
        <ImportModal
          visible={showImportModal}
          projectId={Number(projectId)}
          mode='create_table'
          tableName={name || 'Imported Content'}
          initialUrl={urlInput}
          initialCrawlOptions={crawlOptions}
          onClose={() => { setShowImportModal(false); setUrlInput(''); }}
          onSuccess={() => { setShowImportModal(false); setUrlInput(''); refreshProjects(); onClose(); }}
        />
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: '#A1A1AA',
  marginBottom: 8,
  display: 'block'
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 32,
  padding: '0 12px',
  background: '#27272A',
  border: '1px solid #3F3F46',
  borderRadius: 6,
  color: '#E4E4E7',
  fontSize: 13,
  outline: 'none',
  transition: 'border-color 0.15s',
  boxSizing: 'border-box'
};

const buttonStyle = (primary: boolean, danger = false): React.CSSProperties => ({
  height: '28px',
  padding: '0 12px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 6,
  border: '1px solid transparent',
  background: danger ? 'rgba(239,68,68,0.15)' : primary ? '#E4E4E7' : 'transparent',
  color: danger ? '#ef4444' : primary ? '#18181B' : '#A1A1AA',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'all 0.15s',
});
