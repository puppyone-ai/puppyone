import type { ChangeEvent, Dispatch, DragEvent, RefObject, SetStateAction } from 'react';
import type { BatchPolicyResult, PolicyReason } from '@/lib/uploadPolicy';

export type FileImportMode = 'ocr_parse' | 'raw';

export interface FileImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (files: File[], mode: FileImportMode) => void;
  /** Files that were already selected by a parent drag/drop or picker flow. */
  initialFiles?: File[];
  /** Display label for the upload destination folder. */
  targetLabel?: string;
}

export interface FileImportStats {
  textCount: number;
  binaryCount: number;
  extensions: string[];
}

export type PreviewTreeKind = 'folder' | 'file';

export interface PreviewTreeNode {
  kind: PreviewTreeKind;
  name: string;
  path: string;
  children: PreviewTreeNode[];
  fileCount: number;
  sizeBytes: number;
  folderIndex?: Map<string, PreviewTreeNode>;
}

export interface PreviewTreeRow {
  kind: PreviewTreeKind;
  name: string;
  path: string;
  depth: number;
  fileCount: number;
  sizeBytes: number;
}

export interface PreviewTreeResult {
  rows: PreviewTreeRow[];
  totalRows: number;
}

export interface SkippedSummaryRow {
  label: string;
  count: number;
  reason?: PolicyReason;
  toggle?: () => void;
  toggleValue?: boolean;
}

export interface FileImportSelectionState {
  files: File[];
  isDragging: boolean;
  policyResult: BatchPolicyResult;
  fileStats: FileImportStats;
  previewTree: PreviewTreeResult;
  includeHidden: boolean;
  includeIgnored: boolean;
  fileInputRef: RefObject<HTMLInputElement>;
  folderInputRef: RefObject<HTMLInputElement>;
  handleDragEnter: (event: DragEvent) => void;
  handleDragLeave: (event: DragEvent) => void;
  handleDragOver: (event: DragEvent) => void;
  handleDrop: (event: DragEvent) => void;
  handleFileSelect: (event: ChangeEvent<HTMLInputElement>) => void;
  handlePickFiles: () => void;
  handlePickFolder: () => Promise<void>;
  setIncludeHidden: Dispatch<SetStateAction<boolean>>;
  setIncludeIgnored: Dispatch<SetStateAction<boolean>>;
}
