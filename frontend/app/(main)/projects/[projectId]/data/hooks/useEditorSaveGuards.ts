'use client';

import { useEffect } from 'react';

export function useEditorSaveGuards({
  dirty,
  save,
  keyboardEnabled = true,
}: {
  dirty: boolean;
  save: () => void | Promise<void>;
  keyboardEnabled?: boolean;
}) {
  useEffect(() => {
    if (!keyboardEnabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key !== 's' && event.key !== 'S') return;
      if (!dirty) return;
      event.preventDefault();
      void save();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [dirty, keyboardEnabled, save]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
}
