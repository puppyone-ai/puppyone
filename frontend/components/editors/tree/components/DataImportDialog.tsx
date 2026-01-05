'use client';

import React, { useState, useRef, useEffect, CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { parseUrl } from '../../../../lib/connectApi';

interface DataImportDialogProps {
  visible: boolean;
  mode: 'url' | 'file';
  targetPath: string;
  currentValue: any;
  initialData?: any; // 预解析的数据（file 模式下使用）
  onClose: () => void;
  onSuccess: (data: any, strategy: 'merge' | 'replace') => void;
}

type Strategy = 'merge' | 'replace';

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
    fontFamily:
      "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  } as CSSProperties,

  header: {
    fontSize: 16,
    fontWeight: 600,
    color: '#CDCDCD',
    marginBottom: 8,
  } as CSSProperties,

  subHeader: {
    fontSize: 12,
    color: '#8B8B8B',
    marginBottom: 20,
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

  previewBox: {
    background: '#0a0a0a',
    border: '1px solid #2a2a2a',
    borderRadius: 6,
    padding: 12,
    marginBottom: 16,
    maxHeight: 200,
    overflow: 'auto',
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: 11,
    color: '#CDCDCD',
    whiteSpace: 'pre-wrap',
  } as CSSProperties,

  strategyOption: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    padding: 12,
    borderRadius: 6,
    border: '1px solid transparent',
    marginBottom: 8,
    cursor: 'pointer',
    background: '#2a2a2e',
  } as CSSProperties,

  strategyOptionSelected: {
    background: '#3b82f620',
    borderColor: '#3b82f6',
  } as CSSProperties,

  buttonRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 24,
  } as CSSProperties,

  button: (primary = false, disabled = false): CSSProperties => ({
    background: disabled ? '#2a2a2a' : primary ? '#3b82f6' : '#2a2a2a',
    border: 'none',
    borderRadius: 6,
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 500,
    color: disabled ? '#666' : 'white',
    cursor: disabled ? 'not-allowed' : 'pointer',
  }),
};

export function DataImportDialog({
  visible,
  mode,
  targetPath,
  currentValue,
  initialData,
  onClose,
  onSuccess,
}: DataImportDialogProps) {
  const [url, setUrl] = useState('');
  const [parsedData, setParsedData] = useState<any>(initialData ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<Strategy>('replace');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 当 initialData 变化时更新 parsedData 和策略
  useEffect(() => {
    if (initialData !== undefined) {
      setParsedData(initialData);
      // 如果可以合并，默认选择合并
      if (
        currentValue &&
        typeof currentValue === 'object' &&
        initialData &&
        typeof initialData === 'object'
      ) {
        const bothArrays =
          Array.isArray(currentValue) && Array.isArray(initialData);
        const bothObjects =
          !Array.isArray(currentValue) && !Array.isArray(initialData);
        if (bothArrays || bothObjects) {
          setStrategy('merge');
        }
      }
    }
  }, [initialData, currentValue]);

  // 检查是否可以合并（都是对象或都是数组）
  const canMerge =
    parsedData &&
    currentValue &&
    ((Array.isArray(parsedData) && Array.isArray(currentValue)) ||
      (typeof parsedData === 'object' &&
        parsedData !== null &&
        typeof currentValue === 'object' &&
        currentValue !== null &&
        !Array.isArray(parsedData) &&
        !Array.isArray(currentValue)));

  const handleParseUrl = async () => {
    if (!url) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await parseUrl(url);
      if (result && result.sample_data) {
        setParsedData(result.sample_data);
        if (currentValue && typeof currentValue === 'object') {
          setStrategy('merge');
        }
      } else {
        throw new Error('No data found');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse URL');
    } finally {
      setIsLoading(false);
    }
  };

  const readFileAsText = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target?.result as string);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsLoading(true);
    setError(null);

    try {
      // 如果只有一个文件且是 JSON，直接解析
      if (
        files.length === 1 &&
        files[0].name.endsWith('.json') &&
        !files[0].webkitRelativePath.includes('/')
      ) {
        const text = await readFileAsText(files[0]);
        try {
          setParsedData(JSON.parse(text));
        } catch {
          setParsedData(text);
        }
      } else {
        // 多文件/文件夹：构建结构
        const result: any = {};

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const path = file.webkitRelativePath || file.name;
          const parts = path.split('/');

          let current = result;
          if (parts.length > 1) {
            for (let j = 0; j < parts.length - 1; j++) {
              const part = parts[j];
              if (!current[part]) current[part] = {};
              current = current[part];
            }
            const fileName = parts[parts.length - 1];
            const text = await readFileAsText(file);
            try {
              current[fileName] = JSON.parse(text);
            } catch {
              current[fileName] = text;
            }
          } else {
            const text = await readFileAsText(file);
            try {
              result[file.name] = JSON.parse(text);
            } catch {
              result[file.name] = text;
            }
          }
        }

        setParsedData(result);
      }

      if (currentValue && typeof currentValue === 'object') {
        setStrategy('merge');
      }
    } catch (err) {
      setError('Failed to parse files');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirm = () => {
    if (parsedData) {
      onSuccess(parsedData, strategy);
      onClose();
    }
  };

  if (!visible) return null;

  return createPortal(
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          Import from {mode === 'url' ? 'URL' : 'Files'}
        </div>
        <div style={styles.subHeader}>Target: {targetPath || 'Root'}</div>

        {/* URL Input */}
        {mode === 'url' && !parsedData && (
          <div>
            <label style={styles.label}>Enter JSON URL</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                style={styles.input}
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder='https://api.example.com/data.json'
                onKeyDown={e => e.key === 'Enter' && handleParseUrl()}
              />
              <button
                style={styles.button(true, isLoading || !url)}
                onClick={handleParseUrl}
              >
                {isLoading ? 'Fetching...' : 'Fetch'}
              </button>
            </div>
          </div>
        )}

        {/* File/Folder Selection */}
        {mode === 'file' && !parsedData && (
          <div>
            <div
              style={{
                border: '2px dashed #333',
                borderRadius: 8,
                padding: 32,
                textAlign: 'center',
                cursor: 'pointer',
                color: '#888',
                transition: 'border-color 0.2s',
              }}
              onClick={() => fileInputRef.current?.click()}
              onMouseEnter={e => (e.currentTarget.style.borderColor = '#555')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = '#333')}
            >
              {isLoading ? (
                <div>Processing files...</div>
              ) : (
                <>
                  <div style={{ marginBottom: 8 }}>📁</div>
                  <div>Click to select files or folder</div>
                  <div style={{ fontSize: 11, marginTop: 4, color: '#666' }}>
                    Supports JSON, text files, and folders
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* File Input (Hidden) - supports both files and folder */}
        <input
          ref={fileInputRef}
          type='file'
          style={{ display: 'none' }}
          {...({ webkitdirectory: '', directory: '' } as any)}
          multiple
          onChange={handleFileChange}
        />

        {error && (
          <div style={{ color: '#ef4444', marginBottom: 16, fontSize: 13 }}>
            Error: {error}
          </div>
        )}

        {/* Preview & Strategy Selection */}
        {parsedData && (
          <div>
            <label style={styles.label}>Preview Data</label>
            <div style={styles.previewBox}>
              {JSON.stringify(parsedData, null, 2)}
            </div>

            <label style={styles.label}>Import Strategy</label>

            <div
              style={{
                ...styles.strategyOption,
                ...(strategy === 'replace'
                  ? styles.strategyOptionSelected
                  : {}),
              }}
              onClick={() => setStrategy('replace')}
            >
              <div
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  border: '1px solid #666',
                  background:
                    strategy === 'replace' ? '#3b82f6' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {strategy === 'replace' && (
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: 'white',
                    }}
                  />
                )}
              </div>
              <div>
                <div
                  style={{ color: '#CDCDCD', fontSize: 13, fontWeight: 500 }}
                >
                  Replace Current Node
                </div>
                <div style={{ color: '#888', fontSize: 12 }}>
                  Overwrite existing data with imported content.
                </div>
              </div>
            </div>

            {canMerge && (
              <div
                style={{
                  ...styles.strategyOption,
                  ...(strategy === 'merge'
                    ? styles.strategyOptionSelected
                    : {}),
                }}
                onClick={() => setStrategy('merge')}
              >
                <div
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    border: '1px solid #666',
                    background:
                      strategy === 'merge' ? '#3b82f6' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {strategy === 'merge' && (
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: 'white',
                      }}
                    />
                  )}
                </div>
                <div>
                  <div
                    style={{ color: '#CDCDCD', fontSize: 13, fontWeight: 500 }}
                  >
                    Merge into Current Node
                  </div>
                  <div style={{ color: '#888', fontSize: 12 }}>
                    {Array.isArray(currentValue)
                      ? 'Append items to the existing array.'
                      : 'Merge properties into the existing object.'}
                  </div>
                </div>
              </div>
            )}

            <div style={styles.buttonRow}>
              <button style={styles.button(false)} onClick={onClose}>
                Cancel
              </button>
              <button style={styles.button(true)} onClick={handleConfirm}>
                Confirm Import
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
