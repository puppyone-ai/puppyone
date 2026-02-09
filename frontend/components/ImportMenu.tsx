'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../app/supabase/SupabaseAuthProvider';
import { ImportModal } from './editors/tree/components/ImportModal';
import { uploadAndSubmit } from '../lib/etlApi';
import {
  addPendingTasks,
  replacePlaceholderTasks,
  removeFailedPlaceholders,
  removeAllPlaceholdersForTable,
} from './BackgroundTaskNotifier';
import { FileImportDialog } from './FileImportDialog';

interface ImportMenuProps {
  projectId?: string;
  onProjectsRefresh?: () => void;
  onLog?: (
    type: 'error' | 'warning' | 'info' | 'success',
    message: string
  ) => void;
  onCloseOtherMenus?: () => void;
}

// 辅助函数：检查文件是否需要 ETL 处理
function needsETL(file: File): boolean {
  const etlExtensions = [
    '.pdf',
    '.doc',
    '.docx',
    '.ppt',
    '.pptx',
    '.jpg',
    '.jpeg',
    '.png',
    '.tiff',
    '.bmp',
  ];
  const fileName = file.name.toLowerCase();
  return etlExtensions.some(ext => fileName.endsWith(ext));
}

// 辅助函数：获取文件类型
function getFileType(file: File): string {
  const fileName = file.name.toLowerCase();
  const extension = fileName.substring(fileName.lastIndexOf('.') + 1);
  return extension;
}

// 辅助函数：检查文件是否为文本文件
async function isTextFileType(file: File): Promise<boolean> {
  // 如果需要 ETL，不是文本文件
  if (needsETL(file)) {
    return false;
  }

  const textFileExtensions = [
    '.txt',
    '.md',
    '.json',
    '.js',
    '.ts',
    '.jsx',
    '.tsx',
    '.py',
    '.java',
    '.cpp',
    '.c',
    '.h',
    '.html',
    '.css',
    '.scss',
    '.less',
    '.xml',
    '.yaml',
    '.yml',
    '.toml',
    '.ini',
    '.cfg',
    '.sql',
    '.sh',
    '.bat',
    '.ps1',
    '.log',
    '.csv',
    '.tsv',
    '.r',
    '.m',
    '.pl',
    '.rb',
    '.go',
    '.rs',
    '.swift',
    '.kt',
    '.scala',
    '.php',
    '.rb',
    '.coffee',
    '.dart',
    '.lua',
  ];

  const binaryFileExtensions = [
    '.zip',
    '.rar',
    '.tar',
    '.gz',
    '.gif',
    '.svg',
    '.webp',
    '.ico',
    '.mp3',
    '.mp4',
    '.avi',
    '.mov',
    '.wmv',
    '.flv',
    '.mkv',
    '.webm',
    '.exe',
    '.dll',
    '.so',
    '.dylib',
    '.bin',
    '.iso',
    '.img',
    '.dmg',
    '.pkg',
    '.deb',
    '.rpm',
    '.msi',
    '.app',
    '.apk',
    '.ipa',
    '.xls',
    '.xlsx', // Excel files not supported by ETL yet
  ];

  const fileName = file.name.toLowerCase();
  const extension = fileName.substring(fileName.lastIndexOf('.'));

  // 明确的二进制文件
  if (binaryFileExtensions.some(ext => fileName.endsWith(ext))) {
    return false;
  }

  // 明确的文本文件
  if (textFileExtensions.some(ext => fileName.endsWith(ext))) {
    return true;
  }

  // 对于未知扩展名，检查文件头
  const buffer = await file.slice(0, 1024).arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // 检查是否包含null字节（二进制文件的典型特征）
  if (bytes.includes(0)) {
    return false;
  }

  // 检查是否大部分为可打印ASCII字符
  let printableCount = 0;
  for (let i = 0; i < Math.min(bytes.length, 512); i++) {
    const byte = bytes[i];
    if (
      (byte >= 32 && byte <= 126) ||
      byte === 9 ||
      byte === 10 ||
      byte === 13
    ) {
      printableCount++;
    }
  }

  return printableCount / Math.min(bytes.length, 512) > 0.7;
}

// 辅助函数：清理Unicode内容
function sanitizeUnicodeContent(content: string): string {
  return (
    content
      // 移除null字符和其他控制字符
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
      // 替换其他可能有问题的Unicode字符
      .replace(/[\uFFFE\uFFFF]/g, '')
      // 确保字符串以有效的JSON开头（如果是JSON的话）
      .trim()
  );
}

export function ImportMenu({
  projectId,
  onProjectsRefresh,
  onLog,
  onCloseOtherMenus,
}: ImportMenuProps) {
  const router = useRouter();
  const { session } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [tableName, setTableName] = useState('');
  const [menuPosition, setMenuPosition] = useState<'center' | 'right'>(
    'center'
  );
  const [urlInput, setUrlInput] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [fileImportDialogOpen, setFileImportDialogOpen] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dropzoneRef = useRef<HTMLDivElement>(null);

  // Calculate menu position to prevent overflow
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const buttonRect = buttonRef.current.getBoundingClientRect();
      const menuWidth = 280;
      const rightEdge = buttonRect.left + buttonRect.width / 2 + menuWidth / 2;
      const viewportWidth = window.innerWidth;

      if (rightEdge > viewportWidth - 16) {
        setMenuPosition('right');
      } else {
        setMenuPosition('center');
      }
    }
  }, [isOpen]);

  // Close menu when clicking outside
  // 但当 FileImportDialog 打开时不关闭
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // 如果 FileImportDialog 或 ImportModal 打开，不处理外部点击
      if (fileImportDialogOpen || showImportModal) {
        return;
      }
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, fileImportDialogOpen, showImportModal]);

  // Drag and drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === dropzoneRef.current) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      // 直接打开文件导入对话框
      // FileImportDialog 内部支持拖放和浏览
      setFileImportDialogOpen(true);
    },
    []
  );

  /**
   * Parse folder structure
   * - ETL files use null as placeholder
   * - Text files are read directly
   */
  const parseFolderStructure = useCallback(async (
    files: FileList,
    onProgress?: (current: number, total: number) => void
  ): Promise<{ structure: Record<string, any>; etlFiles: File[] }> => {
    const structure: Record<string, any> = {};
    const etlFiles: File[] = [];
    const fileArray = Array.from(files);
    const totalFiles = fileArray.length;
    let processedFiles = 0;

    for (const file of fileArray) {
      const pathParts = file.webkitRelativePath
        ? file.webkitRelativePath.split('/').filter(Boolean).slice(1)
        : [file.name];

      if (pathParts.length === 0) {
        processedFiles++;
        onProgress?.(processedFiles, totalFiles);
        continue;
      }

      let current = structure;
      for (let i = 0; i < pathParts.length - 1; i++) {
        const folderName = pathParts[i];
        if (!current[folderName] || typeof current[folderName] !== 'object') {
          current[folderName] = {};
        }
        current = current[folderName];
      }

      const fileName = pathParts[pathParts.length - 1];

      try {
        if (needsETL(file)) {
          current[fileName] = null;
          etlFiles.push(file);
          onLog?.('info', `Found ${fileName} for processing...`);
        } else {
          const isTextFile = await isTextFileType(file);
          if (isTextFile) {
            let content = await file.text();
            current[fileName] = sanitizeUnicodeContent(content);
          } else {
            current[fileName] = null;
          }
        }
      } catch (error) {
        console.error(`Failed to process file ${fileName}:`, error);
        current[fileName] = null;
      }

      processedFiles++;
      onProgress?.(processedFiles, totalFiles);
    }

    return { structure, etlFiles };
  }, [onLog]);

  // Handler for file import dialog confirmation
  const handleFileImportConfirm = useCallback(async (
    importFiles: File[], 
    mode: 'ocr_parse' | 'raw'
  ) => {
    setFileImportDialogOpen(false);
    if (!projectId || importFiles.length === 0) return;

    setIsImporting(true);
    setIsOpen(false);

    try {
      onLog?.('info', `Uploading ${importFiles.length} file(s)...`);

      // 添加占位任务到右下角进度面板
        const baseTimestamp = Date.now();
      const placeholderGroupId = `upload-${baseTimestamp}`;
      const placeholderTasks = importFiles.map((file, index) => ({
          taskId: `placeholder-${baseTimestamp}-${index}-${Math.random().toString(36).slice(2, 8)}`,
          projectId: projectId,
        tableId: placeholderGroupId,
        tableName: file.name,
          filename: file.name,
          status: 'pending' as const,
        taskType: 'file' as const,
        }));
        addPendingTasks(placeholderTasks);

      if (!session?.access_token) {
        throw new Error('Not authenticated');
          }

      // 直接上传文件到后端，后端负责创建所有节点
      // 不再前端先创建 table/folder —— 这会导致重复记录
            const response = await uploadAndSubmit(
              {
          projectId: projectId,
          files: importFiles,
          mode: mode,
          // parent_id 未指定，后端创建在根级别
              },
              session.access_token
            );

      // 用真实任务替换占位任务
      const filenameMap = new Map<string, string>();
      importFiles.forEach(f => filenameMap.set(f.name, f.name));

            const realTasks = response.items
              .filter(item => item.status !== 'failed')
              .map(item => ({
                taskId: String(item.task_id),
                projectId: projectId,
          tableId: placeholderGroupId,
          tableName: filenameMap.get(item.filename!) || item.filename!,
                filename: filenameMap.get(item.filename!) || item.filename!,
                status: (item.status === 'completed' ? 'completed' : 'pending') as any,
          taskType: 'file' as const,
              }));

            if (realTasks.length > 0) {
        replacePlaceholderTasks(placeholderGroupId, realTasks);
            }

      const failedFiles = response.items.filter(item => item.status === 'failed');
            if (failedFiles.length > 0) {
              console.warn('Some files failed to upload:', failedFiles);
        onLog?.('warning', `${failedFiles.length} file(s) failed to upload`);
              const failedFileNames = failedFiles.map(
                f => filenameMap.get(f.filename!) || f.filename!
              );
        removeFailedPlaceholders(placeholderGroupId, failedFileNames);
            }

      const successCount = response.items.filter(i => i.status !== 'failed').length;
      onLog?.('success', `${successCount} file(s) uploaded successfully!`);
      onProjectsRefresh?.();
      setTableName('');
      setIsImporting(false);
    } catch (error) {
      onLog?.(
        'error',
        `Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      setIsImporting(false);
    }
  }, [projectId, session?.access_token, onLog, onProjectsRefresh]);

  return (
    <div ref={menuRef} style={{ position: 'relative' }}>
      <button
        ref={buttonRef}
        onClick={() => {
          setIsOpen(!isOpen);
          onCloseOtherMenus?.();
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          height: 32,
          padding: '0 12px',
          borderRadius: 6,
          border: '1px solid',
          borderColor: isOpen ? '#525252' : '#404040',
          background: isOpen ? 'rgba(255,255,255,0.05)' : 'transparent',
          color: isOpen ? '#e2e8f0' : '#9ca3af',
          fontSize: 12,
          fontWeight: 500,
          cursor: 'pointer',
          transition: 'all 0.15s',
        }}
        onMouseEnter={e => {
          if (!isOpen) {
            e.currentTarget.style.borderColor = '#525252';
            e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
            e.currentTarget.style.color = '#e2e8f0';
          }
        }}
        onMouseLeave={e => {
          if (!isOpen) {
            e.currentTarget.style.borderColor = '#404040';
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = '#9ca3af';
          }
        }}
      >
        <svg
          width='14'
          height='14'
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
        >
          <path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' />
          <polyline points='17 8 12 3 7 8' />
          <line x1='12' y1='3' x2='12' y2='15' />
        </svg>
        <span>Import</span>
      </button>

      {isOpen && (
        <div
          ref={dropdownRef}
          style={{
            position: 'absolute',
            top: 36,
            ...(menuPosition === 'center'
              ? { left: '50%', transform: 'translateX(-50%)' }
              : { right: 0 }),
            width: 280,
            background: '#161618',
            border: '1px solid #2a2a2a',
            borderRadius: 10,
            zIndex: 50,
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '12px 14px',
              borderBottom: '1px solid #2a2a2a',
              fontSize: 14,
              fontWeight: 500,
              color: '#9ca3af',
            }}
          >
            Import to this context
          </div>

          {/* Main Content */}
          <div style={{ padding: 12 }}>
            {isImporting ? (
              /* Progress View */
              <div style={{ padding: '20px 16px', textAlign: 'center' }}>
                <div
                  style={{ fontSize: 14, color: '#9ca3af', marginBottom: 10 }}
                >
                  Importing... {Math.round(importProgress)}%
                </div>
                <div
                  style={{
                    height: 4,
                    background: '#2a2a2a',
                    borderRadius: 2,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${importProgress}%`,
                      height: '100%',
                      background: '#34d399',
                      transition: 'width 0.2s',
                    }}
                  />
                </div>
              </div>
            ) : (
              <>
                {/* Dropzone - 点击或拖放都打开统一对话框 */}
                <div
                  ref={dropzoneRef}
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onClick={() => setFileImportDialogOpen(true)}
                  style={{
                    padding: '16px',
                    border: '1px dashed',
                    borderColor: isDragging ? '#525252' : '#333',
                    borderRadius: 8,
                    background: isDragging
                      ? 'rgba(255,255,255,0.03)'
                      : 'transparent',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    textAlign: 'center',
                    marginBottom: 10,
                  }}
                >
                  <svg
                    width='20'
                    height='20'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='#525252'
                    strokeWidth='1.5'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    style={{ margin: '0 auto 8px' }}
                  >
                    <path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' />
                    <polyline points='17 8 12 3 7 8' />
                    <line x1='12' y1='3' x2='12' y2='15' />
                  </svg>
                  <div style={{ fontSize: 14, color: '#9ca3af' }}>
                    Import files...
                  </div>
                </div>

                {/* Options */}
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 2 }}
                >
                  {/* URL Input - Opens /connect page */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 10px',
                      borderRadius: 6,
                    }}
                  >
                    <svg
                      width='16'
                      height='16'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='#9ca3af'
                      strokeWidth='1.5'
                      strokeLinecap='round'
                      strokeLinejoin='round'
                    >
                      <path d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' />
                      <path d='M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' />
                    </svg>
                    <input
                      type='text'
                      placeholder='Paste URL (opens in Connect page)...'
                      value={urlInput}
                      onChange={e => setUrlInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && urlInput.trim()) {
                          setShowImportModal(true);
                        }
                      }}
                      style={{
                        flex: 1,
                        background: 'transparent',
                        border: 'none',
                        outline: 'none',
                        fontSize: 14,
                        color: '#e2e8f0',
                      }}
                    />
                    {urlInput.trim() && (
                      <button
                        onClick={() => {
                          setShowImportModal(true);
                        }}
                        style={{
                          padding: '4px 10px',
                          background: '#34d399',
                          border: 'none',
                          borderRadius: 4,
                          color: '#000',
                          fontSize: 12,
                          fontWeight: 500,
                          cursor: 'pointer',
                        }}
                        onMouseEnter={e => {
                          e.currentTarget.style.background = '#2dd38d';
                        }}
                        onMouseLeave={e => {
                          e.currentTarget.style.background = '#34d399';
                        }}
                      >
                        Go
                      </button>
                    )}
                  </div>

                  {/* Connect Service - Link to /connect page */}
                  <button
                    onClick={() => {
                      setIsOpen(false);
                      router.push('/connect');
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '8px 10px',
                      background: 'transparent',
                      border: 'none',
                      borderRadius: 6,
                      cursor: 'pointer',
                      color: '#9ca3af',
                      fontSize: 14,
                      textAlign: 'left',
                      width: '100%',
                      transition: 'all 0.1s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background =
                        'rgba(255,255,255,0.05)';
                      e.currentTarget.style.color = '#e2e8f0';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = '#9ca3af';
                    }}
                  >
                    <svg
                      width='16'
                      height='16'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      strokeWidth='1.5'
                      strokeLinecap='round'
                      strokeLinejoin='round'
                    >
                      <ellipse cx='12' cy='5' rx='9' ry='3' />
                      <path d='M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5' />
                      <path d='M21 12c0 1.66-4 3-9 3s-9-1.34-9-3' />
                    </svg>
                    <span style={{ flex: 1 }}>Connect Service</span>
                    <svg
                      width='12'
                      height='12'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='#525252'
                      strokeWidth='2'
                      strokeLinecap='round'
                      strokeLinejoin='round'
                    >
                      <path d='M7 17L17 7M17 7H7M17 7V17' />
                    </svg>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Import Modal for URL import */}
      {showImportModal && projectId && (
        <ImportModal
          visible={showImportModal}
          projectId={projectId}
          mode='create_table'
          tableName={tableName}
          initialUrl={urlInput}
          onClose={() => {
            setShowImportModal(false);
            setUrlInput('');
          }}
          onSuccess={result => {
            setShowImportModal(false);
            setUrlInput('');
            setIsOpen(false);
            onProjectsRefresh?.();
            onLog?.('success', `Table created successfully`);
          }}
        />
      )}

      {/* File Import Dialog - 统一的拖放 + 模式选择界面 */}
      <FileImportDialog
        isOpen={fileImportDialogOpen}
        onClose={() => setFileImportDialogOpen(false)}
        onConfirm={handleFileImportConfirm}
      />
    </div>
  );
}
