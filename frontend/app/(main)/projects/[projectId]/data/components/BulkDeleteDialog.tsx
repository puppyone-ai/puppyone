'use client';

/**
 * BulkDeleteDialog — confirmation modal for multi-select delete.
 *
 * Mirrors the visual language of TableDeleteDialog (same dark
 * surface, same destructive red affordance) so the user gets a
 * familiar destructive-action shape. Renders a compact preview of
 * the selected items so the user can sanity-check before
 * committing — invaluable when shift-clicks or rogue cmd-clicks
 * grab unintended siblings.
 *
 * Default Delete behaviour is soft-delete (move to .trash) so the
 * user can recover via the trash UI. ``permanent`` is offered as a
 * checkbox for power users who already know they want it gone.
 */

import { useEffect, useState } from 'react';
import { Dots } from '@/components/loading';

interface BulkDeleteDialogProps {
  open: boolean;
  paths: string[];
  onClose: () => void;
  onConfirm: (permanent: boolean) => Promise<void>;
}

const PREVIEW_LIMIT = 8;

export function BulkDeleteDialog({
  open,
  paths,
  onClose,
  onConfirm,
}: BulkDeleteDialogProps) {
  const [submitting, setSubmitting] = useState(false);
  const [permanent, setPermanent] = useState(false);

  // Reset transient form state every time the dialog re-opens so a
  // previous "permanent" tick doesn't carry over silently.
  useEffect(() => {
    if (open) {
      setPermanent(false);
      setSubmitting(false);
    }
  }, [open]);

  // Esc-to-cancel and Enter-to-confirm. Avoids forcing the user
  // back to the mouse for routine confirms.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (submitting) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        void doConfirm();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, submitting, permanent]);

  if (!open) return null;

  const doConfirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onConfirm(permanent);
      onClose();
    } catch {
      // Toast surfacing is the parent's job; just unblock the button.
    } finally {
      setSubmitting(false);
    }
  };

  const previewPaths = paths.slice(0, PREVIEW_LIMIT);
  const overflow = paths.length - previewPaths.length;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={() => {
        if (!submitting) onClose();
      }}
    >
      <div
        style={{
          background: '#202020',
          border: '1px solid #333',
          borderRadius: 12,
          width: 520,
          maxWidth: '90vw',
          boxShadow: '0 24px 48px rgba(0,0,0,0.4), 0 12px 24px rgba(0,0,0,0.4)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'dialog-fade-in 0.2s ease-out',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <style>{`
          @keyframes dialog-fade-in {
            from {
              opacity: 0;
              transform: scale(0.98);
            }
            to {
              opacity: 1;
              transform: scale(1);
            }
          }
        `}</style>

        {/* Header */}
        <div
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid #333',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 500, color: '#bbb' }}>
            Delete {paths.length} item{paths.length === 1 ? '' : 's'}
          </div>
          {!submitting && (
            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#666',
                cursor: 'pointer',
                padding: 4,
              }}
              aria-label="Close"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <div style={{ padding: '20px 24px 16px' }}>
          <p style={{ color: '#EDEDED', marginBottom: 12, fontSize: 14, fontWeight: 500 }}>
            Move {paths.length} item{paths.length === 1 ? '' : 's'} to the trash?
          </p>
          <p style={{ color: '#9ca3af', fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>
            {permanent
              ? 'These items will be deleted permanently. This action cannot be undone.'
              : 'You can restore items from the trash. Folders take their entire contents with them.'}
          </p>

          {/* Preview list */}
          <div
            style={{
              background: '#181818',
              border: '1px solid #2a2a2a',
              borderRadius: 8,
              padding: '6px 4px',
              maxHeight: 200,
              overflowY: 'auto',
              marginBottom: 16,
            }}
          >
            {previewPaths.map((p) => (
              <div
                key={p}
                style={{
                  padding: '4px 10px',
                  fontSize: 12,
                  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                  color: '#d4d4d8',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={p}
              >
                {p}
              </div>
            ))}
            {overflow > 0 && (
              <div
                style={{
                  padding: '4px 10px',
                  fontSize: 12,
                  color: '#6b7280',
                  fontStyle: 'italic',
                }}
              >
                + {overflow} more…
              </div>
            )}
          </div>

          {/* Permanent toggle */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              color: permanent ? '#fca5a5' : '#9ca3af',
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <input
              type="checkbox"
              checked={permanent}
              onChange={(e) => setPermanent(e.target.checked)}
              disabled={submitting}
              style={{ cursor: 'pointer' }}
            />
            Delete permanently (skip trash)
          </label>
        </div>

        <div
          style={{
            padding: '14px 20px',
            background: '#202020',
            borderTop: '1px solid #333',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 12,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={buttonStyle(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void doConfirm()}
            disabled={submitting}
            style={{
              ...buttonStyle(true),
              background: 'rgba(239,68,68,0.12)',
              color: '#ef4444',
              border: '1px solid rgba(239,68,68,0.25)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              justifyContent: 'center',
            }}
          >
            {submitting && <Dots size="xs" tone="danger" />}
            {submitting
              ? 'Deleting…'
              : permanent
                ? `Delete ${paths.length} permanently`
                : `Delete ${paths.length}`}
          </button>
        </div>
      </div>
    </div>
  );
}

const buttonStyle = (primary: boolean): React.CSSProperties => ({
  height: 32,
  padding: '0 14px',
  borderRadius: 6,
  border: primary ? '1px solid rgba(255,255,255,0.1)' : '1px solid #333',
  background: primary ? '#EDEDED' : 'transparent',
  color: primary ? '#1a1a1a' : '#EDEDED',
  fontSize: 13.5,
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'all 0.1s',
  fontFamily: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
});
