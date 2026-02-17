'use client';

import { useState, useEffect } from 'react';

/** POSIX 名称校验常量 */
const MAX_NAME_LENGTH = 255;
const FORBIDDEN_CHARS_RE = /[/\x00-\x1f]/;
const RESERVED_NAMES = new Set(['.', '..']);

function validateName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Name cannot be empty';
  if (trimmed.length > MAX_NAME_LENGTH) return `Name exceeds maximum length of ${MAX_NAME_LENGTH} characters`;
  if (RESERVED_NAMES.has(trimmed)) return `"${trimmed}" is a reserved name`;
  if (FORBIDDEN_CHARS_RE.test(trimmed)) return 'Name contains forbidden characters (/ or control characters)';
  return null;
}

type NodeRenameDialogProps = {
  isOpen: boolean;
  currentName: string;
  onClose: () => void;
  onConfirm: (newName: string) => Promise<void> | void;
  error?: string | null;
};

export function NodeRenameDialog({
  isOpen,
  currentName,
  onClose,
  onConfirm,
  error: externalError,
}: NodeRenameDialogProps) {
  const [name, setName] = useState(currentName);
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // 合并外部错误和本地校验错误
  const displayError = externalError || localError;

  useEffect(() => {
    if (isOpen) {
      setName(currentName);
      setLocalError(null);
      setSubmitting(false);
    }
  }, [isOpen, currentName]);

  if (!isOpen) return null;

  const handleNameChange = (value: string) => {
    setName(value);
    // 清除之前的错误提示
    if (localError) setLocalError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();

    // 本地校验
    const validationError = validateName(trimmed);
    if (validationError) {
      setLocalError(validationError);
      return;
    }

    if (trimmed === currentName) {
      onClose();
      return;
    }

    setSubmitting(true);
    try {
      await onConfirm(trimmed);
    } catch {
      // 错误由外部 error prop 传入
    } finally {
      setSubmitting(false);
    }
  };

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
      onClick={onClose}
    >
      <div
        style={{
          background: '#202020',
          border: '1px solid #333',
          borderRadius: 12,
          width: 400,
          maxWidth: '90vw',
          boxShadow: '0 24px 48px rgba(0,0,0,0.4), 0 12px 24px rgba(0,0,0,0.4)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'dialog-fade-in 0.2s ease-out',
        }}
        onClick={e => e.stopPropagation()}
      >
        <style jsx>{`
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
          <div style={{ fontSize: 16, fontWeight: 500, color: '#EDEDED' }}>
            Rename
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#666',
              cursor: 'pointer',
              padding: 4,
            }}
          >
            <svg
              width='16'
              height='16'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
              strokeLinecap='round'
              strokeLinejoin='round'
            >
              <line x1='18' y1='6' x2='6' y2='18' />
              <line x1='6' y1='6' x2='18' y2='18' />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ padding: '24px 24px 24px' }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: '#666',
                marginBottom: 8,
              }}
            >
              Name
            </div>
            <input
              type='text'
              value={name}
              onChange={e => handleNameChange(e.target.value)}
              placeholder='Enter new name'
              style={{
                width: '100%',
                padding: '10px 12px',
                background: '#1a1a1a',
                border: displayError ? '1px solid #e53e3e' : '1px solid #333',
                borderRadius: 6,
                fontSize: 16,
                color: '#EDEDED',
                outline: 'none',
                boxSizing: 'border-box',
              }}
              autoFocus
              disabled={submitting}
            />
            {displayError && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 13,
                  color: '#e53e3e',
                  lineHeight: 1.4,
                }}
              >
                {displayError}
              </div>
            )}
          </div>

          <div
            style={{
              padding: '16px 20px',
              background: '#202020',
              borderTop: '1px solid #333',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 12,
            }}
          >
            <button type='button' onClick={onClose} style={buttonStyle(false)} disabled={submitting}>
              Cancel
            </button>
            <button
              type='submit'
              disabled={!name.trim() || name.trim() === currentName || submitting}
              style={{
                ...buttonStyle(true),
                opacity: !name.trim() || name.trim() === currentName || submitting ? 0.5 : 1,
              }}
            >
              {submitting ? 'Renaming...' : 'Rename'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const buttonStyle = (primary: boolean): React.CSSProperties => ({
  height: 32,
  padding: '0 12px',
  borderRadius: 6,
  border: primary ? '1px solid rgba(255,255,255,0.1)' : '1px solid #333',
  background: primary ? '#EDEDED' : 'transparent',
  color: primary ? '#1a1a1a' : '#EDEDED',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'all 0.1s',
  fontFamily: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
});



