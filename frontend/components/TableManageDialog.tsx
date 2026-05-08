'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  resolveDataTransferSnapshot,
  snapshotDataTransfer,
} from '@/lib/dropFiles';
import type { ProjectInfo } from '../lib/projectsApi';
import { updateTable, deleteTable } from '../lib/projectsApi';
import { refreshProjects } from '../lib/hooks/useData';
import { useOrganization } from '@/contexts/OrganizationContext';
import { useAuth } from '../app/supabase/SupabaseAuthProvider';
import { ImportModal } from './editors/table/components/ImportModal';
import { uploadFiles } from '../lib/uploadApi';
import { Dots } from './loading';
import {
  addPendingTasks,
  updateTaskStatusById,
  updateTaskProgress,
  replaceTaskId,
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
  const { currentOrg } = useOrganization();
  const project = projectId ? projects.find(p => p.id === projectId) : null;
  const table = tableId && project ? project.nodes.find(t => t.id === tableId) : null;

  const [name, setName] = useState(table?.name || '');
  const [loading, setLoading] = useState(false);
  const [startOption] = useState<StartOption>(defaultStartOption);
  const [isDragging, setIsDragging] = useState(false);
  // ``File[]`` rather than ``FileList`` — folder drops produce
  // synthesized File arrays (the entry-walker can't return a real
  // FileList) and we want one shape for both code paths.
  const [selectedFiles, setSelectedFiles] = useState<File[] | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [crawlOptions, setCrawlOptions] = useState<CrawlOptions>({
    limit: 50,
    maxDepth: 3,
    crawlEntireDomain: true,
    sitemap: 'include',
  });
  // Import mode is fixed at 'raw' for now — the OCR / Smart Parse
  // pipeline is paused on the backend (see `config.ENABLE_OCR`).
  // We deliberately keep no state for this so the picker UI can't
  // be revived by accident; reintroducing the choice is a single
  // local refactor when the backend pipeline comes back online.

  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
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

  // Reusable: pick a sensible Context name from the first file's
  // path. For folder drops we want the FOLDER name, not the first
  // file inside it; for plain file drops we strip the extension.
  const inferNameFromFiles = useCallback(
    (files: File[]) => {
      if (name.trim()) return;
      const firstFile = files[0];
      if (!firstFile) return;
      if (firstFile.webkitRelativePath) {
        const folderName = firstFile.webkitRelativePath.split('/')[0];
        setName(folderName);
      } else {
        const fn = firstFile.name;
        setName(fn.substring(0, fn.lastIndexOf('.')) || fn);
      }
    },
    [name],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      // Snapshot synchronously: see lib/dropFiles.ts. Without this,
      // dragging a folder produces "1 file, 0 KB" instead of
      // walking into its contents.
      const snapshot = snapshotDataTransfer(e.nativeEvent);
      void resolveDataTransferSnapshot(snapshot).then((files) => {
        if (files.length === 0) return;
        setSelectedFiles(files);
        inferNameFromFiles(files);
      });
    },
    [inferNameFromFiles],
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files);
      setSelectedFiles(files);
      inferNameFromFiles(files);
    }
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    
    // Direct submit with current config
    await handleFinalSubmit();
  };

  const handleFinalSubmit = async () => {
    try {
      setLoading(true);

      if (mode === 'edit' && tableId) {
        await updateTable(projectId || '', tableId, name.trim());
        await refreshProjects(currentOrg?.id);
        onClose();
        return;
      }

      if (startOption === 'documents' && selectedFiles && selectedFiles.length > 0) {
        if (!projectId || !session?.access_token) {
          throw new Error('Missing project ID or auth');
        }

        const files = Array.from(selectedFiles);
        // ``parentId`` here is actually the parent MUT path (the
        // explorer passes its current folder path through this prop;
        // the name is a holdover from the legacy `parent_id` field).
        // We treat empty string as "root".
        const parentPath = (parentId || '').trim();

        // Optimistic refresh while we kick off the upload. The
        // authoritative refresh happens AFTER the worker writes the
        // file into MUT (driven by the BackgroundTaskNotifier
        // ``etl-task-completed`` event listener elsewhere in the
        // app, plus an explicit refresh below for snappier UX).
        await refreshProjects(currentOrg?.id);
        onClose();

        // Direct-to-S3 upload pipeline. We don't await this — the
        // dialog has already closed and the user follows progress
        // via TaskStatusWidget. Errors are surfaced into the widget
        // through ``onTaskFailed``; we only need a top-level catch
        // for unexpected issues (e.g. the init call failing before
        // any task IDs were created).
        //
        // Why background instead of awaited:
        //   - User wants to keep working while the upload runs
        //   - Multipart uploads of GB-scale files take minutes
        //   - The widget owns progress UX from here
        (async () => {
          const placeholderIds: string[] = [];
          try {
            await uploadFiles(
              {
                projectId,
                files,
                parentPath: parentPath || null,
              },
              session!.access_token,
              {
                // Spawn placeholder rows the instant the dialog
                // closes — without this the widget stays empty for
                // the 2–5s init takes on a cold backend.
                onUploadStart: (entries) => {
                  entries.forEach((f) => {
                    const tmpId = `tmp-${crypto.randomUUID()}`;
                    placeholderIds[f.fileIndex] = tmpId;
                  });
                  addPendingTasks(
                    entries.map((f) => ({
                      taskId: placeholderIds[f.fileIndex],
                      projectId,
                      tableId: undefined,
                      tableName: f.filename,
                      filename: f.filename,
                      status: 'uploading',
                    })),
                  );
                },
                onTaskCreated: ({ fileIndex, taskId }) => {
                  const tmpId = placeholderIds[fileIndex];
                  if (tmpId) {
                    replaceTaskId(tmpId, taskId);
                    placeholderIds[fileIndex] = taskId;
                  }
                },
                onProgress: (taskId, _loaded, _total, percent) => {
                  updateTaskProgress(taskId, percent);
                },
                onAllPartsUploaded: (taskId) => {
                  // Bytes are in S3 — server is now writing into MUT.
                  // ``finalizing`` keeps the row visibly active so it
                  // doesn't read as "Uploading 100%" frozen.
                  updateTaskStatusById(taskId, 'finalizing');
                },
                onTaskCompleted: (taskId) => {
                  // Inline finalize: /upload/complete returns 200
                  // only after MUT has the bytes, so the task is
                  // already COMPLETED in the DB.
                  updateTaskStatusById(taskId, 'completed');
                },
                onTaskFailed: (taskId, error) => {
                  updateTaskStatusById(taskId, 'failed', { error });
                },
              },
            );
          } catch (uploadError) {
            // /upload/init failed — flip every placeholder to
            // ``failed`` so the widget surfaces a stable terminal
            // state instead of leaving uploading rows orphaned.
            const errMsg =
              uploadError instanceof Error
                ? uploadError.message
                : String(uploadError);
            placeholderIds.forEach((id) => {
              if (id) updateTaskStatusById(id, 'failed', { error: errMsg });
            });
            console.error('Direct-to-S3 upload init failed:', uploadError);
          } finally {
            // Refresh once the upload pipeline returns — most of the
            // time the worker hasn't written to MUT yet, so this is
            // a cosmetic refresh; the BackgroundTaskNotifier will
            // emit ``projects-refresh`` once the worker actually
            // completes, which kicks the tree to update for real.
            await refreshProjects(currentOrg?.id);
          }
        })();

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
      await refreshProjects(currentOrg?.id);
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
              <button onClick={handleDelete} disabled={loading} style={{ ...buttonStyle(true, true), display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                {loading && <Dots size="xs" tone="danger" />}
                {loading ? 'Deleting…' : 'Delete'}
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
                    multiple
                    onChange={handleFileSelect}
                    style={{ display: 'none' }}
                  />
                  <input
                    ref={folderInputRef}
                    type='file'
                    {...({ webkitdirectory: '', directory: '' } as any)}
                    multiple
                    onChange={handleFileSelect}
                    style={{ display: 'none' }}
                  />
                  
                  {selectedFiles && selectedFiles.length > 0 ? (
                    <div
                      style={{
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: 8,
                        background: '#18181B',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          padding: '8px 12px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          borderBottom: '1px solid rgba(255,255,255,0.06)',
                        }}
                      >
                        <span style={{ fontSize: 12, color: '#A1A1AA' }}>
                          {selectedFiles.length} file{selectedFiles.length === 1 ? '' : 's'} selected
                        </span>
                        <button
                          type='button'
                          onClick={() => {
                            setSelectedFiles(null);
                            setName('');
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#71717A',
                            fontSize: 12,
                            cursor: 'pointer',
                            padding: '2px 6px',
                            borderRadius: 4,
                            transition: 'color 0.12s, background 0.12s',
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.color = '#E4E4E7';
                            e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.color = '#71717A';
                            e.currentTarget.style.background = 'transparent';
                          }}
                        >
                          Clear
                        </button>
                      </div>
                      <div
                        style={{
                          maxHeight: 180,
                          overflowY: 'auto',
                          padding: '6px 8px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 2,
                        }}
                      >
                        {Array.from(selectedFiles)
                          .slice(0, 5)
                          .map((file, i) => (
                            <div
                              key={i}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                padding: '6px 8px',
                                borderRadius: 4,
                              }}
                            >
                              {/*
                                Filename was rendered at 16px, which
                                fought with the rest of the product's
                                13px content scale and made the file
                                list look like a different surface.
                                Dropped to 13px for parity.
                              */}
                              <span
                                style={{
                                  fontSize: 13,
                                  color: '#E4E4E7',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                  flex: 1,
                                  minWidth: 0,
                                }}
                              >
                                {file.name}
                              </span>
                              <span
                                style={{
                                  fontSize: 11,
                                  color: '#71717A',
                                  whiteSpace: 'nowrap',
                                  flexShrink: 0,
                                }}
                              >
                                {(file.size / 1024).toFixed(0)} KB
                              </span>
                            </div>
                          ))}
                        {selectedFiles.length > 5 && (
                          <div
                            style={{
                              fontSize: 11,
                              color: '#71717A',
                              textAlign: 'center',
                              padding: 4,
                            }}
                          >
                            + {selectedFiles.length - 5} more
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div
                      ref={dropzoneRef}
                      onDragEnter={handleDragEnter}
                      onDragLeave={handleDragLeave}
                      onDragOver={handleDragOver}
                      onDrop={handleDrop}
                      style={{
                        padding: '28px 20px',
                        border: '1px dashed',
                        borderColor: isDragging ? '#60A5FA' : 'rgba(255,255,255,0.14)',
                        borderRadius: 8,
                        // No solid fill — the dashed border alone
                        // signals "drop here", letting the dialog's
                        // own surface read through. The previous
                        // `#27272A` fill made the dropzone look like
                        // a separate panel slammed onto the dialog.
                        background: isDragging ? 'rgba(96,165,250,0.06)' : 'transparent',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 12,
                        transition: 'all 0.15s',
                      }}
                    >
                      <svg
                        width='22'
                        height='22'
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke={isDragging ? '#60A5FA' : '#71717A'}
                        strokeWidth='1.5'
                        strokeLinecap='round'
                        strokeLinejoin='round'
                      >
                        <path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'></path>
                        <polyline points='17 8 12 3 7 8'></polyline>
                        <line x1='12' y1='3' x2='12' y2='15'></line>
                      </svg>
                      <div style={{ fontSize: 13, color: '#A1A1AA', textAlign: 'center' }}>
                        Drag and drop files or folders here
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          type='button'
                          onClick={() => fileInputRef.current?.click()}
                          style={dropzoneActionButton}
                          onMouseEnter={e => {
                            e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.16)';
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.background = 'transparent';
                            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)';
                          }}
                        >
                          Upload Files
                        </button>
                        <button
                          type='button'
                          onClick={() => folderInputRef.current?.click()}
                          style={dropzoneActionButton}
                          onMouseEnter={e => {
                            e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.16)';
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.background = 'transparent';
                            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)';
                          }}
                        >
                          Upload Folder
                        </button>
                      </div>
                    </div>
                  )}

                  {selectedFiles && selectedFiles.length > 0 && (
                    <div>
                      <label style={labelStyle}>Context Name</label>
                      <input
                        type='text'
                        value={name}
                        onChange={e => setName(e.target.value)}
                        style={inputStyle}
                        placeholder='Enter a name for this context…'
                      />
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
                {mode === 'edit' ? 'Save Changes' : startOption === 'documents' ? 'Start Import' : 'Import'}
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
          onSuccess={() => { setShowImportModal(false); setUrlInput(''); refreshProjects(currentOrg?.id); onClose(); }}
        />
      )}

    </div>
  );
}

// Aligned with the rest of the product's tokens — section labels
// across the data explorer / access panel use this same uppercase
// 11px treatment ("ALL SCOPES IN THIS …", "CONNECT", "INTEGRATIONS").
// The dialog used to use 12px lower-case labels which read as a
// different design family.
const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: '#71717A',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: 8,
  display: 'block',
};

// Form-field styling matched to the menu / sidebar surfaces
// (#0e0e0e family). The previous version used a brighter
// `#27272A` fill that read as a sunken card on the dialog
// background and 16px text that towered over the explorer rows
// (13px) launching the dialog. 13px keeps the dialog visually
// at parity with everything else.
const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 32,
  padding: '0 12px',
  background: '#18181B',
  border: '1px solid rgba(255,255,255,0.10)',
  borderRadius: 6,
  color: '#E4E4E7',
  fontSize: 13,
  outline: 'none',
  transition: 'border-color 0.15s',
  boxSizing: 'border-box',
};

// Used inside the dropzone for `Upload Files` / `Upload Folder`.
// Lighter than the footer primary so the visual hierarchy stays
// "primary action lives in the footer" — the dropzone buttons are
// shortcut affordances, not the call-to-action.
const dropzoneActionButton: React.CSSProperties = {
  height: 30,
  padding: '0 14px',
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.10)',
  background: 'transparent',
  color: '#E4E4E7',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'background 0.15s, border-color 0.15s',
};

const buttonStyle = (primary: boolean, danger = false): React.CSSProperties => ({
  height: '32px',
  padding: '0 14px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 6,
  border: primary || danger ? '1px solid transparent' : '1px solid rgba(255,255,255,0.10)',
  background: danger ? 'rgba(239,68,68,0.15)' : primary ? '#E4E4E7' : 'transparent',
  color: danger ? '#ef4444' : primary ? '#18181B' : '#A1A1AA',
  // 13px keeps dialog buttons at the same scale as menu items,
  // tabs, and explorer rows. Was 16px which made the footer
  // dominate the dialog.
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'all 0.15s',
});
