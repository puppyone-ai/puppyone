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
import { createTable } from '../lib/projectsApi';

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

  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
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
  }, [isOpen]);

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

      const items = e.dataTransfer.items;
      if (items && items.length > 0) {
        // Check if it's a folder
        const item = items[0];
        if (item.webkitGetAsEntry) {
          const entry = item.webkitGetAsEntry();
          if (entry?.isDirectory) {
            // For folders, we need to use the file input
            // Show a message that folder needs to be selected via browse
            onLog?.('info', 'For folders, please use "Browse folder" option');
            fileInputRef.current?.click();
            return;
          }
        }
      }

      // Handle files
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        handleFilesSelected(files);
      }
    },
    [onLog]
  );

  const handleFilesSelected = async (files: FileList) => {
    if (!projectId) {
      onLog?.('error', 'No project selected');
      return;
    }

    const finalTableName = tableName.trim()
      ? tableName.replace(/[^a-zA-Z0-9_-]/g, '_')
      : `context_${Date.now()}`;

    setIsImporting(true);

    try {
      onLog?.('info', 'Preparing files...');

      // 1. 解析文件结构，收集需要 ETL 的文件（这步很快）
      const { structure: folderStructure, etlFiles } =
        await parseFolderStructure(files);

      // 2. 创建 Table（包含文本文件内容和 ETL 文件的 null 占位符）
      onLog?.('info', 'Creating table...');
      const newTable = await createTable(
        projectId,
        finalTableName,
        folderStructure
      );
      const newTableId = newTable.id;

      // 3. 如果有 ETL 文件，先预先添加"准备上传"状态的任务
      //    这样侧边栏能立即显示转圈样式
      if (etlFiles.length > 0) {
        const baseTimestamp = Date.now();
        const placeholderTasks = etlFiles.map((file, index) => ({
          taskId: `placeholder-${baseTimestamp}-${index}-${Math.random().toString(36).slice(2, 8)}`,
          projectId: projectId,
          tableId: String(newTableId),
          tableName: finalTableName,
          filename: file.name,
          status: 'pending' as const,
        }));
        addPendingTasks(placeholderTasks);
      }

      // 4. 立即关闭菜单，刷新项目列表
      onLog?.('success', `Table "${finalTableName}" created!`);
      onProjectsRefresh?.();
      setTableName('');
      setIsOpen(false);
      setIsImporting(false);

      // 5. 后台上传 ETL 文件（菜单已关闭，用户可以继续其他操作）
      if (etlFiles.length > 0 && session?.access_token && newTableId) {
        // 创建文件名映射：后端返回的 filename -> 前端的 file.name
        const filenameMap = new Map<string, string>();
        etlFiles.forEach(f => {
          filenameMap.set(f.name, f.name);
          if (f.webkitRelativePath) {
            filenameMap.set(f.webkitRelativePath, f.name);
          }
        });

        // 使用 setTimeout 确保菜单已关闭
        setTimeout(async () => {
          try {
            const response = await uploadAndSubmit(
              {
                projectId: Number(projectId),
                files: etlFiles,
                nodeId: String(newTableId),  // 使用 nodeId (UUID 字符串)
                jsonPath: '', // 挂载到根路径
              },
              session.access_token
            );

            // 用真正的任务 ID 替换临时占位任务
            // 使用文件名映射确保和 JSON key 匹配
            const realTasks = response.items
              .filter(item => item.status !== 'failed')
              .map(item => ({
                taskId: String(item.task_id),
                projectId: projectId,
                tableId: String(newTableId),
                tableName: finalTableName,
                // 使用映射找到正确的前端文件名，fallback 到后端返回的
                filename: filenameMap.get(item.filename) || item.filename,
                status: 'pending' as const,
              }));

            // 移除临时任务，添加真正的任务
            if (realTasks.length > 0) {
              replacePlaceholderTasks(String(newTableId), realTasks);
            }

            // 报告失败的文件
            const failedFiles = response.items.filter(
              item => item.status === 'failed'
            );
            if (failedFiles.length > 0) {
              console.warn('Some files failed to upload:', failedFiles);
              onLog?.(
                'warning',
                `${failedFiles.length} file(s) failed to upload`
              );
              // 移除失败文件的占位任务
              const failedFileNames = failedFiles.map(
                f => filenameMap.get(f.filename) || f.filename
              );
              removeFailedPlaceholders(String(newTableId), failedFileNames);
            }
          } catch (etlError) {
            console.error('ETL upload failed:', etlError);
            onLog?.(
              'warning',
              `ETL upload failed: ${etlError instanceof Error ? etlError.message : 'Unknown error'}`
            );
            // 上传完全失败，移除所有占位任务
            removeAllPlaceholdersForTable(String(newTableId));
          }
        }, 100);
      }

      return; // 提前返回
    } catch (error) {
      onLog?.(
        'error',
        `Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      setIsImporting(false);
    }
  };

  /**
   * 解析文件列表，构建文件夹结构
   *
   * 新架构：
   * - ETL 文件使用 null 作为占位符（而非 { status: 'pending' }）
   * - ETL 文件会收集起来，统一通过 upload_and_submit 提交
   * - 文本文件直接读取内容
   */
  const parseFolderStructure = async (
    files: FileList,
    onProgress?: (current: number, total: number) => void
  ): Promise<{ structure: Record<string, any>; etlFiles: File[] }> => {
    const structure: Record<string, any> = {};
    const etlFiles: File[] = [];
    const fileArray = Array.from(files);
    const totalFiles = fileArray.length;
    let processedFiles = 0;

    for (const file of fileArray) {
      // 获取路径部分，跳过根文件夹名
      const pathParts = file.webkitRelativePath
        ? file.webkitRelativePath.split('/').filter(Boolean).slice(1) // 跳过根文件夹
        : [file.name]; // 单文件直接用文件名

      if (pathParts.length === 0) {
        processedFiles++;
        onProgress?.(processedFiles, totalFiles);
        continue;
      }

      // 导航到正确的嵌套位置
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
        // 检查是否需要 ETL 处理
        if (needsETL(file)) {
          // 用 null 作为占位符，保持文件结构
          // 配合 pending task 列表，在 JSON 编辑器中显示 loading 状态
          current[fileName] = null;
          etlFiles.push(file);
          onLog?.('info', `Found ${fileName} for processing...`);
        } else {
          // 文本文件直接存内容
          const isTextFile = await isTextFileType(file);
          if (isTextFile) {
            let content = await file.text();
            current[fileName] = sanitizeUnicodeContent(content);
          } else {
            // 无法读取的二进制文件存 null
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
  };

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
                <input
                  ref={fileInputRef}
                  type='file'
                  {...({ webkitdirectory: '', directory: '' } as any)}
                  onChange={e =>
                    e.target.files && handleFilesSelected(e.target.files)
                  }
                  multiple
                  style={{ display: 'none' }}
                />

                {/* Dropzone */}
                <div
                  ref={dropzoneRef}
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
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
                    Drop files or folder here
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
          projectId={Number(projectId)}
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
    </div>
  );
}
