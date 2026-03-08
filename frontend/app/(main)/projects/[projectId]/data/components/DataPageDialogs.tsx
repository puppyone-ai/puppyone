'use client';

import React from 'react';
import { TableManageDialog } from '@/components/TableManageDialog';
import { FolderManageDialog } from '@/components/FolderManageDialog';
import { FileImportDialog } from '@/components/FileImportDialog';
import { SupabaseConnectDialog } from '@/components/SupabaseConnectDialog';
import { SupabaseSQLEditorDialog } from '@/components/SupabaseSQLEditorDialog';
import { NodeRenameDialog } from '@/components/NodeRenameDialog';
import { MoveToDialog } from '@/components/MoveToDialog';
import { NodeAccessPanel } from '@/components/NodeAccessPanel';
import { OnboardingGuide } from '@/components/onboarding/OnboardingGuide';
import { CreateMenu } from '../../../[[...slug]]/components/finder';

export interface CreateMenuActions {
  onClose: () => void;
  onCreateFolder: () => void;
  onCreateBlankJson: () => void;
  onCreateBlankMarkdown: () => void;
  onImportFromFiles: () => void;
  onImportFromUrl: () => void;
  onImportFromSaas: () => void;
  onImportNotion: () => void;
  onImportGitHub: () => void;
  onImportGmail: () => void;
  onImportDocs: () => void;
  onImportCalendar: () => void;
  onImportSheets: () => void;
  onConnectSupabase: () => void;
}

export interface DataPageDialogsProps {
  projectId: string;
  currentFolderId: string | null;
  projects: any[];
  activeProject: any;
  activeNodeId: string;

  // Onboarding
  showOnboardingGuide: boolean;
  onCloseOnboarding: () => void;
  onOnboardingComplete: () => void;
  userName?: string;

  // Rename
  renameDialogOpen: boolean;
  renameTargetName: string;
  renameError: string | null;
  onCloseRename: () => void;
  onRenameConfirm: (newName: string) => Promise<void>;

  // Move
  moveDialogTarget: { id: string; name: string; id_path?: string } | null;
  onMoveConfirm: (nodeId: string, targetFolderId: string | null) => Promise<void>;
  onCloseMove: () => void;

  // Toast
  toast: { message: string; type: 'success' | 'error' } | null;

  // Create Menu
  createMenuOpen: boolean;
  createMenuPosition: { x: number; y: number; anchorLeft: number } | null;
  createMenuRef: React.RefObject<HTMLDivElement>;
  createMenuActions: CreateMenuActions;

  // Table manage dialog
  createTableOpen: boolean;
  onCloseCreateTable: () => void;
  defaultStartOption: 'documents' | 'url';

  // Folder manage dialog
  createFolderOpen: boolean;
  onCloseFolderDialog: () => void;
  onFolderSuccess: () => void;

  // Supabase
  supabaseConnectOpen: boolean;
  onCloseSupabaseConnect: () => void;
  onSupabaseConnected: (connectionId: string) => void;
  supabaseSQLEditorOpen: boolean;
  supabaseConnectionId: string | null;
  onCloseSupabaseSQLEditor: () => void;
  onSupabaseSaved: () => void;

  // File Import
  fileImportDialogOpen: boolean;
  onCloseFileImport: () => void;
  onFileImportConfirm: (files: File[], mode: 'ocr_parse' | 'raw') => void;
  droppedFiles: File[];

  // Tool panel
  toolPanelTarget: { id: string; name: string; type: string; jsonPath?: string } | null;
  onCloseToolPanel: () => void;
  projectTools: any[];
  onToolsChange: () => void;
}

export function DataPageDialogs(props: DataPageDialogsProps) {
  const {
    projectId, currentFolderId, projects, activeProject,
    showOnboardingGuide, onCloseOnboarding, onOnboardingComplete, userName,
    renameDialogOpen, renameTargetName, renameError, onCloseRename, onRenameConfirm,
    moveDialogTarget, onMoveConfirm, onCloseMove,
    toast,
    createMenuOpen, createMenuPosition, createMenuRef, createMenuActions,
    createTableOpen, onCloseCreateTable, defaultStartOption,
    createFolderOpen, onCloseFolderDialog, onFolderSuccess,
    supabaseConnectOpen, onCloseSupabaseConnect, onSupabaseConnected,
    supabaseSQLEditorOpen, supabaseConnectionId, onCloseSupabaseSQLEditor, onSupabaseSaved,
    fileImportDialogOpen, onCloseFileImport, onFileImportConfirm, droppedFiles,
    toolPanelTarget, onCloseToolPanel, projectTools, onToolsChange,
  } = props;

  return (
    <>
      {/* Onboarding */}
      <OnboardingGuide
        isOpen={showOnboardingGuide}
        onClose={onCloseOnboarding}
        onComplete={onOnboardingComplete}
        userName={userName}
      />

      {/* Rename Dialog */}
      <NodeRenameDialog
        isOpen={renameDialogOpen}
        currentName={renameTargetName}
        onClose={onCloseRename}
        onConfirm={onRenameConfirm}
        error={renameError}
      />

      {/* Move To Dialog */}
      {moveDialogTarget && (
        <MoveToDialog
          isOpen={true}
          projectId={projectId}
          nodeId={moveDialogTarget.id}
          nodeName={moveDialogTarget.name}
          nodeIdPath={moveDialogTarget.id_path}
          onConfirm={async (targetFolderId) => {
            await onMoveConfirm(moveDialogTarget.id, targetFolderId);
          }}
          onClose={onCloseMove}
        />
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          background: toast.type === 'error' ? '#dc2626' : '#16a34a',
          color: '#fff', padding: '8px 16px', borderRadius: 8,
          fontSize: 13, fontWeight: 500, zIndex: 10001,
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
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

      {/* Create Menu */}
      {createMenuOpen && createMenuPosition && (
        <div ref={createMenuRef}>
          <CreateMenu
            x={createMenuPosition.x}
            y={createMenuPosition.y}
            anchorLeft={createMenuPosition.anchorLeft}
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
          />
        </div>
      )}

      {/* Table Create Dialog */}
      {createTableOpen && (
        <TableManageDialog
          mode='create'
          projectId={projectId}
          tableId={null}
          parentId={currentFolderId}
          projects={projects}
          onClose={onCloseCreateTable}
          defaultStartOption={defaultStartOption}
        />
      )}

      {/* Folder Create Dialog */}
      {createFolderOpen && (
        <FolderManageDialog
          projectId={projectId}
          parentId={currentFolderId}
          parentPath={activeProject?.name || ''}
          onClose={onCloseFolderDialog}
          onSuccess={onFolderSuccess}
        />
      )}

      {/* Supabase Connect */}
      {supabaseConnectOpen && (
        <SupabaseConnectDialog
          projectId={projectId}
          onClose={onCloseSupabaseConnect}
          onConnected={onSupabaseConnected}
        />
      )}

      {/* Supabase SQL Editor */}
      {supabaseSQLEditorOpen && supabaseConnectionId && (
        <SupabaseSQLEditorDialog
          projectId={projectId}
          connectionId={supabaseConnectionId}
          onClose={onCloseSupabaseSQLEditor}
          onSaved={onSupabaseSaved}
        />
      )}

      {/* File Import (from drag-and-drop) */}
      <FileImportDialog
        isOpen={fileImportDialogOpen}
        onClose={onCloseFileImport}
        onConfirm={onFileImportConfirm}
        initialFiles={droppedFiles.length > 0 ? droppedFiles : undefined}
      />

      {/* HIDDEN: Tool Creation Panel temporarily disabled */}
    </>
  );
}
