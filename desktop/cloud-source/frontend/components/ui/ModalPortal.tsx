'use client';

import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

type ModalPortalProps = {
  children: ReactNode;
  container?: Element | null;
};

export function ModalPortal({ children, container }: ModalPortalProps) {
  const target =
    container ?? (typeof document !== 'undefined' ? document.body : null);

  if (!target) return null;

  return createPortal(children, target);
}
