'use client';

import React from 'react';
import { resolveFormat } from '@/lib/fileFormats';
import type { EditorType } from '@/components/ProjectsHeader';

interface BottomBarProps {
  /** JSON viewer sub-mode: structured table vs raw Monaco. Only
   *  rendered when the active file is a `json-table` format. */
  editorType: EditorType;
  setEditorType: (e: EditorType) => void;
  /** True when the right panel is showing the editor (vs. the file
   *  tree / dashboard). Hides toggles when no editor is mounted. */
  isEditorView: boolean;
  /** Path of the currently active file. Drives file-format resolution
   *  for deciding which view-mode toggle to show. */
  activeNodeId?: string;
  activeMimeType?: string | null;
  activeProject: { id: string } | null;
}

const toggleGroupStyle: React.CSSProperties = {
  display: 'flex', background: '#141414', borderRadius: 6, padding: 2, gap: 1, border: '1px solid #1f1f1f',
};

function ToggleButton({ active, onClick, title, children }: {
  active: boolean; onClick: () => void; title: string; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 24, height: 24, borderRadius: 4, border: 'none',
        background: active ? '#2a2a2a' : 'transparent',
        color: active ? '#fff' : '#525252',
        cursor: 'pointer', transition: 'all 0.15s ease',
      }}
      title={title}
    >
      {children}
    </button>
  );
}

export function BottomBar({
  editorType, setEditorType,
  isEditorView, activeNodeId, activeMimeType, activeProject,
}: BottomBarProps) {
  // Resolve the file format from the active path — extension first,
  // mime fallback. The format is what tells us which (if any) view-mode
  // toggle is meaningful for the current viewer.
  const format = activeNodeId
    ? resolveFormat({ name: activeNodeId, mimeType: activeMimeType ?? null })
    : null;
  const showJsonToggle =
    isEditorView && activeProject && format?.defaultViewer === 'json-table';

  // Markdown's WYSIWYG/Source toggle now lives in the editor's
  // invisible header (see ``EditorArea.tsx``) — it doesn't appear
  // here anymore. JSON's table/raw toggle stays put because the
  // json-table viewer ships its own surface that isn't a candidate
  // for the same header treatment.
  if (!showJsonToggle) return null;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '4px 8px', flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={toggleGroupStyle}>
          <ToggleButton active={editorType === 'table'} onClick={() => setEditorType('table')} title="Table view">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" />
            </svg>
          </ToggleButton>
          <ToggleButton active={editorType === 'monaco'} onClick={() => setEditorType('monaco')} title="Raw JSON">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M7 4C5.5 4 4 5 4 7s1.5 2.5 1.5 5S4 17 4 17c0 2 1.5 3 3 3" strokeLinecap="round" />
              <path d="M17 4c1.5 0 3 1 3 3s-1.5 2.5-1.5 5 1.5 5 1.5 5c0 2-1.5 3-3 3" strokeLinecap="round" />
            </svg>
          </ToggleButton>
        </div>
      </div>

      <div />
    </div>
  );
}
