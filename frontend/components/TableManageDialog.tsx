'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ProjectInfo } from '../lib/projectsApi';
import { updateTable, deleteTable } from '../lib/projectsApi';
import { refreshProjects } from '../lib/hooks/useData';
import { useAuth } from '../app/supabase/SupabaseAuthProvider';
import { ImportModal } from './editors/table/components/ImportModal';
import { uploadAndSubmit, getETLHealth } from '../lib/etlApi';
import {
  addPendingTasks,
  replacePlaceholderTasks,
  removeFailedPlaceholders,
  removeAllPlaceholdersForTable,
} from './BackgroundTaskNotifier';
import { type CrawlOptions } from '../lib/importApi';
import CrawlOptionsPanel from './CrawlOptionsPanel';

type StartOption = 'documents' | 'url';
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

export function TableManageDialog({
  mode,
  projectId,
  tableId,
  parentId = null,
  projects,
  onClose,
  onModeChange,
  defaultStartOption = 'documents',
}: TableManageDialogProps) {
  const { session } = useAuth();
  const project = projectId ? projects.find(p => p.id === projectId) : null;
  const table = tableId && project ? project.nodes.find(t => t.id === tableId) : null;

  const [name, setName] = useState(table?.name || '');
  const [loading, setLoading] = useState(false);
  const [startOption] = useState<StartOption>(defaultStartOption);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [crawlOptions, setCrawlOptions] = useState<CrawlOptions>({
    limit: 50,
    maxDepth: 3,
    crawlEntireDomain: true,
    sitemap: 'include',
  });
  const [importMode, setImportMode] = useState<'smart' | 'raw' | 'structured'>('smart');
  const [workerOnline, setWorkerOnline] = useState<boolean | null>(null);
  const [checkingWorker, setCheckingWorker] = useState(false);

  // File stats for smart mode detection
  const fileStats = useRef({ textCount: 0, binaryCount: 0 });

  useEffect(() => {
    if (startOption === 'documents' && selectedFiles && selectedFiles.length > 0) {
      let textCount = 0;
      let binaryCount = 0;
      const textExts = new Set([
        'txt', 'md', 'json', 'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'html', 'css', 'xml', 'yaml', 'yml', 'csv'
      ]);

      Array.from(selectedFiles).forEach(f => {
        const ext = f.name.split('.').pop()?.toLowerCase() || '';
        if (textExts.has(ext)) {
          textCount++;
        } else {
          binaryCount++;
        }
      });
      
      fileStats.current = { textCount, binaryCount };

      // Check worker health if binary files exist
      if (binaryCount > 0) {
        setCheckingWorker(true);
        getETLHealth()
          .then(health => {
            const isOnline = health.file_worker.worker_count > 0;
            setWorkerOnline(isOnline);
            if (!isOnline) setImportMode('raw');
          })
          .catch(() => {
            setWorkerOnline(false);
            setImportMode('raw');
          })
          .finally(() => setCheckingWorker(false));
      } else {
        setWorkerOnline(true); // Assuming ok if only text files
      }
    }
  }, [selectedFiles, startOption]);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropzoneRef = useRef<HTMLDivElement>(null);

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


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    
    // Direct submit with current config
    await handleFinalSubmit();
  };

  const handleFinalSubmit = async (overrideMode?: 'smart' | 'raw' | 'structured') => {
    try {
      setLoading(true);
      const effectiveMode = overrideMode || importMode;

      if (mode === 'edit' && tableId) {
        await updateTable(projectId || '', tableId, name.trim());
        await refreshProjects();
        onClose();
        return;
      }

      if (startOption === 'documents' && selectedFiles && selectedFiles.length > 0) {
        if (!projectId || !session?.access_token) {
          throw new Error('Missing project ID or auth');
        }

        const backendMode = effectiveMode === 'smart' ? 'ocr_parse' : 'raw';
        const files = Array.from(selectedFiles);

        const baseTimestamp = Date.now();
        const placeholderGroupId = `upload-${baseTimestamp}`;
        const placeholderTasks = files.map((file, index) => ({
          taskId: `placeholder-${baseTimestamp}-${index}-${Math.random().toString(36).slice(2, 8)}`,
          projectId: projectId,
          tableId: placeholderGroupId,
          tableName: file.name,
          filename: file.name,
          status: 'pending' as const,
        }));
        addPendingTasks(placeholderTasks);

        await refreshProjects();
        onClose();

        setTimeout(async () => {
          try {
            const response = await uploadAndSubmit(
              { projectId, files, mode: backendMode, parentId: parentId || undefined },
              session!.access_token
            );

            const realTasks = response.items
              .filter(item => item.status !== 'failed')
              .map(item => ({
                taskId: String(item.task_id),
                projectId: projectId,
                tableId: placeholderGroupId,
                tableName: item.filename!,
                filename: item.filename!,
                status: (item.status === 'completed' ? 'completed' : 'pending') as any,
              }));

            if (realTasks.length > 0) {
              replacePlaceholderTasks(placeholderGroupId, realTasks);
            }

            const failedFiles = response.items.filter(item => item.status === 'failed');
            if (failedFiles.length > 0) {
              console.warn('Some files failed:', failedFiles);
              removeFailedPlaceholders(placeholderGroupId, failedFiles.map(f => f.filename!));
            }
          } catch (etlError) {
            console.error('File upload failed:', etlError);
            removeAllPlaceholdersForTable(placeholderGroupId);
          }
        }, 100);

        return;
      }
    } catch (error) {
      console.error('Failed to save table:', error);
      alert('Operation failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setLoading(false);
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
    return startOption === 'documents' ? 'Import from Files' : 'Import from Web';
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
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 500, color: '#E4E4E7' }}>
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
            <p style={{ color: '#A1A1AA', fontSize: 16, lineHeight: 1.6, margin: '0 0 24px' }}>
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
                  
                  {selectedFiles && selectedFiles.length > 0 ? (
                    <div style={{ border: '1px solid #3F3F46', borderRadius: 8, background: '#27272A', overflow: 'hidden' }}>
                      <div style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #3F3F46', background: 'rgba(255,255,255,0.02)' }}>
                         <span style={{ fontSize: 12, color: '#A1A1AA' }}>{selectedFiles.length} files selected</span>
                         <button type="button" onClick={() => { setSelectedFiles(null); setName(''); }} style={{ background: 'none', border: 'none', color: '#A1A1AA', fontSize: 12, cursor: 'pointer', padding: '2px 6px' }}>Clear</button>
                      </div>
                      <div style={{ maxHeight: 180, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {Array.from(selectedFiles).slice(0, 5).map((file, i) => (
                           <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.03)' }}>
                              <span style={{ fontSize: 16, color: '#E4E4E7', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
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
                      <div style={{ fontSize: 16, color: '#E4E4E7' }}>Drop files here or click to upload</div>
                      <div style={{ fontSize: 12, color: '#71717A' }}>Supports PDF, MD, CSV, JSON</div>
                    </div>
                  )}

                  {selectedFiles && selectedFiles.length > 0 && (
                     <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {/* Name Input */}
                     <div>
                           <label style={{ ...labelStyle, marginBottom: 6 }}>Context Name</label>
                           <input 
                             type='text' 
                             value={name} 
                             onChange={e => setName(e.target.value)} 
                             style={{ ...inputStyle, height: 36 }} 
                             placeholder="Enter a name for this context..."
                           />
                        </div>

                        {/* Mode Selection UI - Action Buttons Grid */}
                        <div>
                          <label style={{ ...labelStyle, marginBottom: 8 }}>Import Method</label>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                            
                            {/* Raw Storage Action */}
                            <button
                              type="button"
                              onClick={() => setImportMode('raw')}
                              disabled={loading || !name.trim()}
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: '16px 12px',
                                borderRadius: 8,
                                border: importMode === 'raw' ? '1px solid #E4E4E7' : '1px solid #3F3F46',
                                background: importMode === 'raw' ? 'rgba(255,255,255,0.05)' : '#27272A',
                                cursor: (loading || !name.trim()) ? 'not-allowed' : 'pointer',
                                opacity: (loading || !name.trim()) ? 0.5 : 1,
                                transition: 'all 0.15s',
                                textAlign: 'center',
                                height: 'auto',
                                minHeight: 90
                              }}
                              onMouseEnter={e => {
                                if (!(loading || !name.trim())) {
                                  if (importMode !== 'raw') {
                                    e.currentTarget.style.background = '#3F3F46';
                                    e.currentTarget.style.borderColor = '#52525B';
                                  }
                                }
                              }}
                              onMouseLeave={e => {
                                if (importMode !== 'raw') {
                                  e.currentTarget.style.background = '#27272A';
                                  e.currentTarget.style.borderColor = '#3F3F46';
                                }
                              }}
                            >
                              <div style={{ color: importMode === 'raw' ? '#E4E4E7' : '#A1A1AA', marginBottom: 8 }}>
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                  <polyline points="17 8 12 3 7 8"></polyline>
                                  <line x1="12" y1="3" x2="12" y2="15"></line>
                                </svg>
                              </div>
                              <div style={{ fontWeight: 600, fontSize: 13, color: '#E4E4E7', marginBottom: 4 }}>Raw Storage</div>
                              <div style={{ fontSize: 11, color: '#71717A', lineHeight: 1.3 }}>
                                Store as-is. Faster, no OCR.
                              </div>
                            </button>

                            {/* Smart Parse Action */}
                            <button
                              type="button"
                              onClick={() => workerOnline !== false && setImportMode('smart')}
                              disabled={loading || workerOnline === false || !name.trim()}
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: '16px 12px',
                                borderRadius: 8,
                                border: importMode === 'smart' ? '1px solid #3B82F6' : '1px solid #3F3F46',
                                background: importMode === 'smart' ? 'rgba(59, 130, 246, 0.15)' : '#27272A',
                                cursor: (loading || workerOnline === false || !name.trim()) ? 'not-allowed' : 'pointer',
                                opacity: (loading || workerOnline === false || !name.trim()) ? 0.5 : 1,
                                transition: 'all 0.15s',
                                textAlign: 'center',
                                height: 'auto',
                                minHeight: 90,
                                position: 'relative'
                              }}
                              onMouseEnter={e => {
                                if (!(loading || workerOnline === false || !name.trim())) {
                                  if (importMode !== 'smart') {
                                    e.currentTarget.style.background = '#3F3F46';
                                    e.currentTarget.style.borderColor = '#52525B';
                                  }
                                }
                              }}
                              onMouseLeave={e => {
                                if (importMode !== 'smart') {
                                  e.currentTarget.style.background = '#27272A';
                                  e.currentTarget.style.borderColor = '#3F3F46';
                                }
                              }}
                            >
                              {/* Recommended Badge */}
                              <div style={{
                                position: 'absolute',
                                top: -8,
                                background: '#3B82F6',
                                color: 'white',
                                fontSize: 9,
                                fontWeight: 700,
                                padding: '2px 6px',
                                borderRadius: 10,
                                textTransform: 'uppercase',
                                letterSpacing: '0.05em'
                              }}>
                                Recommended
                              </div>

                              <div style={{ color: importMode === 'smart' ? '#60A5FA' : '#A1A1AA', marginBottom: 8 }}>
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                  <polyline points="14 2 14 8 20 8"></polyline>
                                  <line x1="16" y1="13" x2="8" y2="13"></line>
                                  <line x1="16" y1="17" x2="8" y2="17"></line>
                                  <polyline points="10 9 9 9 8 9"></polyline>
                                </svg>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                                <span style={{ fontWeight: 600, fontSize: 13, color: '#E4E4E7' }}>Smart Parse</span>
                                {workerOnline === false && (
                                  <span style={{ fontSize: 9, color: '#F87171', background: 'rgba(239,68,68,0.1)', padding: '1px 4px', borderRadius: 2 }}>
                                    Offline
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: 11, color: importMode === 'smart' ? '#93C5FD' : '#71717A', lineHeight: 1.3 }}>
                                OCR & AI structure. Best for chat.
                              </div>
                            </button>
                          </div>
                          
                          {/* Worker Status */}
                          {checkingWorker && (
                             <div style={{ marginTop: 8, fontSize: 11, color: '#71717A', display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                               <div style={{ width: 8, height: 8, borderRadius: '50%', border: '2px solid #71717A', borderTopColor: 'transparent', animation: 'spin 1s linear infinite' }}></div>
                               Checking service availability...
                             </div>
                          )}
                        </div>
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
                type={startOption === 'url' ? 'button' : 'submit'}
                onClick={
                  startOption === 'url' ? (urlInput.trim() ? () => setShowImportModal(true) : undefined) :
                  undefined
                }
                disabled={
                  loading ||
                  (startOption === 'documents' && (!selectedFiles || selectedFiles.length === 0 || !name.trim())) ||
                  (startOption === 'url' && !urlInput.trim())
                }
                style={buttonStyle(true)}
              >
                {mode === 'edit' ? 'Save Changes' : startOption === 'documents' ? (importMode === 'smart' ? 'Start Parse' : 'Start Import') : 'Import'}
              </button>
            </div>
          </form>
        )}
      </div>
      
      {showImportModal && projectId && (
        <ImportModal
          visible={showImportModal}
          projectId={projectId || ''}
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
  fontSize: 16,
  outline: 'none',
  transition: 'border-color 0.15s',
  boxSizing: 'border-box'
};

const buttonStyle = (primary: boolean, danger = false): React.CSSProperties => ({
  height: '32px',
  padding: '0 12px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 6,
  border: '1px solid transparent',
  background: danger ? 'rgba(239,68,68,0.15)' : primary ? '#E4E4E7' : 'transparent',
  color: danger ? '#ef4444' : primary ? '#18181B' : '#A1A1AA',
  fontSize: 16,
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'all 0.15s',
});
