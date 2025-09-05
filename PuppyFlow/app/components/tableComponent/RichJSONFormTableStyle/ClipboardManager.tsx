'use client';
import React from 'react';
import { useSelection } from './ComponentRenderer';
import { setClipboard, getClipboard } from './ClipboardStore';

type ClipboardManagerProps = {
  containerRef: React.RefObject<HTMLElement>;
  getRootData: () => any;
  setRootData: (newData: any) => void;
  readonly?: boolean;
};

function parsePathParts(path: string): string[] {
  if (!path) return [];
  return path.match(/(\[(\d+)\])|([^\.\[\]]+)/g) || [];
}

function getValueAtPath(root: any, path: string): any {
  if (path === '' || path == null) return root;
  const parts = parsePathParts(path);
  let current = root;
  for (const part of parts) {
    if (!current) return undefined;
    if (part.startsWith('[') && part.endsWith(']')) {
      const idx = parseInt(part.slice(1, -1));
      current = current?.[idx];
    } else {
      current = current?.[part];
    }
  }
  return current;
}

function setValueAtPath(root: any, path: string, value: any): any {
  if (path === '' || path == null) {
    return value;
  }
  const parts = parsePathParts(path);

  const setRecursive = (current: any, index: number): any => {
    if (index >= parts.length) return value;
    const part = parts[index];
    const isIndex = part.startsWith('[') && part.endsWith(']');

    if (isIndex) {
      const idx = parseInt(part.slice(1, -1));
      const baseArray = Array.isArray(current) ? current : [];
      const newArray = baseArray.slice();
      newArray[idx] = setRecursive(baseArray[idx], index + 1);
      return newArray;
    } else {
      const baseObj =
        current && typeof current === 'object' && !Array.isArray(current)
          ? current
          : {};
      return {
        ...baseObj,
        [part]: setRecursive(baseObj[part], index + 1),
      };
    }
  };

  return setRecursive(root, 0);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const el = target as Element;
  const tag = el.tagName?.toLowerCase();
  if (tag === 'input' || tag === 'textarea') return true;
  // Check any parent contenteditable
  const editable = el.closest('[contenteditable="true"]');
  return !!editable;
}

const ClipboardManager: React.FC<ClipboardManagerProps> = ({
  containerRef,
  getRootData,
  setRootData,
  readonly,
}) => {
  const { selectedPath } = useSelection();
  const internalClipboardRef = React.useRef<any | null>(null);

  React.useEffect(() => {
    const onKeyDown = async (e: KeyboardEvent) => {
      // Limit scope to inside container
      // Scope: act whenever this viewer has an active selection, regardless of focused target
      const target = e.target as EventTarget | null;

      // Ignore when typing in inputs or contenteditable
      if (isEditableTarget(e.target)) return;

      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;

      // Copy -> trigger native copy event to leverage onCopy handler
      if (e.key === 'c' || e.key === 'C') {
        document.execCommand('copy');
        e.preventDefault();
        e.stopPropagation();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [containerRef, getRootData, setRootData, selectedPath, readonly]);

  React.useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      // If copying inside an editable (Text component), capture selection into app clipboard
      if (isEditableTarget(e.target)) {
        const selectedText =
          typeof window !== 'undefined' && window.getSelection
            ? (window.getSelection()?.toString() ?? '')
            : '';
        if (selectedText) {
          // Try to parse JSON; if fails, keep plain text
          let payload: any = selectedText;
          try {
            payload = JSON.parse(selectedText);
          } catch {}
          internalClipboardRef.current = payload;
          setClipboard(payload);
        }
        // Do not prevent default; allow native clipboard to proceed
        return;
      }
      // Otherwise, copy the selected path value as structured payload
      if (!selectedPath && selectedPath !== '') return;
      const root = getRootData();
      const value = getValueAtPath(root, selectedPath || '');
      if (value === undefined) return;
      try {
        internalClipboardRef.current = JSON.parse(JSON.stringify(value));
      } catch {
        internalClipboardRef.current = value;
      }
      setClipboard(internalClipboardRef.current);
      try {
        e.clipboardData?.setData(
          'text/plain',
          '__RJF__' + JSON.stringify(value)
        );
        e.preventDefault();
        e.stopPropagation();
      } catch {
        // ignore
      }
    };

    const onPaste = (e: ClipboardEvent) => {
      if (readonly) return;
      if (!selectedPath && selectedPath !== '') return;
      if (isEditableTarget(e.target)) return;
      const root = getRootData();
      let text = '';
      try {
        text = e.clipboardData?.getData('text/plain') ?? '';
      } catch {}
      let pasteData: any = internalClipboardRef.current || getClipboard();
      if (!pasteData) {
        try {
          if (text?.startsWith('__RJF__')) {
            pasteData = JSON.parse(text.slice('__RJF__'.length));
          } else {
            pasteData = JSON.parse(text);
          }
        } catch {
          const currentValue = getValueAtPath(root, selectedPath || '');
          if (typeof currentValue === 'string') {
            pasteData = text;
          } else {
            return;
          }
        }
      }
      const newRoot = setValueAtPath(root, selectedPath || '', pasteData);
      setRootData(newRoot);
      e.preventDefault();
      e.stopPropagation();
    };

    document.addEventListener('copy', onCopy, true);
    document.addEventListener('paste', onPaste, true);
    return () => {
      document.removeEventListener('copy', onCopy, true);
      document.removeEventListener('paste', onPaste, true);
    };
  }, [getRootData, setRootData, selectedPath, readonly]);

  return null;
};

export default ClipboardManager;
