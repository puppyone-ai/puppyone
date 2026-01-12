'use client';

import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
  CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import {
  parseUrl,
  importData,
  type ParseUrlResponse,
  type CrawlOptions,
} from '../../../../lib/connectApi';
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
    fontSize: 13,
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
    fontSize: 13,
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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parseResult, setParseResult] = useState<ParseUrlResponse | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>('add_to_existing');
  const [needsAuth, setNeedsAuth] = useState(false);
  const [newTableName, setNewTableName] = useState(tableName);
  const [tableDescription, setTableDescription] = useState('');

  // Crawl options for web scraping
  const [crawlOptions, setCrawlOptions] = useState<CrawlOptions>(
    initialCrawlOptions || {
      limit: 50, // Reduced to avoid timeout
      maxDepth: 3,
      crawlEntireDomain: true,
      sitemap: 'include',
    }
  );

  // Track if we've already auto-parsed to prevent re-parsing
  const hasAutoParsed = useRef(false);

  const handleParse = useCallback(async () => {
    if (!url.trim()) {
      setError('Please enter a URL');
      return;
    }

    setIsLoading(true);
    setError(null);
    setParseResult(null);
    setNeedsAuth(false);

    try {
      const result = await parseUrl(url, crawlOptions);
      setParseResult(result);

      // Auto-fill table name if empty (for create_table mode)
      if (mode === 'create_table' && !newTableName.trim()) {
        const suggestedName =
          result.title || `${result.source_type}_data` || 'imported_data';
        setNewTableName(suggestedName);
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to parse URL';
      setError(errorMessage);

      // Check if it's an authentication error
      if (errorMessage.toLowerCase().includes('auth')) {
        setNeedsAuth(true);
      }
    } finally {
      setIsLoading(false);
    }
  }, [url, mode, newTableName, crawlOptions]);

  // Auto-parse initialUrl on mount (only once)
  useEffect(() => {
    if (initialUrl && visible && !hasAutoParsed.current) {
      hasAutoParsed.current = true;
      handleParse();
    }
  }, [initialUrl, visible]);

  // Reset the auto-parse flag when modal closes
  useEffect(() => {
    if (!visible) {
      hasAutoParsed.current = false;
    }
  }, [visible]);

  const handleImport = useCallback(async () => {
    if (!parseResult) return;

    // Validate for create_table mode
    if (mode === 'create_table' && !newTableName.trim()) {
      setError('Please enter a table name');
      return;
    }

    setIsImporting(true);
    setError(null);
    setNeedsAuth(false);

    try {
      const result = await importData({
        url: parseResult.url,
        project_id: projectId,
        table_id: mode === 'create_table' ? undefined : tableId,
        table_name: mode === 'create_table' ? newTableName.trim() : undefined,
        table_description:
          mode === 'create_table' ? tableDescription.trim() : undefined,
        import_mode: mode === 'import_to_table' ? importMode : undefined,
      });

      // Need to refresh table data after success
      // Backend has already updated the data, notify parent to refetch
      onSuccess(result);
      onClose();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Import failed';
      setError(errorMessage);

      // Check if it's an authentication error
      if (errorMessage.toLowerCase().includes('auth')) {
        setNeedsAuth(true);
      }
    } finally {
      setIsImporting(false);
    }
  }, [
    parseResult,
    projectId,
    tableId,
    newTableName,
    tableDescription,
    importMode,
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
      } else if (
        e.key === 'Enter' &&
        !isLoading &&
        url.trim() &&
        !parseResult
      ) {
        handleParse();
      }
    },
    [isLoading, url, parseResult, onClose, handleParse]
  );

  if (!visible) return null;

  // Detect current value type for smart suggestions
  const currentValueType =
    currentValue === null
      ? 'null'
      : Array.isArray(currentValue)
        ? 'array'
        : typeof currentValue === 'object'
          ? 'object'
          : typeof currentValue;

  // Generate preview text for each mode
  const getPreview = useCallback(
    (mode: ImportMode) => {
      if (!parseResult) return '';

      const importCount = parseResult.total_items;

      if (mode === 'add_to_existing') {
        if (currentValueType === 'null') {
          return `Will create new data with ${importCount} items`;
        } else if (currentValueType === 'array') {
          const currentCount = Array.isArray(currentValue)
            ? currentValue.length
            : 0;
          return `${currentCount} items → ${currentCount + importCount} items`;
        } else if (currentValueType === 'object') {
          const currentFields =
            typeof currentValue === 'object'
              ? Object.keys(currentValue).length
              : 0;
          return `Merge fields, preserve existing data`;
        } else {
          return `Convert to object and add data`;
        }
      } else if (mode === 'replace_all') {
        return `All data → ${importCount} new items`;
      } else {
        return `Store in: imports > [timestamp]`;
      }
    },
    [parseResult, currentValue, currentValueType]
  );

  return createPortal(
    <>
      {/* Custom scrollbar styles */}
      <style>{`
        .import-modal-preview::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        .import-modal-preview::-webkit-scrollbar-track {
          background: #0a0a0a;
          border-radius: 4px;
        }
        .import-modal-preview::-webkit-scrollbar-thumb {
          background: #404040;
          border-radius: 4px;
        }
        .import-modal-preview::-webkit-scrollbar-thumb:hover {
          background: #505050;
        }
      `}</style>
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
              : 'Import data into this table with intelligent merging'}
          </div>

          {/* URL Input - hide if auto-parsing from initialUrl */}
          {!initialUrl && (
            <>
              <label style={styles.label}>Data Source URL</label>
              <input
                type='url'
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder='https://api.example.com/data.json or https://yourworkspace.notion.so/...'
                disabled={isLoading || isImporting}
                style={styles.input}
                autoFocus
              />

              {/* Crawl Options Panel */}
              <CrawlOptionsPanel
                url={url}
                options={crawlOptions}
                onChange={setCrawlOptions}
              />

              {/* Parse Button */}
              <div style={styles.buttonRow}>
                <button
                  onClick={handleParse}
                  disabled={isLoading || isImporting || !url.trim()}
                  style={styles.button(
                    isLoading || isImporting || !url.trim(),
                    false
                  )}
                  onMouseEnter={e => {
                    if (!isLoading && !isImporting && url.trim()) {
                      e.currentTarget.style.background = '#353535';
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isLoading && !isImporting && url.trim()) {
                      e.currentTarget.style.background = '#2a2a2a';
                    }
                  }}
                >
                  {isLoading ? 'Parsing...' : 'Parse URL'}
                </button>
              </div>
            </>
          )}

          {/* Show URL info when auto-parsing */}
          {initialUrl && (
            <div
              style={{
                padding: '12px',
                background: '#0a0a0a',
                border: '1px solid #2a2a2a',
                borderRadius: 6,
                marginBottom: 16,
                fontSize: 12,
                color: '#9ca3af',
              }}
            >
              <div style={{ marginBottom: 4, fontSize: 11, color: '#666' }}>
                Source URL:
              </div>
              <div
                style={{
                  color: '#CDCDCD',
                  wordBreak: 'break-all',
                  fontFamily: 'ui-monospace, monospace',
                }}
              >
                {url}
              </div>
              {isLoading && (
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 11,
                    color: '#34d399',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <div
                    style={{
                      width: 12,
                      height: 12,
                      border: '2px solid #34d399',
                      borderTopColor: 'transparent',
                      borderRadius: '50%',
                      animation: 'spin 0.8s linear infinite',
                    }}
                  />
                  Parsing URL...
                </div>
              )}
            </div>
          )}

          <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>

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
                    fontSize: 13,
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
                  🔐 Go to Authorization
                </button>
              )}
            </div>
          )}

          {/* Data Preview */}
          {parseResult && (
            <>
              <div style={styles.infoText}>
                Found {parseResult.total_items} items ({parseResult.source_type}
                )
              </div>

              <label style={styles.label}>Data Preview</label>
              <div style={styles.previewBox} className='import-modal-preview'>
                <pre style={styles.previewText}>
                  {JSON.stringify(parseResult.sample_data, null, 2)}
                </pre>
              </div>

              {/* Create Table Mode - Table Name Input */}
              {mode === 'create_table' ? (
                <div style={{ marginBottom: 16 }}>
                  <label style={styles.label}>Table Name *</label>
                  <input
                    type='text'
                    value={newTableName}
                    onChange={e => setNewTableName(e.target.value)}
                    placeholder='Enter table name...'
                    style={styles.input}
                  />

                  <label style={styles.label}>Description (Optional)</label>
                  <input
                    type='text'
                    value={tableDescription}
                    onChange={e => setTableDescription(e.target.value)}
                    placeholder='Enter table description...'
                    style={styles.input}
                  />
                </div>
              ) : (
                /* Import to Existing Table Mode - Import Mode Selection */
                <div style={styles.strategySelector}>
                  <label style={styles.label}>How to import this data?</label>

                  <div style={{ marginBottom: 12 }}>
                    <label style={styles.radioOption}>
                      <input
                        type='radio'
                        name='mode'
                        value='add_to_existing'
                        checked={importMode === 'add_to_existing'}
                        onChange={e =>
                          setImportMode(e.target.value as ImportMode)
                        }
                      />
                      <div style={{ flex: 1 }}>
                        <span style={styles.radioLabel}>
                          ✨ Add to existing data (Recommended)
                        </span>
                        <div
                          style={{
                            fontSize: 10,
                            color: '#8B8B8B',
                            marginTop: 2,
                            marginLeft: 20,
                          }}
                        >
                          {getPreview('add_to_existing')}
                        </div>
                      </div>
                    </label>
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <label style={styles.radioOption}>
                      <input
                        type='radio'
                        name='mode'
                        value='replace_all'
                        checked={importMode === 'replace_all'}
                        onChange={e =>
                          setImportMode(e.target.value as ImportMode)
                        }
                      />
                      <div style={{ flex: 1 }}>
                        <span style={styles.radioLabel}>Replace all data</span>
                        <div
                          style={{
                            fontSize: 10,
                            color: '#f87171',
                            marginTop: 2,
                            marginLeft: 20,
                          }}
                        >
                          ⚠️ {getPreview('replace_all')}
                        </div>
                      </div>
                    </label>
                  </div>

                  <div style={{ marginBottom: 12 }}>
                    <label style={styles.radioOption}>
                      <input
                        type='radio'
                        name='mode'
                        value='keep_separate'
                        checked={importMode === 'keep_separate'}
                        onChange={e =>
                          setImportMode(e.target.value as ImportMode)
                        }
                      />
                      <div style={{ flex: 1 }}>
                        <span style={styles.radioLabel}>
                          Keep as separate import
                        </span>
                        <div
                          style={{
                            fontSize: 10,
                            color: '#8B8B8B',
                            marginTop: 2,
                            marginLeft: 20,
                          }}
                        >
                          ✓ {getPreview('keep_separate')}
                        </div>
                      </div>
                    </label>
                  </div>
                </div>
              )}

              {/* Import Button */}
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
                  disabled={isImporting}
                  style={styles.button(isImporting, true)}
                  onMouseEnter={e => {
                    if (!isImporting) {
                      e.currentTarget.style.background = '#353535';
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isImporting) {
                      e.currentTarget.style.background = '#2a2a2a';
                    }
                  }}
                >
                  {isImporting
                    ? mode === 'create_table'
                      ? 'Creating...'
                      : 'Importing...'
                    : mode === 'create_table'
                      ? `Create Table with ${parseResult.total_items} items`
                      : `Import ${parseResult.total_items} items`}
                </button>
              </div>
            </>
          )}

          {/* Cancel button if no parse result */}
          {!parseResult && !error && (
            <div style={styles.buttonRow}>
              <button onClick={onClose} style={styles.button(false, false)}>
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </>,
    document.body
  );
}

export default ImportModal;
