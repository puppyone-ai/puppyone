'use client';

import type { RefObject } from 'react';
import { CreateMenu } from './menus/CreateMenu';
import type { CreateMenuPosition, DataCreateMenuActions } from '../hooks/useDataCreateFlow';

interface DataPageOverlaysProps {
  toast: { message: string; type: 'success' | 'error' } | null;
  createMenuOpen: boolean;
  createMenuPosition: CreateMenuPosition | null;
  // When the menu was opened by a per-folder plug button rather
  // than the regular `+`, this flag flips CreateMenu into its
  // `accessOnly` rendering — flat list of providers / agents /
  // endpoints, no Create Blank / Upload sections.  Same menu
  // instance, different layout based on intent.
  createMenuAccessOnly: boolean;
  createMenuRef: RefObject<HTMLDivElement>;
  createMenuActions: DataCreateMenuActions;
}

export function DataPageOverlays({
  toast,
  createMenuOpen,
  createMenuPosition,
  createMenuAccessOnly,
  createMenuRef,
  createMenuActions,
}: DataPageOverlaysProps) {
  return (
    <>
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            background: toast.type === 'error' ? '#dc2626' : '#16a34a',
            color: '#fff',
            padding: '8px 16px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
            zIndex: 10001,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {toast.type === 'success' ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          )}
          {toast.message}
        </div>
      )}

      {createMenuOpen && createMenuPosition && (
        <div ref={createMenuRef}>
          <CreateMenu
            x={createMenuPosition.x}
            y={createMenuPosition.y}
            anchorLeft={createMenuPosition.anchorLeft}
            accessOnly={createMenuAccessOnly}
            onClose={createMenuActions.onClose}
            onCreateFolder={createMenuActions.onCreateFolder}
            onCreateBlankJson={createMenuActions.onCreateBlankJson}
            onCreateBlankMarkdown={createMenuActions.onCreateBlankMarkdown}
            onImportFromFiles={createMenuActions.onImportFromFiles}
            onImportFromUrl={createMenuActions.onImportFromUrl}
            onImportFromSaas={createMenuActions.onImportFromSaas}
            onImportNotion={createMenuActions.onImportNotion}
            onImportGitHub={createMenuActions.onImportGitHub}
            onImportGmail={createMenuActions.onImportGmail}
            onImportDocs={createMenuActions.onImportDocs}
            onImportCalendar={createMenuActions.onImportCalendar}
            onImportSheets={createMenuActions.onImportSheets}
            onConnectSupabase={createMenuActions.onConnectSupabase}
            onImportSearchConsole={createMenuActions.onImportSearchConsole}
            onImportLocalFolder={createMenuActions.onImportLocalFolder}
            onCreateAgent={createMenuActions.onCreateAgent}
            onCreateMcp={createMenuActions.onCreateMcp}
            onCreateSandbox={createMenuActions.onCreateSandbox}
          />
        </div>
      )}
    </>
  );
}
