import React, { useState, useEffect } from 'react';
import { getETLHealth } from '@/lib/etlApi';
import { ActionButton } from './ui/ActionButton';
import { DialogBody, DialogFooter, DialogHeader, DialogRoot, DialogSurface } from './ui/Dialog';

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

  if (!isOpen) return null;

  return (
    <DialogRoot onClose={onClose} layer="modalNested">
      <DialogSurface width={500}>
        <DialogHeader title={`Import ${files.length} Files`} onClose={onClose} />
        <DialogBody>
        {/* File Summary */}
        <div style={{
          background: 'var(--po-control)',
          padding: 12,
          borderRadius: 6,
          marginBottom: 20,
          fontSize: 13,
          color: 'var(--po-text-muted)',
          display: 'flex',
          justifyContent: 'space-between'
        }}>
          <div>
            <span style={{ color: 'var(--po-text)', fontWeight: 500 }}>{fileStats.textCount}</span> Text files
            <span style={{ margin: '0 8px', opacity: 0.3 }}>|</span>
            <span style={{ color: fileStats.binaryCount > 0 ? 'var(--po-warning)' : 'var(--po-text)', fontWeight: 500 }}>
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
          <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 12, color: 'var(--po-text)' }}>
            Processing Mode
          </label>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Smart Parse */}
            <div
              onClick={() => workerOnline !== false && setMode('smart')}
              style={{
                padding: 12,
                borderRadius: 6,
                border: `1px solid ${mode === 'smart' ? 'var(--po-accent)' : 'var(--po-border-strong)'}`,
                background: mode === 'smart' ? 'var(--po-selected)' : 'var(--po-control)',
                cursor: workerOnline === false ? 'not-allowed' : 'pointer',
                opacity: workerOnline === false ? 0.5 : 1,
                transition: 'all 0.2s'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                <div style={{
                  width: 16, height: 16, borderRadius: '50%',
                  border: `4px solid ${mode === 'smart' ? 'var(--po-accent)' : 'var(--po-text-disabled)'}`,
                  marginRight: 10
                }} />
                <span style={{ fontWeight: 500, fontSize: 14 }}>Smart Parse (Default)</span>
                {workerOnline === false && (
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--po-danger)', background: 'color-mix(in srgb, var(--po-danger) 10%, transparent)', padding: '2px 6px', borderRadius: 4 }}>
                    Unavailable
                  </span>
                )}
              </div>
              <div style={{ paddingLeft: 26, fontSize: 12, color: 'var(--po-text-muted)', lineHeight: 1.4 }}>
                Text files imported directly. PDFs and images undergo OCR for full-text search.
              </div>
            </div>

            {/* Raw Storage */}
            <div
              onClick={() => setMode('raw')}
              style={{
                padding: 12,
                borderRadius: 6,
                border: `1px solid ${mode === 'raw' ? 'var(--po-accent)' : 'var(--po-border-strong)'}`,
                background: mode === 'raw' ? 'var(--po-selected)' : 'var(--po-control)',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                <div style={{
                  width: 16, height: 16, borderRadius: '50%',
                  border: `4px solid ${mode === 'raw' ? 'var(--po-accent)' : 'var(--po-text-disabled)'}`,
                  marginRight: 10
                }} />
                <span style={{ fontWeight: 500, fontSize: 14 }}>Raw Storage</span>
              </div>
              <div style={{ paddingLeft: 26, fontSize: 12, color: 'var(--po-text-muted)', lineHeight: 1.4 }}>
                Files stored as-is without processing. Faster import, but PDFs/Images won't be searchable.
              </div>
            </div>

            {/* Structured (Disabled for now as placeholder) */}
            <div style={{ padding: 12, borderRadius: 6, border: '1px solid var(--po-border-strong)', background: 'var(--po-control)', opacity: 0.5, cursor: 'not-allowed' }}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ width: 16, height: 16, borderRadius: '50%', border: '4px solid var(--po-text-disabled)', marginRight: 10 }} />
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
          color: workerOnline ? 'var(--po-success)' : (workerOnline === false ? 'var(--po-danger)' : 'var(--po-text-muted)'),
          marginBottom: 24,
          background: workerOnline ? 'color-mix(in srgb, var(--po-success) 5%, transparent)' : (workerOnline === false ? 'color-mix(in srgb, var(--po-danger) 5%, transparent)' : 'transparent'),
          padding: '8px 12px',
          borderRadius: 6
        }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: workerOnline ? 'var(--po-success)' : (workerOnline === false ? 'var(--po-danger)' : 'var(--po-text-subtle)'),
            marginRight: 8
          }} />
          {checking ? 'Checking ETL service...' : (
            workerOnline ? 'ETL Worker Online' : 'ETL Worker Offline - Smart Parse unavailable'
          )}
        </div>

        </DialogBody>

        <DialogFooter>
          <ActionButton
            onClick={onClose}
          >
            Cancel
          </ActionButton>
          <ActionButton
            onClick={() => onConfirm({ mode })}
            disabled={checking}
            variant='primary'
          >
            Import Files
          </ActionButton>
        </DialogFooter>
      </DialogSurface>
    </DialogRoot>
  );
}
