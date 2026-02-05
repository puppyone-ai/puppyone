import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { getETLHealth } from '@/lib/etlApi';

interface ImportConfigDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (config: ImportConfig) => void;
  files: File[];
}

export interface ImportConfig {
  mode: 'smart' | 'raw' | 'structured';
  ruleId?: number;
}

export function ImportConfigDialog({
  isOpen,
  onClose,
  onConfirm,
  files,
}: ImportConfigDialogProps) {
  const [mode, setMode] = useState<'smart' | 'raw' | 'structured'>('smart');
  const [workerOnline, setWorkerOnline] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);

  // Analyze file types
  const fileStats = React.useMemo(() => {
    let textCount = 0;
    let binaryCount = 0;
    const extensions = new Set<string>();

    const textExts = new Set([
      'txt', 'md', 'json', 'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'html', 'css', 'xml', 'yaml', 'yml', 'csv'
    ]);

    files.forEach(f => {
      const ext = f.name.split('.').pop()?.toLowerCase() || '';
      extensions.add(ext);
      if (textExts.has(ext)) {
        textCount++;
      } else {
        binaryCount++;
      }
    });

    return { textCount, binaryCount, extensions: Array.from(extensions) };
  }, [files]);

  // Check worker health on open
  useEffect(() => {
    if (isOpen) {
      setChecking(true);
      getETLHealth()
        .then(health => {
          const isOnline = health.file_worker.worker_count > 0;
          setWorkerOnline(isOnline);
          
          // Auto-downgrade if offline and has binary files
          if (!isOnline && fileStats.binaryCount > 0) {
            setMode('raw');
          }
        })
        .catch(() => {
          setWorkerOnline(false);
          if (fileStats.binaryCount > 0) {
            setMode('raw');
          }
        })
        .finally(() => setChecking(false));
    }
  }, [isOpen, fileStats.binaryCount]);

  // 处理 overlay 点击 - 只有点击背景才关闭
  const handleOverlayClick = useCallback((e: React.MouseEvent) => {
    // 只有直接点击 overlay 背景时才关闭
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  // 阻止模态框内部点击冒泡
  const handleModalClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  if (!isOpen) return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1100,
        backdropFilter: 'blur(2px)',
      }}
      onClick={handleOverlayClick}
      onMouseDown={e => e.stopPropagation()}
    >
      <div
        onClick={handleModalClick}
        onMouseDown={e => e.stopPropagation()}
        style={{
          width: 500,
          background: '#1e1e1e',
          border: '1px solid #333',
          borderRadius: 8,
          padding: 24,
          color: '#e5e5e5',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
        }}
      >
        <h2 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 600 }}>
          Import {files.length} Files
        </h2>

        {/* File Summary */}
        <div style={{ 
          background: '#262626', 
          padding: 12, 
          borderRadius: 6, 
          marginBottom: 20,
          fontSize: 13,
          color: '#a3a3a3',
          display: 'flex',
          justifyContent: 'space-between'
        }}>
          <div>
            <span style={{ color: '#e5e5e5', fontWeight: 500 }}>{fileStats.textCount}</span> Text files
            <span style={{ margin: '0 8px', opacity: 0.3 }}>|</span>
            <span style={{ color: fileStats.binaryCount > 0 ? '#fbbf24' : '#e5e5e5', fontWeight: 500 }}>
              {fileStats.binaryCount}
            </span> Documents/Images
          </div>
          <div>
            {fileStats.extensions.slice(0, 3).map(ext => `.${ext}`).join(' ')}
            {fileStats.extensions.length > 3 && ' ...'}
          </div>
        </div>

        {/* Mode Selection */}
        <div style={{ marginBottom: 24 }}>
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 12, color: '#d4d4d4' }}>
            Processing Mode
          </label>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Smart Parse */}
            <div 
              onClick={() => workerOnline !== false && setMode('smart')}
              style={{
                padding: 12,
                borderRadius: 6,
                border: `1px solid ${mode === 'smart' ? '#3b82f6' : '#333'}`,
                background: mode === 'smart' ? 'rgba(59, 130, 246, 0.1)' : '#262626',
                cursor: workerOnline === false ? 'not-allowed' : 'pointer',
                opacity: workerOnline === false ? 0.5 : 1,
                transition: 'all 0.2s'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                <div style={{
                  width: 16, height: 16, borderRadius: '50%',
                  border: `4px solid ${mode === 'smart' ? '#3b82f6' : '#525252'}`,
                  marginRight: 10
                }} />
                <span style={{ fontWeight: 500, fontSize: 14 }}>Smart Parse (Default)</span>
                {workerOnline === false && (
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: '#ef4444', background: 'rgba(239,68,68,0.1)', padding: '2px 6px', borderRadius: 4 }}>
                    Unavailable
                  </span>
                )}
              </div>
              <div style={{ paddingLeft: 26, fontSize: 12, color: '#a3a3a3', lineHeight: 1.4 }}>
                Text files imported directly. PDFs and images undergo OCR for full-text search.
              </div>
            </div>

            {/* Raw Storage */}
            <div 
              onClick={() => setMode('raw')}
              style={{
                padding: 12,
                borderRadius: 6,
                border: `1px solid ${mode === 'raw' ? '#3b82f6' : '#333'}`,
                background: mode === 'raw' ? 'rgba(59, 130, 246, 0.1)' : '#262626',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                <div style={{
                  width: 16, height: 16, borderRadius: '50%',
                  border: `4px solid ${mode === 'raw' ? '#3b82f6' : '#525252'}`,
                  marginRight: 10
                }} />
                <span style={{ fontWeight: 500, fontSize: 14 }}>Raw Storage</span>
              </div>
              <div style={{ paddingLeft: 26, fontSize: 12, color: '#a3a3a3', lineHeight: 1.4 }}>
                Files stored as-is without processing. Faster import, but PDFs/Images won't be searchable.
              </div>
            </div>
            
            {/* Structured (Disabled for now as placeholder) */}
            <div style={{ padding: 12, borderRadius: 6, border: '1px solid #333', background: '#262626', opacity: 0.5, cursor: 'not-allowed' }}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ width: 16, height: 16, borderRadius: '50%', border: '4px solid #525252', marginRight: 10 }} />
                <span style={{ fontWeight: 500, fontSize: 14 }}>Structured Data (Coming Soon)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Worker Status Footer */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          fontSize: 12, 
          color: workerOnline ? '#22c55e' : (workerOnline === false ? '#ef4444' : '#a3a3a3'),
          marginBottom: 24,
          background: workerOnline ? 'rgba(34,197,94,0.05)' : (workerOnline === false ? 'rgba(239,68,68,0.05)' : 'transparent'),
          padding: '8px 12px',
          borderRadius: 6
        }}>
          <div style={{ 
            width: 8, height: 8, borderRadius: '50%', 
            background: workerOnline ? '#22c55e' : (workerOnline === false ? '#ef4444' : '#737373'),
            marginRight: 8
          }} />
          {checking ? 'Checking ETL service...' : (
            workerOnline ? 'ETL Worker Online' : 'ETL Worker Offline - Smart Parse unavailable'
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: '1px solid #333',
              background: 'transparent',
              color: '#a3a3a3',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm({ mode })}
            disabled={checking}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: 'none',
              background: '#e5e5e5',
              color: '#000',
              cursor: checking ? 'not-allowed' : 'pointer',
              fontSize: 13,
              fontWeight: 600,
              opacity: checking ? 0.7 : 1
            }}
          >
            Import Files
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

