'use client';

import { useEffect } from 'react';

export function useEditorSaveGuards({
  dirty,
  save,
}: {
  dirty: boolean;
  save: () => void | Promise<void>;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key !== 's' && event.key !== 'S') return;
      if (!dirty) return;
      event.preventDefault();
      void save();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [dirty, save]);

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
