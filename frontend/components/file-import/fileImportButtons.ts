import type { CSSProperties } from 'react';
import { BUTTON_HEIGHT } from '@/components/ui/buttonTokens';

export const dropzoneActionButton: CSSProperties = {
  height: BUTTON_HEIGHT,
  padding: '0 14px',
  borderRadius: 6,
  border: '1px solid var(--po-border-strong)',
  background: 'transparent',
  color: 'var(--po-text)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'background 0.15s, border-color 0.15s',
};

export const dropzonePrimaryActionButton: CSSProperties = {
  border: '1px solid var(--po-text)',
  background: 'var(--po-text)',
  color: 'var(--po-text-inverse)',
};
