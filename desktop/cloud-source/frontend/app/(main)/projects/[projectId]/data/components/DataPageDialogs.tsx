'use client';
import { TableManageDialog } from '@/components/TableManageDialog';
import { FolderManageDialog } from '@/components/FolderManageDialog';
import { FileImportDialog } from '@/components/FileImportDialog';
import { SupabaseConnectDialog } from '@/components/SupabaseConnectDialog';
import { SupabaseSQLEditorDialog } from '@/components/SupabaseSQLEditorDialog';
import { NodeRenameDialog } from '@/components/NodeRenameDialog';
import { MoveToDialog } from '@/components/MoveToDialog';
import { BulkDeleteDialog } from './BulkDeleteDialog';

export interface DataPageDialogsProps {
  projectId: string;
  currentFolderId: string | null;
  projects: any[];
  activeProject: any;

  // Rename
  renameDialogOpen: boolean;
  renameTargetName: string;
  renameError: string | null;
  onCloseRename: () => void;
  onRenameConfirm: (newName: string) => Promise<void>;

  // Move
  moveDialogTarget: { id: string; name: string; mut_path?: string } | null;
  onMoveConfirm: (nodeId: string, targetFolderId: string | null) => Promise<void>;
  onCloseMove: () => void;

  // Delete
  deleteDialogTarget: { id: string; name: string } | null;
  onDeleteConfirm: () => Promise<void>;
  onCloseDelete: () => void;

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
  fileImportTargetLabel: string;
}

export function DataPageDialogs(props: DataPageDialogsProps) {
  const {
    projectId, currentFolderId, projects, activeProject,
    renameDialogOpen, renameTargetName, renameError, onCloseRename, onRenameConfirm,
    moveDialogTarget, onMoveConfirm, onCloseMove,
    deleteDialogTarget, onDeleteConfirm, onCloseDelete,
    createTableOpen, onCloseCreateTable, defaultStartOption,
    createFolderOpen, onCloseFolderDialog, onFolderSuccess,
    supabaseConnectOpen, onCloseSupabaseConnect, onSupabaseConnected,
    supabaseSQLEditorOpen, supabaseConnectionId, onCloseSupabaseSQLEditor, onSupabaseSaved,
    fileImportDialogOpen, onCloseFileImport, onFileImportConfirm, droppedFiles, fileImportTargetLabel,
  } = props;

  return (
    <>
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
          nodeMutPath={moveDialogTarget.mut_path}
          onConfirm={async (targetFolderId) => {
            await onMoveConfirm(moveDialogTarget.id, targetFolderId);
          }}
          onClose={onCloseMove}
        />
      )}

      {deleteDialogTarget && (
        <BulkDeleteDialog
          open={true}
          paths={[deleteDialogTarget.id]}
          title={`Delete "${deleteDialogTarget.name}"`}
          noticeTitle={`Delete "${deleteDialogTarget.name}"?`}
          description="This removes the item from the current tree. Previous versions stay recoverable from Puppyone history."
          confirmLabel="Delete"
          onClose={onCloseDelete}
          onConfirm={onDeleteConfirm}
        />
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
        targetLabel={fileImportTargetLabel}
      />

      {/* HIDDEN: Tool Creation Panel temporarily disabled */}
    </>
  );
}
