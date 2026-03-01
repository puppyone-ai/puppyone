'use client';

import React, {
  useState,
  useCallback,
  CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import {
  submitImport,
  type CrawlOptions,
} from '../../../../lib/importApi';
import CrawlOptionsPanel from '../../../CrawlOptionsPanel';

interface ImportModalProps {
  visible: boolean;
  targetPath?: string; // Optional - only for path-level import
  currentValue?: any; // Optional - only for path-level import
  tableId?: number; // Optional - only for existing table import
  tableName?: string; // Optional - for new table creation
  projectId: number;
  mode?: 'create_table' | 'import_to_table'; // New: specify import mode
  initialUrl?: string; // Optional - auto-parse this URL on mount
  initialCrawlOptions?: CrawlOptions; // Optional - initial crawl options
  onClose: () => void;
  onSuccess: (newData: any) => void;
}

type ImportMode = 'add_to_existing' | 'replace_all' | 'keep_separate';

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.8)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
  } as CSSProperties,

  modal: {
    background: '#1a1a1e',
    border: '1px solid #333',
    borderRadius: 8,
    padding: 24,
    maxWidth: 600,
    width: '90%',
    maxHeight: '80vh',
    overflowY: 'auto',
    overflowX: 'hidden',
    fontFamily:
      "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  } as CSSProperties,

  header: {
    fontSize: 16,
    fontWeight: 600,
    color: '#CDCDCD',
    marginBottom: 8,
  } as CSSProperties,

  pathInfo: {
    fontSize: 12,
    color: '#8B8B8B',
    marginBottom: 20,
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  } as CSSProperties,

  label: {
    fontSize: 12,
    fontWeight: 500,
    color: '#CDCDCD',
    marginBottom: 8,
    display: 'block',
  } as CSSProperties,

  input: {
    width: '100%',
    background: '#0a0a0a',
    border: '1px solid #2a2a2a',
    borderRadius: 6,
    padding: '8px 12px',
    fontSize: 14,
    color: '#CDCDCD',
    outline: 'none',
    marginBottom: 16,
  } as CSSProperties,

  buttonRow: {
    display: 'flex',
    gap: 8,
    marginBottom: 16,
  } as CSSProperties,

  button: (disabled = false, primary = false): CSSProperties => ({
    flex: 1,
    background: disabled ? '#1a1a1a' : primary ? '#2a2a2a' : '#2a2a2a',
    border: primary ? '1px solid #404040' : '1px solid #3a3a3a',
    borderRadius: 6,
    padding: '8px 16px',
    fontSize: 14,
    color: disabled ? '#505050' : '#CDCDCD',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: primary ? 500 : 400,
  }),

  previewBox: {
    background: '#0a0a0a',
    border: '1px solid #2a2a2a',
    borderRadius: 6,
    padding: 12,
    marginBottom: 16,
    maxHeight: 200,
    overflow: 'auto',
    // Custom dark scrollbar
    scrollbarWidth: 'thin' as any,
    scrollbarColor: '#404040 #0a0a0a',
  } as CSSProperties,

  previewText: {
    fontSize: 11,
    color: '#CDCDCD',
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    whiteSpace: 'pre-wrap',
    margin: 0,
  } as CSSProperties,

  infoText: {
    fontSize: 12,
    color: '#8B8B8B',
    marginBottom: 12,
  } as CSSProperties,

  errorBox: {
    background: '#2a1a1a',
    border: '1px solid #4a2a2a',
    borderRadius: 6,
    padding: 12,
    marginBottom: 16,
  } as CSSProperties,

  errorText: {
    fontSize: 12,
    color: '#f87171',
  } as CSSProperties,

  strategySelector: {
    marginBottom: 16,
  } as CSSProperties,

  radioOption: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
    cursor: 'pointer',
  } as CSSProperties,

  radioLabel: {
    fontSize: 12,
    color: '#CDCDCD',
    cursor: 'pointer',
  } as CSSProperties,
};

export function ImportModal({
  visible,
  targetPath = '',
  currentValue = null,
  tableId,
  tableName = '',
  projectId,
  mode = 'import_to_table',
  initialUrl = '',
  initialCrawlOptions,
  onClose,
  onSuccess,
}: ImportModalProps) {
  const [url, setUrl] = useState(initialUrl);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [newTableName, setNewTableName] = useState(tableName);
  const [tableDescription, setTableDescription] = useState('');

  const [crawlOptions, setCrawlOptions] = useState<CrawlOptions>(
    initialCrawlOptions || {
      limit: 50,
      maxDepth: 3,
      crawlEntireDomain: true,
      sitemap: 'include',
    }
  );

  const handleImport = useCallback(async () => {
    if (!url.trim()) {
      setError('Please enter a URL');
      return;
    }

    if (mode === 'create_table' && !newTableName.trim()) {
      setError('Please enter a table name');
      return;
    }

    setIsImporting(true);
    setError(null);
    setNeedsAuth(false);

    try {
      const response = await submitImport({
        project_id: String(projectId),
        url: url.trim(),
        name: mode === 'create_table' ? newTableName.trim() : undefined,
        crawl_options: crawlOptions,
      });

      onSuccess({
        task_id: response.task_id,
        node_id: response.node_id,
        import_type: response.import_type,
      });
      onClose();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Import failed';
      setError(errorMessage);

      if (errorMessage.toLowerCase().includes('auth')) {
        setNeedsAuth(true);
      }
    } finally {
      setIsImporting(false);
    }
  }, [
    url,
    projectId,
    newTableName,
    crawlOptions,
    mode,
    onSuccess,
    onClose,
  ]);

  const handleGoToAuth = useCallback(() => {
    // Dispatch custom event for client-side navigation to connect view
    // This avoids full page reload which would cause 404
    window.dispatchEvent(new CustomEvent('navigateToConnect'));

    // Also update URL using pushState for consistency
    window.history.pushState({}, '', '/connect');

    // Close the modal
    onClose();
  }, [onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'Enter' && !isImporting && url.trim()) {
        handleImport();
      }
    },
    [isImporting, url, onClose, handleImport]
  );

  if (!visible) return null;

  return createPortal(
    <div style={styles.overlay} onClick={onClose}>
      <div
        style={styles.modal}
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div style={styles.header}>
          {mode === 'create_table'
            ? 'Create Table from URL'
            : 'Import Data from URL'}
        </div>

        <div style={{ fontSize: 11, color: '#8B8B8B', marginBottom: 16 }}>
          {mode === 'create_table'
            ? 'Create a new table with data from a URL'
            : 'Import data from a URL'}
        </div>

        {/* URL Input */}
        <label style={styles.label}>Data Source URL</label>
        <input
          type='url'
          value={url}
          onChange={e => setUrl(e.target.value)}
          placeholder='https://api.example.com/data.json or https://yourworkspace.notion.so/...'
          disabled={isImporting}
          style={styles.input}
          autoFocus
        />

        <CrawlOptionsPanel
          url={url}
          options={crawlOptions}
          onChange={setCrawlOptions}
        />

        {/* Create Table Mode - Table Name Input */}
        {mode === 'create_table' && (
          <div style={{ marginBottom: 16 }}>
            <label style={styles.label}>Table Name *</label>
            <input
              type='text'
              value={newTableName}
              onChange={e => setNewTableName(e.target.value)}
              placeholder='Enter table name...'
              disabled={isImporting}
              style={styles.input}
            />

            <label style={styles.label}>Description (Optional)</label>
            <input
              type='text'
              value={tableDescription}
              onChange={e => setTableDescription(e.target.value)}
              placeholder='Enter table description...'
              disabled={isImporting}
              style={styles.input}
            />
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div style={styles.errorBox}>
            <div style={styles.errorText}>{error}</div>
            {needsAuth && (
              <button
                onClick={handleGoToAuth}
                style={{
                  marginTop: 12,
                  padding: '8px 16px',
                  background: '#3b82f6',
                  border: 'none',
                  borderRadius: 6,
                  color: 'white',
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: 'pointer',
                  width: '100%',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = '#2563eb';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = '#3b82f6';
                }}
              >
                Go to Authorization
              </button>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div style={styles.buttonRow}>
          <button
            onClick={onClose}
            disabled={isImporting}
            style={styles.button(isImporting, false)}
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={isImporting || !url.trim()}
            style={styles.button(isImporting || !url.trim(), true)}
            onMouseEnter={e => {
              if (!isImporting && url.trim()) {
                e.currentTarget.style.background = '#353535';
              }
            }}
            onMouseLeave={e => {
              if (!isImporting && url.trim()) {
                e.currentTarget.style.background = '#2a2a2a';
              }
            }}
          >
            {isImporting
              ? mode === 'create_table'
                ? 'Creating...'
                : 'Importing...'
              : mode === 'create_table'
                ? 'Create Table'
                : 'Import'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default ImportModal;
