'use client';

import { useState, useEffect } from 'react';
import {
  listTables,
  previewTable,
  saveTable,
  type TableInfo,
  type TablePreview,
} from '../lib/dbConnectorApi';

type SupabaseTablePickerDialogProps = {
  projectId: string;
  connectionId: string;
  onClose: () => void;
  onSaved?: () => void;
};

/**
 * Supabase Table Picker - 选表 → 预览 → 保存
 *
 * 导出名保持 SupabaseSQLEditorDialog 以兼容现有 import。
 */
export function SupabaseSQLEditorDialog({ projectId, connectionId, onClose, onSaved }: SupabaseTablePickerDialogProps) {
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [tablesLoading, setTablesLoading] = useState(true);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [preview, setPreview] = useState<TablePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  // Load tables on mount
  useEffect(() => {
    listTables(connectionId)
      .then(t => { setTables(t); setTablesLoading(false); })
      .catch(err => { setError(String(err)); setTablesLoading(false); });
  }, [connectionId]);

  // Load preview when table selected
  useEffect(() => {
    if (!selectedTable) { setPreview(null); return; }
    setPreviewLoading(true);
    setError(null);
    setSaveSuccess(null);
    previewTable(connectionId, selectedTable, 50)
      .then(p => { setPreview(p); setPreviewLoading(false); })
      .catch(err => { setError(String(err)); setPreviewLoading(false); });
  }, [selectedTable, connectionId]);

  const handleSave = async () => {
    if (!selectedTable) return;
    setIsSaving(true);
    setError(null);
    setSaveSuccess(null);

    try {
      const res = await saveTable(connectionId, projectId, {
        name: selectedTable,
        table: selectedTable,
      });
      setSaveSuccess(`Saved "${selectedTable}" (${res.row_count} rows)`);
      onSaved?.();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  // Get column info for selected table
  const selectedTableInfo = tables.find(t => t.name === selectedTable);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        backdropFilter: 'blur(2px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#1C1C1E',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12,
          width: 820,
          maxWidth: '95vw',
          height: 560,
          maxHeight: '90vh',
          boxShadow: '0 24px 48px rgba(0,0,0,0.4)',
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
        `}</style>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <svg width="18" height="18" viewBox="0 0 109 113" fill="none">
              <path d="M63.7076 110.284C60.8481 113.885 55.0502 111.912 54.9813 107.314L53.9738 40.0627L99.1935 40.0627C107.384 40.0627 111.952 49.5228 106.859 55.9374L63.7076 110.284Z" fill="url(#sp2)"/>
              <path d="M45.317 2.07103C48.1765 -1.53037 53.9745 0.442937 54.0434 5.041L54.4849 72.2922H9.83113C1.64038 72.2922 -2.92775 62.8321 2.1655 56.4175L45.317 2.07103Z" fill="#3ECF8E"/>
              <defs><linearGradient id="sp2" x1="53.9738" y1="54.974" x2="94.1635" y2="71.8295" gradientUnits="userSpaceOnUse"><stop stopColor="#249361"/><stop offset="1" stopColor="#3ECF8E"/></linearGradient></defs>
            </svg>
            <span style={{ color: '#e4e4e7', fontSize: 15, fontWeight: 600 }}>Select Table to Import</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#71717a', cursor: 'pointer', padding: 4, fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>

        {/* Body: sidebar + preview */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
          {/* Left: Table list */}
          <div style={{ width: 220, borderRight: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
            <div style={{ padding: '10px 14px 6px', fontSize: 11, fontWeight: 600, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Tables ({tables.length})
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {tablesLoading && (
                <div style={{ padding: '12px 14px', fontSize: 13, color: '#525252' }}>Loading...</div>
              )}
              {tables.map(t => (
                <div
                  key={t.name}
                  onClick={() => setSelectedTable(t.name)}
                  style={{
                    padding: '8px 14px',
                    fontSize: 13,
                    color: selectedTable === t.name ? '#e4e4e7' : '#a1a1aa',
                    background: selectedTable === t.name ? 'rgba(62, 207, 142, 0.08)' : 'transparent',
                    cursor: 'pointer',
                    borderLeft: selectedTable === t.name ? '2px solid #3ECF8E' : '2px solid transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                  onMouseEnter={e => { if (selectedTable !== t.name) { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; } }}
                  onMouseLeave={e => { if (selectedTable !== t.name) { e.currentTarget.style.background = 'transparent'; } }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                  <span style={{ fontSize: 11, color: '#525252', flexShrink: 0, marginLeft: 6 }}>
                    {t.columns.length}
                  </span>
                </div>
              ))}
              {!tablesLoading && tables.length === 0 && (
                <div style={{ padding: '12px 14px', fontSize: 13, color: '#525252' }}>No tables found</div>
              )}
            </div>
          </div>

          {/* Right: Preview */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            {/* No table selected */}
            {!selectedTable && (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ textAlign: 'center', color: '#525252' }}>
                  <div style={{ fontSize: 28, marginBottom: 8 }}>←</div>
                  <div style={{ fontSize: 14 }}>Select a table to preview</div>
                </div>
              </div>
            )}

            {/* Loading */}
            {selectedTable && previewLoading && (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ fontSize: 14, color: '#71717a' }}>Loading preview...</div>
              </div>
            )}

            {/* Preview data */}
            {selectedTable && preview && !previewLoading && (
              <>
                {/* Column info */}
                {selectedTableInfo && (
                  <div style={{ padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)', flexShrink: 0 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {selectedTableInfo.columns.map(c => (
                        <span key={c.name} style={{ padding: '2px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: 4, fontSize: 11, color: '#71717a' }}>
                          {c.name} <span style={{ color: '#3f3f46' }}>{c.type}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Data table */}
                <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ position: 'sticky', top: 0, background: '#1C1C1E', zIndex: 1 }}>
                        {preview.columns.map(col => (
                          <th key={col} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, color: '#a1a1aa', borderBottom: '1px solid rgba(255,255,255,0.08)', whiteSpace: 'nowrap' }}>
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((row, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          {preview.columns.map(col => (
                            <td key={col} style={{
                              padding: '6px 12px', color: '#d4d4d8', maxWidth: 250, overflow: 'hidden',
                              textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                            }} title={String(row[col] ?? '')}>
                              {row[col] === null
                                ? <span style={{ color: '#525252', fontStyle: 'italic' }}>null</span>
                                : String(row[col])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Footer: row count + save */}
                <div style={{ padding: '10px 16px', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
                  <span style={{ fontSize: 12, color: '#71717a' }}>
                    Showing {preview.row_count} rows · {preview.execution_time_ms.toFixed(0)}ms
                  </span>

                  <button
                    onClick={handleSave}
                    disabled={isSaving}
                    style={{
                      padding: '7px 20px', borderRadius: 8, border: 'none',
                      background: isSaving ? 'rgba(62, 207, 142, 0.3)' : '#3ECF8E',
                      color: isSaving ? 'rgba(0,0,0,0.4)' : '#000',
                      cursor: isSaving ? 'not-allowed' : 'pointer',
                      fontSize: 13, fontWeight: 600,
                    }}
                  >
                    {isSaving ? 'Saving...' : `Save "${selectedTable}" to Project`}
                  </button>
                </div>
              </>
            )}

            {/* Error */}
            {error && (
              <div style={{ margin: '12px 16px', padding: '10px 12px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: 8, color: '#fca5a5', fontSize: 13 }}>
                {error}
              </div>
            )}

            {/* Save success */}
            {saveSuccess && (
              <div style={{ margin: '12px 16px', padding: '10px 12px', background: 'rgba(62, 207, 142, 0.1)', border: '1px solid rgba(62, 207, 142, 0.2)', borderRadius: 8, color: '#6ee7b7', fontSize: 13 }}>
                {saveSuccess}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
