'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ActionButton } from './ActionButton';

type CopyButtonProps = {
  text?: string;
  getText?: () => string | Promise<string>;
  children?: ReactNode;
  copiedChildren?: ReactNode;
  label?: ReactNode;
  copiedLabel?: ReactNode;
  leadingIcon?: ReactNode;
  copiedLeadingIcon?: ReactNode;
  size?: 'sm' | 'md';
  variant?: 'primary' | 'secondary' | 'danger' | 'warning' | 'ghost';
  copiedVariant?: 'primary' | 'secondary' | 'danger' | 'warning' | 'ghost';
  disabled?: boolean;
  onCopied?: () => void;
  style?: CSSProperties;
};

export function CopyButton({
  text,
  getText,
  children,
  copiedChildren,
  label = 'Copy',
  copiedLabel = 'Copied',
  leadingIcon,
  copiedLeadingIcon,
  size = 'sm',
  variant = 'secondary',
  copiedVariant = 'primary',
  disabled,
  onCopied,
  style,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const [copying, setCopying] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    if (disabled || copying) return;
    const value = getText ? await getText() : text;
    if (!value) return;

    setCopying(true);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      onCopied?.();
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = setTimeout(() => {
        setCopied(false);
      }, 1400);
    } catch {
      setCopied(false);
    } finally {
      setCopying(false);
    }
  };

  return (
    <ActionButton
      type="button"
      variant={copied ? copiedVariant : variant}
      size={size}
      disabled={disabled}
      loading={copying}
      onClick={handleCopy}
      leadingIcon={copied ? copiedLeadingIcon : leadingIcon}
      style={style}
    >
      {copied ? copiedChildren ?? copiedLabel : children ?? label}
    </ActionButton>
  );
}
