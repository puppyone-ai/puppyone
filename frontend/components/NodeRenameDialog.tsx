'use client';

import { useState, useEffect, type FormEvent } from 'react';
import { ActionButton } from './ui/ActionButton';
import { DialogBody, DialogFooter, DialogHeader, DialogRoot, DialogSurface } from './ui/Dialog';
import { Field, TextField } from './ui/Field';

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

  const handleSubmit = async (e: FormEvent) => {
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
    <DialogRoot onClose={onClose}>
      <DialogSurface width={400}>
        <DialogHeader title="Rename" onClose={onClose} />
        <form onSubmit={handleSubmit}>
          <DialogBody>
            <Field label="Name" error={displayError}>
              <TextField
                type='text'
                value={name}
                onChange={e => handleNameChange(e.target.value)}
                placeholder='Enter new name'
                invalid={Boolean(displayError)}
                autoFocus
                disabled={submitting}
              />
            </Field>
          </DialogBody>

          <DialogFooter>
            <ActionButton type='button' onClick={onClose} disabled={submitting}>
              Cancel
            </ActionButton>
            <ActionButton
              type='submit'
              disabled={!name.trim() || name.trim() === currentName || submitting}
              variant='primary'
              loading={submitting}
            >
              {submitting ? 'Renaming...' : 'Rename'}
            </ActionButton>
          </DialogFooter>
        </form>
      </DialogSurface>
    </DialogRoot>
  );
}
