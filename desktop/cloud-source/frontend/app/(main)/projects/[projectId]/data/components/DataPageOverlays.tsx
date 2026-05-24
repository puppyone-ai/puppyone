'use client';

import type { RefObject } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { CreateMenu } from './menus/CreateMenu';
import type { CreateMenuPosition, DataCreateMenuActions } from '../hooks/useDataCreateFlow';
import type { DataPageToast } from '../hooks/useNodeActions';

interface DataPageOverlaysProps {
  toast: DataPageToast | null;
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
  const isError = toast?.type === 'error';
  const isLoading = toast?.type === 'loading';

  return (
    <>
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            background: isError
              ? 'var(--po-danger)'
              : isLoading
                ? 'var(--po-panel-raised)'
                : 'var(--po-success)',
            color: isLoading ? 'var(--po-text)' : 'var(--po-text-inverse)',
            border: isLoading ? '1px solid var(--po-border)' : '1px solid transparent',
            padding: '8px 16px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
            zIndex: 10001,
            boxShadow: '0 4px 12px var(--po-shadow)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {isLoading ? (
            <Loader2 size={14} strokeWidth={2.4} className="animate-spin" />
          ) : isError ? (
            <X size={14} strokeWidth={2.6} />
          ) : (
            <Check size={14} strokeWidth={2.6} />
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
