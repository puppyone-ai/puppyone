'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ProjectInfo } from '../lib/projectsApi';
import { createTable, updateTable, deleteTable } from '../lib/projectsApi';
import { refreshProjects } from '../lib/hooks/useData';
import { useAuth } from '../app/supabase/SupabaseAuthProvider';
import { ImportModal } from './editors/tree/components/ImportModal';
import { uploadAndSubmit } from '../lib/etlApi';
import {
  addPendingTasks,
  replacePlaceholderTasks,
  removeFailedPlaceholders,
  removeAllPlaceholdersForTable,
} from './BackgroundTaskNotifier';
import {
  parseUrl,
  importData,
  type ParseUrlResponse,
  type CrawlOptions,
} from '../lib/connectApi';
import CrawlOptionsPanel from './CrawlOptionsPanel';

type StartOption = 'empty' | 'documents' | 'url' | 'connect';
type DialogMode = 'create' | 'edit' | 'delete';

type TableManageDialogProps = {
  mode: DialogMode;
  projectId: string | null;
  tableId: string | null;
  parentId?: string | null; // 父文件夹 ID，用于在文件夹内创建节点
  projects: ProjectInfo[];
  onClose: () => void;
  onModeChange?: (mode: DialogMode) => void;
};

// Helper functions

/** 判断文件是否需要 ETL 处理（PDF、图片、Office 文档等） */
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
  return etlExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
}

/** 判断文件是否为文本类型（可以直接读取内容） */
async function isTextFileType(file: File): Promise<boolean> {
  if (needsETL(file)) return false;
  const textExts = [
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
    '.xml',
    '.yaml',
    '.yml',
    '.csv',
    '.sql',
    '.sh',
  ];
  const binaryExts = [
    '.zip',
    '.rar',
    '.tar',
    '.gz',
    '.gif',
    '.svg',
    '.webp',
    '.mp3',
    '.mp4',
    '.exe',
    '.dll',
    '.xls',
    '.xlsx',
  ];
  const fileName = file.name.toLowerCase();
  if (binaryExts.some(ext => fileName.endsWith(ext))) return false;
  if (textExts.some(ext => fileName.endsWith(ext))) return true;
  const buffer = await file.slice(0, 1024).arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.includes(0)) return false;
  let printable = 0;
  for (let i = 0; i < Math.min(bytes.length, 512); i++) {
    const b = bytes[i];
    if ((b >= 32 && b <= 126) || b === 9 || b === 10 || b === 13) printable++;
  }
  return printable / Math.min(bytes.length, 512) > 0.7;
}

/** 清理 Unicode 字符串中的非法字符 */
function sanitizeUnicode(s: string): string {
  return s
    .replace(
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFE\uFFFF]/g,
      ''
    )
    .trim();
}

export function TableManageDialog({
  mode,
  projectId,
  tableId,
  parentId = null,
  projects,
  onClose,
  onModeChange,
}: TableManageDialogProps) {
  const { session } = useAuth();
  const project = projectId ? projects.find(p => p.id === projectId) : null;
  const table =
    tableId && project ? project.nodes.find(t => t.id === tableId) : null;

  const [name, setName] = useState(table?.name || '');
  const [loading, setLoading] = useState(false);
  const [startOption, setStartOption] = useState<StartOption>('empty');
  const [isDragging, setIsDragging] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
  const [importMessage, setImportMessage] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [crawlOptions, setCrawlOptions] = useState<CrawlOptions>({
    limit: 50,
    maxDepth: 3,
    crawlEntireDomain: true,
    sitemap: 'include',
  });
  const [connectUrlInput, setConnectUrlInput] = useState('');
  const [connectParseResult, setConnectParseResult] =
    useState<ParseUrlResponse | null>(null);
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectNeedsAuth, setConnectNeedsAuth] = useState(false);
  const [connectImporting, setConnectImporting] = useState(false);
  const connectStatusMeta = (() => {
    if (connectNeedsAuth) {
      return { label: 'Authorization required', color: '#ef4444' };
    }
    if (connectImporting) {
      return { label: 'Importing...', color: '#22c55e' };
    }
    if (connectParseResult) {
      return {
        label: `Ready to import • ${connectParseResult.total_items} items`,
        color: '#22c55e',
      };
    }
    if (connectLoading) {
      return { label: 'Parsing...', color: '#3b82f6' };
    }
    if (connectError) {
      return { label: 'Parsing failed', color: '#ef4444' };
    }
    if (connectUrlInput.trim()) {
      return { label: 'Click Parse to continue', color: '#eab308' };
    }
    return { label: 'Waiting for connector URL', color: '#595959' };
  })();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropzoneRef = useRef<HTMLDivElement>(null);

  const resetConnectState = useCallback(() => {
    setConnectUrlInput('');
    setConnectParseResult(null);
    setConnectError(null);
    setConnectNeedsAuth(false);
    setConnectLoading(false);
    setConnectImporting(false);
  }, []);

  const isNotionUrl = (value: string) =>
    value.includes('notion.so') || value.includes('notion.site');

  useEffect(() => {
    if (table) {
      setName(table.name);
    }
  }, [table]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === dropzoneRef.current) setIsDragging(false);
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
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        setSelectedFiles(files);
        if (!name.trim()) {
          // 优先使用文件夹名，否则使用第一个文件名
          const firstFile = files[0];
          if (firstFile.webkitRelativePath) {
            const folderName = firstFile.webkitRelativePath.split('/')[0];
            setName(folderName);
          } else {
            const fn = firstFile.name;
            setName(fn.substring(0, fn.lastIndexOf('.')) || fn);
          }
        }
      }
    },
    [name]
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFiles(e.target.files);
      if (!name.trim()) {
        // 优先使用文件夹名，否则使用第一个文件名
        const firstFile = e.target.files[0];
        if (firstFile.webkitRelativePath) {
          // 从路径中提取文件夹名（第一个部分）
          const folderName = firstFile.webkitRelativePath.split('/')[0];
          setName(folderName);
        } else {
          // 单文件：使用文件名（去掉扩展名）
          const fn = firstFile.name;
          setName(fn.substring(0, fn.lastIndexOf('.')) || fn);
        }
      }
    }
  };

  const handleConnectParse = useCallback(async () => {
    if (!connectUrlInput.trim()) {
      return;
    }

    setConnectLoading(true);
    setConnectError(null);
    setConnectNeedsAuth(false);
    setConnectParseResult(null);

    try {
      const result = await parseUrl(connectUrlInput.trim());
      setConnectParseResult(result);
      if (!name.trim()) {
        setName(result.title || 'Imported Data');
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to parse URL';
      setConnectError(message);
      const lower = message.toLowerCase();
      if (
        lower.includes('auth') ||
        lower.includes('401') ||
        isNotionUrl(connectUrlInput)
      ) {
        setConnectNeedsAuth(true);
      }
    } finally {
      setConnectLoading(false);
    }
  }, [connectUrlInput, name]);

  const handleConnectImport = useCallback(async () => {
    if (!connectParseResult || !projectId) {
      return;
    }

    try {
      setConnectImporting(true);
      setConnectError(null);

      await importData({
        url: connectParseResult.url,
        project_id: projectId,
        table_id: undefined,
        table_name: name.trim() || connectParseResult.title || 'Imported Data',
        table_description: `Imported from ${connectParseResult.source_type}`,
      });

      await refreshProjects();
      resetConnectState();
      onClose();
    } catch (err) {
      setConnectError(
        err instanceof Error ? err.message : 'Failed to import data'
      );
    } finally {
      setConnectImporting(false);
    }
  }, [connectParseResult, name, projectId, onClose, resetConnectState]);

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
    onProgress?: (c: number, t: number) => void
  ): Promise<{ structure: Record<string, any>; etlFiles: File[] }> => {
    const structure: Record<string, any> = {};
    const etlFiles: File[] = [];
    const fileArray = Array.from(files);
    let processed = 0;

    for (const file of fileArray) {
      // 获取路径部分，跳过根文件夹名
      const pathParts = file.webkitRelativePath
        ? file.webkitRelativePath.split('/').filter(Boolean).slice(1) // 跳过根文件夹
        : [file.name]; // 单文件直接用文件名

      if (pathParts.length === 0) {
        processed++;
        onProgress?.(processed, fileArray.length);
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
        if (needsETL(file)) {
          // 需要 ETL 处理的文件（PDF、图片等）
          // 用 null 作为占位符，保持文件结构
          // 配合 pending task 列表，在 JSON 编辑器中显示 loading 状态
          current[fileName] = null;
          etlFiles.push(file);
          setImportMessage(`Found ${fileName} for processing...`);
        } else {
          // 文本文件直接存内容
          const isText = await isTextFileType(file);
          if (isText) {
            current[fileName] = sanitizeUnicode(await file.text());
          } else {
            // 无法读取的二进制文件存 null
            current[fileName] = null;
          }
        }
      } catch (err) {
        current[fileName] = null;
      }
      processed++;
      onProgress?.(processed, fileArray.length);
    }
    return { structure, etlFiles };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    try {
      setLoading(true);
      if (mode === 'edit' && tableId) {
        // 编辑模式：只更新名称
        await updateTable(projectId || '', tableId, name.trim());
        await refreshProjects();
        onClose();
      } else if (
        startOption === 'documents' &&
        selectedFiles &&
        selectedFiles.length > 0
      ) {
        // 文档导入模式 - "提交即走"设计
        setImportMessage('Preparing files...');

        const finalName = name.trim().replace(/[^a-zA-Z0-9_-]/g, '_');

        // 1. 解析文件结构，收集需要 ETL 的文件（这步很快）
        const { structure, etlFiles } =
          await parseFolderStructure(selectedFiles);

        // 2. 创建 Table（包含文本文件内容和 ETL 文件的 null 占位符）
        setImportMessage('Creating context...');
        const newTable = await createTable(projectId, finalName, structure, parentId);
        const newTableId = newTable.id;

        // 3. 如果有 ETL 文件且有 projectId，先预先添加"准备上传"状态的任务
        //    这样侧边栏能立即显示转圈样式
        //    注意：裸 Table（projectId 为 null）暂不支持 ETL 上传
        if (etlFiles.length > 0 && projectId) {
          const placeholderTasks = etlFiles.map((file, index) => ({
            taskId: -(Date.now() + index), // 负数临时 ID，后面会被替换
            projectId: projectId,
            tableId: String(newTableId),
            tableName: finalName,
            filename: file.name,
            status: 'pending' as const,
          }));
          addPendingTasks(placeholderTasks);
        }

        // 4. 立即关闭弹窗，刷新项目列表
        await refreshProjects();
        onClose();

        // 5. 后台上传 ETL 文件（弹窗已关闭，用户可以继续其他操作）
        //    注意：裸 Table（projectId 为 null）暂不支持 ETL 上传
        if (
          etlFiles.length > 0 &&
          projectId &&
          session?.access_token &&
          newTableId
        ) {
          // 创建文件名映射：后端返回的 filename -> 前端的 file.name
          // 这样即使后端返回的文件名格式不同，也能正确匹配
          const filenameMap = new Map<string, string>();
          etlFiles.forEach(f => {
            // 后端可能返回完整路径或只是文件名，都映射到前端的 file.name
            filenameMap.set(f.name, f.name);
            if (f.webkitRelativePath) {
              filenameMap.set(f.webkitRelativePath, f.name);
            }
          });

          // 使用 setTimeout 确保弹窗已关闭
          setTimeout(async () => {
            try {
              const response = await uploadAndSubmit(
                {
                  projectId: Number(projectId),
                  files: etlFiles,
                  tableId: Number(newTableId),
                  jsonPath: '', // 挂载到根路径
                },
                session.access_token
              );

              // 用真正的任务 ID 替换临时占位任务
              // 使用文件名映射确保和 JSON key 匹配
              const realTasks = response.items
                .filter(item => item.status !== 'failed')
                .map(item => ({
                  taskId: item.task_id,
                  projectId: projectId,
                  tableId: String(newTableId),
                  tableName: finalName,
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
                // 移除失败文件的占位任务
                const failedFileNames = failedFiles.map(
                  f => filenameMap.get(f.filename) || f.filename
                );
                removeFailedPlaceholders(String(newTableId), failedFileNames);
              }
            } catch (etlError) {
              console.error('ETL upload failed:', etlError);
              // 上传完全失败，移除所有占位任务
              removeAllPlaceholdersForTable(String(newTableId));
            }
          }, 100);
        }

        return; // 提前返回，不执行 finally 中的重置
      } else {
        // 空表模式
        await createTable(projectId, name.trim(), [], parentId);
        await refreshProjects();
        onClose();
      }
    } catch (error) {
      console.error('Failed to save table:', error);
      alert(
        'Operation failed: ' +
          (error instanceof Error ? error.message : 'Unknown error')
      );
    } finally {
      setLoading(false);
      setIsImporting(false);
      setImportProgress(0);
      setImportMessage('');
    }
  };

  const handleDelete = async () => {
    if (!tableId) return;

    try {
      setLoading(true);
      await deleteTable(projectId || '', tableId);
      await refreshProjects();
      onClose();
    } catch (error) {
      console.error('Failed to delete table:', error);
      alert(
        'Delete failed: ' +
          (error instanceof Error ? error.message : 'Unknown error')
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#202020',
          border: '1px solid #333',
          borderRadius: 12,
          width: 640,
          maxWidth: '90vw',
          boxShadow: '0 24px 48px rgba(0,0,0,0.4), 0 12px 24px rgba(0,0,0,0.4)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'dialog-fade-in 0.2s ease-out',
        }}
        onClick={e => e.stopPropagation()}
      >
        <style jsx>{`
          @keyframes dialog-fade-in {
            from {
              opacity: 0;
              transform: scale(0.98);
            }
            to {
              opacity: 1;
              transform: scale(1);
            }
          }
          .option-card {
            padding: 12px;
            background: #252525;
            border: 1px solid #333;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 12px;
            height: 100%;
          }
          .option-card:hover {
            background: #2a2a2a;
            border-color: #404040;
            transform: translateY(-1px);
          }
          .option-card.active {
            border-color: #3b82f6;
            background: rgba(59, 130, 246, 0.1);
          }

          .start-option {
            padding: 14px 16px;
            background: transparent;
            border: 1px solid #333;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.15s;
            display: flex;
            align-items: flex-start;
            gap: 12px;
          }
          .start-option:hover {
            background: rgba(255, 255, 255, 0.03);
            border-color: #444;
          }
          .start-option.active {
            border-color: #525252;
            background: rgba(255, 255, 255, 0.05);
          }
        `}</style>

        {/* Header - Notion Style "Add to..." */}
        <div
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid #333',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#202020',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 13,
              color: '#888',
            }}
          >
            <span>Add new context</span>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#2A2A2A',
                borderRadius: 4,
                width: 20,
                height: 20,
                color: '#E1E1E1',
              }}
            >
              <svg width='12' height='12' viewBox='0 0 14 14' fill='none'>
                <rect
                  x='1.5'
                  y='1.5'
                  width='11'
                  height='11'
                  rx='1.5'
                  stroke='currentColor'
                  strokeWidth='1.2'
                />
                <line
                  x1='1.5'
                  y1='5'
                  x2='12.5'
                  y2='5'
                  stroke='currentColor'
                  strokeWidth='1.2'
                />
                <line
                  x1='5.5'
                  y1='5'
                  x2='5.5'
                  y2='12.5'
                  stroke='currentColor'
                  strokeWidth='1.2'
                />
              </svg>
            </div>
            {project ? (
              <>
                <span>to project</span>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    color: '#E1E1E1',
                    fontWeight: 500,
                    background: '#2A2A2A',
                    padding: '2px 8px',
                    borderRadius: 4,
                    marginLeft: 2,
                  }}
                >
                  <svg width='12' height='12' viewBox='0 0 14 14' fill='none'>
                    <path
                      d='M1 4C1 3.44772 1.44772 3 2 3H5.17157C5.43679 3 5.69114 3.10536 5.87868 3.29289L6.70711 4.12132C6.89464 4.30886 7.149 4.41421 7.41421 4.41421H12C12.5523 4.41421 13 4.86193 13 5.41421V11C13 11.5523 12.5523 12 12 12H2C1.44772 12 1 11.5523 1 11V4Z'
                      stroke='currentColor'
                      strokeWidth='1.2'
                    />
                  </svg>
                  {project.name}
                </div>
              </>
            ) : (
              <span style={{ color: '#666' }}>(unorganized)</span>
            )}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#666',
              cursor: 'pointer',
              padding: 4,
              display: 'flex',
            }}
          >
            <svg width='14' height='14' viewBox='0 0 14 14' fill='none'>
              <path
                d='M11 3L3 11M3 3L11 11'
                stroke='currentColor'
                strokeWidth='1.5'
                strokeLinecap='round'
              />
            </svg>
          </button>
        </div>

        {mode === 'delete' ? (
          <div style={{ padding: 32 }}>
            <h3 style={{ color: '#EDEDED', margin: '0 0 12px', fontSize: 18 }}>
              Delete Context?
            </h3>
            <p
              style={{
                color: '#9FA4B1',
                marginBottom: 24,
                fontSize: 14,
                lineHeight: 1.5,
              }}
            >
              Are you sure you want to delete context{' '}
              <strong style={{ color: '#EDEDED' }}>{table?.name}</strong>?
              <br />
              This action cannot be undone and all data will be lost.
            </p>
            <div
              style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}
            >
              <button onClick={onClose} style={buttonStyle(false)}>
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={loading}
                style={buttonStyle(true, true)}
              >
                {loading ? 'Deleting...' : 'Delete Context'}
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            style={{ display: 'flex', flexDirection: 'column' }}
          >
            <div style={{ padding: '24px 32px 32px' }}>
              {/* Data Source Selection */}
              <div style={{ marginBottom: 24 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 500,
                    color: '#666',
                    marginBottom: 12,
                    letterSpacing: '0.02em',
                  }}
                >
                  Create a new context from
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: 10,
                  }}
                >
                  {/* Option 1: Empty */}
                  <div
                    className={`start-option ${startOption === 'empty' ? 'active' : ''}`}
                    onClick={() => {
                      setStartOption('empty');
                      setSelectedFiles(null);
                      setName('');
                      setUrlInput('');
                      resetConnectState();
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
                      style={{ flexShrink: 0, color: '#777', marginTop: 2 }}
                    >
                      <rect x='3' y='3' width='18' height='18' rx='2' ry='2' />
                      <line x1='12' y1='8' x2='12' y2='16' />
                      <line x1='8' y1='12' x2='16' y2='12' />
                    </svg>
                    <div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: '#EDEDED',
                        }}
                      >
                        Blank
                      </div>
                      <div
                        style={{ fontSize: 11, color: '#666', marginTop: 3 }}
                      >
                        Start fresh
                      </div>
                    </div>
                  </div>

                  {/* Option 2: Documents */}
                  <div
                    className={`start-option ${startOption === 'documents' ? 'active' : ''}`}
                    onClick={() => {
                      setStartOption('documents');
                      setUrlInput('');
                      resetConnectState();
                      if (startOption === 'empty') setName('');
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
                      style={{ flexShrink: 0, color: '#777', marginTop: 2 }}
                    >
                      <path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' />
                      <polyline points='14 2 14 8 20 8' />
                    </svg>
                    <div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: '#EDEDED',
                        }}
                      >
                        Files
                      </div>
                      <div
                        style={{ fontSize: 11, color: '#666', marginTop: 3 }}
                      >
                        PDF, MD, CSV
                      </div>
                    </div>
                  </div>

                  {/* Option 3: URL/Web */}
                  <div
                    className={`start-option ${startOption === 'url' ? 'active' : ''}`}
                    onClick={() => {
                      setStartOption('url');
                      setSelectedFiles(null);
                      setName('');
                      resetConnectState();
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
                      style={{ flexShrink: 0, color: '#777', marginTop: 2 }}
                    >
                      <circle cx='12' cy='12' r='10' />
                      <line x1='2' y1='12' x2='22' y2='12' />
                      <path d='M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z' />
                    </svg>
                    <div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: '#EDEDED',
                        }}
                      >
                        Web
                      </div>
                      <div
                        style={{ fontSize: 11, color: '#666', marginTop: 3 }}
                      >
                        Import URL
                      </div>
                    </div>
                  </div>

                  {/* Option 4: Connectors */}
                  <div
                    className={`start-option ${startOption === 'connect' ? 'active' : ''}`}
                    onClick={() => {
                      setStartOption('connect');
                      setSelectedFiles(null);
                      setUrlInput('');
                      setName('');
                      resetConnectState();
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
                      style={{ flexShrink: 0, color: '#777', marginTop: 2 }}
                    >
                      <path d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' />
                      <path d='M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' />
                    </svg>
                    <div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          color: '#EDEDED',
                        }}
                      >
                        Connect
                      </div>
                      <div
                        style={{ fontSize: 11, color: '#666', marginTop: 3 }}
                      >
                        Notion, Linear
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Dynamic Content */}
              {startOption === 'empty' && (
                <div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 500,
                      color: '#666',
                      marginBottom: 8,
                    }}
                  >
                    Set the new context name to
                  </div>
                  <input
                    type='text'
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder='Enter context name'
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      background: '#1a1a1a',
                      border: '1px solid #333',
                      borderRadius: 6,
                      fontSize: 14,
                      color: '#EDEDED',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                    autoFocus
                  />
                </div>
              )}

              {startOption === 'documents' && (
                <div>
                  <input
                    ref={fileInputRef}
                    type='file'
                    {...({ webkitdirectory: '', directory: '' } as any)}
                    multiple
                    onChange={handleFileSelect}
                    style={{ display: 'none' }}
                  />

                  {isImporting ? (
                    <div
                      style={{
                        padding: '24px',
                        textAlign: 'center',
                        background: '#1a1a1a',
                        borderRadius: 8,
                        border: '1px solid #333',
                      }}
                    >
                      <div
                        style={{
                          fontSize: 13,
                          color: '#9ca3af',
                          marginBottom: 8,
                        }}
                      >
                        {importMessage} {Math.round(importProgress)}%
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
                  ) : selectedFiles && selectedFiles.length > 0 ? (
                    <div
                      style={{
                        padding: '16px',
                        border: '1px solid #333',
                        borderRadius: 8,
                        background: '#1a1a1a',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginBottom: 12,
                        }}
                      >
                        <div style={{ fontSize: 13, color: '#9ca3af' }}>
                          {selectedFiles.length} file
                          {selectedFiles.length > 1 ? 's' : ''} selected
                        </div>
                        <button
                          type='button'
                          onClick={() => {
                            setSelectedFiles(null);
                            setName('');
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#666',
                            cursor: 'pointer',
                            fontSize: 12,
                          }}
                        >
                          Clear
                        </button>
                      </div>
                      <div
                        style={{
                          maxHeight: 140,
                          overflowY: 'auto',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6,
                        }}
                      >
                        {Array.from(selectedFiles)
                          .slice(0, 5)
                          .map((file, i) => {
                            const ext =
                              file.name.split('.').pop()?.toLowerCase() || '';
                            let c = '#9ca3af',
                              bg = 'rgba(156,163,175,0.1)';
                            if (ext === 'pdf') {
                              c = '#ef4444';
                              bg = 'rgba(239,68,68,0.1)';
                            } else if (['doc', 'docx'].includes(ext)) {
                              c = '#3b82f6';
                              bg = 'rgba(59,130,246,0.1)';
                            } else if (['csv', 'xls', 'xlsx'].includes(ext)) {
                              c = '#22c55e';
                              bg = 'rgba(34,197,94,0.1)';
                            } else if (['jpg', 'jpeg', 'png'].includes(ext)) {
                              c = '#a855f7';
                              bg = 'rgba(168,85,247,0.1)';
                            }
                            return (
                              <div
                                key={i}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 10,
                                  padding: '8px 10px',
                                  background: '#252525',
                                  borderRadius: 6,
                                  border: '1px solid #333',
                                }}
                              >
                                <div
                                  style={{
                                    width: 28,
                                    height: 28,
                                    borderRadius: 5,
                                    background: bg,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: c,
                                    flexShrink: 0,
                                  }}
                                >
                                  <svg
                                    width='14'
                                    height='14'
                                    viewBox='0 0 24 24'
                                    fill='none'
                                    stroke='currentColor'
                                    strokeWidth='2'
                                  >
                                    <path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' />
                                    <polyline points='14 2 14 8 20 8' />
                                  </svg>
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div
                                    style={{
                                      fontSize: 13,
                                      color: '#e2e8f0',
                                      whiteSpace: 'nowrap',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      fontWeight: 500,
                                    }}
                                  >
                                    {file.name}
                                  </div>
                                  <div style={{ fontSize: 11, color: '#666' }}>
                                    {(file.size / 1024).toFixed(1)} KB
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        {selectedFiles.length > 5 && (
                          <div
                            style={{
                              fontSize: 11,
                              color: '#525252',
                              textAlign: 'center',
                              padding: 4,
                            }}
                          >
                            +{selectedFiles.length - 5} more
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div
                      ref={dropzoneRef}
                      onDragEnter={handleDragEnter}
                      onDragLeave={handleDragLeave}
                      onDragOver={handleDragOver}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        padding: '28px',
                        border: '1px dashed',
                        borderColor: isDragging ? '#3b82f6' : '#404040',
                        borderRadius: 8,
                        background: isDragging
                          ? 'rgba(59,130,246,0.05)'
                          : 'transparent',
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                        textAlign: 'center',
                      }}
                    >
                      <svg
                        width='20'
                        height='20'
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke={isDragging ? '#3b82f6' : '#525252'}
                        strokeWidth='1.5'
                        style={{ margin: '0 auto 10px' }}
                      >
                        <path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' />
                        <polyline points='17 8 12 3 7 8' />
                        <line x1='12' y1='3' x2='12' y2='15' />
                      </svg>
                      <div
                        style={{
                          fontSize: 13,
                          color: isDragging ? '#3b82f6' : '#9ca3af',
                          marginBottom: 4,
                        }}
                      >
                        Drop files or folder here
                      </div>
                      <div style={{ fontSize: 11, color: '#525252' }}>
                        PDF, DOC, MD, CSV, TXT, JSON, Images
                      </div>
                    </div>
                  )}

                  {/* Name input after files selected */}
                  {selectedFiles && selectedFiles.length > 0 && (
                    <div style={{ marginTop: 20 }}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 500,
                          color: '#666',
                          marginBottom: 8,
                        }}
                      >
                        Set the new context name to
                      </div>
                      <input
                        type='text'
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder='e.g. Q3 Financial Report'
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          background: '#1a1a1a',
                          border: '1px solid #333',
                          borderRadius: 6,
                          fontSize: 14,
                          color: '#EDEDED',
                          outline: 'none',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                  )}
                </div>
              )}

              {startOption === 'url' && (
                <div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 500,
                      color: '#666',
                      marginBottom: 8,
                    }}
                  >
                    Website URL
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '10px 12px',
                      background: '#1a1a1a',
                      border: '1px solid #333',
                      borderRadius: 6,
                    }}
                  >
                    <svg
                      width='16'
                      height='16'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='#666'
                      strokeWidth='1.5'
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      style={{ flexShrink: 0 }}
                    >
                      <circle cx='12' cy='12' r='10' />
                      <line x1='2' y1='12' x2='22' y2='12' />
                      <path d='M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z' />
                    </svg>
                    <input
                      type='text'
                      placeholder='https://example.com/page'
                      value={urlInput}
                      onChange={e => setUrlInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && urlInput.trim()) {
                          e.preventDefault();
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
                      autoFocus
                    />
                  </div>
                  <div style={{ fontSize: 11, color: '#525252', marginTop: 8 }}>
                    Paste a URL to import content from any webpage
                  </div>

                  {/* Crawl Options Panel - Always visible */}
                  <div style={{ marginTop: 20 }}>
                    <CrawlOptionsPanel
                      url={urlInput}
                      options={crawlOptions}
                      onChange={setCrawlOptions}
                    />
                  </div>

                  {/* Context Name for URL */}
                  {urlInput.trim() && (
                    <div style={{ marginTop: 20 }}>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 500,
                          color: '#666',
                          marginBottom: 8,
                        }}
                      >
                        Set the new context name to
                      </div>
                      <input
                        type='text'
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder='e.g. Company Blog'
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          background: '#1a1a1a',
                          border: '1px solid #333',
                          borderRadius: 6,
                          fontSize: 14,
                          color: '#EDEDED',
                          outline: 'none',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                  )}
                </div>
              )}

              {startOption === 'connect' && (
                <div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 500,
                      color: '#666',
                      marginBottom: 8,
                    }}
                  >
                    Connector URL
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      gap: 10,
                      alignItems: 'center',
                    }}
                  >
                    <input
                      type='text'
                      placeholder='https://www.notion.so/...'
                      value={connectUrlInput}
                      onChange={e => setConnectUrlInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void handleConnectParse();
                        }
                      }}
                      style={{
                        flex: 1,
                        background: '#1a1a1a',
                        border: '1px solid #333',
                        borderRadius: 6,
                        padding: '10px 12px',
                        fontSize: 14,
                        color: '#e2e8f0',
                        outline: 'none',
                        boxShadow: 'none',
                      }}
                      autoFocus
                    />
                    <button
                      type='button'
                      onClick={() => void handleConnectParse()}
                      disabled={connectLoading || !connectUrlInput.trim()}
                      style={{
                        padding: '10px 16px',
                        borderRadius: 6,
                        border: 'none',
                        background:
                          connectLoading || !connectUrlInput.trim()
                            ? '#2a2a2a'
                            : '#3a3a3a',
                        color:
                          connectLoading || !connectUrlInput.trim()
                            ? '#525252'
                            : '#EDEDED',
                        cursor:
                          connectLoading || !connectUrlInput.trim()
                            ? 'not-allowed'
                            : 'pointer',
                        fontSize: 13,
                        fontWeight: 500,
                      }}
                    >
                      {connectLoading ? 'Parsing...' : 'Parse'}
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: '#525252', marginTop: 8 }}>
                    Works with Notion pages, Google Docs, and other supported
                    sources.
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginTop: 12,
                      padding: '8px 12px',
                      border: '1px solid #2a2a2a',
                      borderRadius: 6,
                      background: '#111111',
                    }}
                  >
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: connectStatusMeta.color,
                        boxShadow:
                          connectStatusMeta.color === '#22c55e'
                            ? '0 0 8px rgba(34,197,94,0.6)'
                            : 'none',
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{ fontSize: 12, color: connectStatusMeta.color }}
                    >
                      {connectStatusMeta.label}
                    </span>
                  </div>

                  {connectError && (
                    <div
                      style={{
                        marginTop: 16,
                        padding: 12,
                        borderRadius: 8,
                        border: '1px solid #4a2a2a',
                        background: '#2a1a1a',
                      }}
                    >
                      <div
                        style={{
                          fontSize: 12,
                          color: '#f87171',
                          marginBottom: 4,
                        }}
                      >
                        Cannot parse link
                      </div>
                      <div style={{ fontSize: 13, color: '#b91c1c' }}>
                        {connectError}
                      </div>
                    </div>
                  )}

                  {connectNeedsAuth && (
                    <div
                      style={{
                        marginTop: 16,
                        padding: 14,
                        borderRadius: 8,
                        border: '1px solid #3b82f6',
                        background: 'rgba(59,130,246,0.08)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 12,
                          color: '#bfdbfe',
                          lineHeight: 1.5,
                        }}
                      >
                        This link needs additional authorization. Finish
                        connecting your workspace on the Integrations page, then
                        retry parsing.
                      </div>
                      <div
                        style={{ display: 'flex', justifyContent: 'flex-end' }}
                      >
                        <button
                          type='button'
                          onClick={() =>
                            window.open('/connect', '_blank', 'noopener')
                          }
                          style={{
                            border: '1px solid #93c5fd',
                            background: '#1d4ed8',
                            color: '#EDEDED',
                            borderRadius: 6,
                            padding: '6px 14px',
                            fontSize: 12,
                            fontWeight: 500,
                            cursor: 'pointer',
                          }}
                        >
                          Go to Integrations
                        </button>
                      </div>
                    </div>
                  )}

                  {connectParseResult && (
                    <div
                      style={{
                        marginTop: 20,
                        border: '1px solid #333',
                        borderRadius: 10,
                        padding: 16,
                        background: '#1a1a1a',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 12,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: '#8B8B8B',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                        }}
                      >
                        Preview — {connectParseResult.title || 'Untitled'}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: 12,
                          fontSize: 12,
                          color: '#9ca3af',
                        }}
                      >
                        <span>Source: {connectParseResult.source_type}</span>
                        <span>Items: {connectParseResult.total_items}</span>
                        <span>
                          Structure: {connectParseResult.data_structure}
                        </span>
                      </div>
                      {connectParseResult.sample_data &&
                        connectParseResult.sample_data.length > 0 && (
                          <div>
                            <div
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                color: '#8B8B8B',
                                marginBottom: 6,
                              }}
                            >
                              Sample ({connectParseResult.sample_data.length}{' '}
                              items)
                            </div>
                            <div
                              style={{
                                background: '#111111',
                                border: '1px solid #2a2a2a',
                                borderRadius: 6,
                                padding: 10,
                                maxHeight: 160,
                                overflow: 'auto',
                                fontSize: 11,
                              }}
                            >
                              <pre
                                style={{
                                  margin: 0,
                                  color: '#EDEDED',
                                  whiteSpace: 'pre-wrap',
                                }}
                              >
                                {JSON.stringify(
                                  connectParseResult.sample_data,
                                  null,
                                  2
                                )}
                              </pre>
                            </div>
                          </div>
                        )}
                      {connectParseResult.fields &&
                        connectParseResult.fields.length > 0 && (
                          <div>
                            <div
                              style={{
                                fontSize: 11,
                                fontWeight: 600,
                                color: '#8B8B8B',
                                marginBottom: 6,
                              }}
                            >
                              Detected fields
                            </div>
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns:
                                  'repeat(auto-fit, minmax(140px, 1fr))',
                                gap: 8,
                              }}
                            >
                              {connectParseResult.fields.map((field, idx) => (
                                <div
                                  key={idx}
                                  style={{
                                    border: '1px solid #2a2a2a',
                                    borderRadius: 6,
                                    padding: '6px 8px',
                                    background: '#0f0f0f',
                                  }}
                                >
                                  <div
                                    style={{
                                      fontSize: 12,
                                      fontWeight: 500,
                                      color: '#EDEDED',
                                    }}
                                  >
                                    {field.name}
                                  </div>
                                  <div
                                    style={{ fontSize: 11, color: '#8B8B8B' }}
                                  >
                                    {field.type}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                      <div style={{ marginTop: 4 }}>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 500,
                            color: '#666',
                            marginBottom: 8,
                          }}
                        >
                          Context Name
                        </div>
                        <input
                          type='text'
                          value={name}
                          onChange={e => setName(e.target.value)}
                          placeholder={
                            connectParseResult.title || 'Imported Data'
                          }
                          style={{
                            width: '100%',
                            padding: '10px 12px',
                            background: '#121212',
                            border: '1px solid #333',
                            borderRadius: 6,
                            fontSize: 14,
                            color: '#EDEDED',
                            outline: 'none',
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div
              style={{
                padding: '16px 20px',
                borderTop: '1px solid #333',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 12,
                background: '#202020',
              }}
            >
              <button
                type='button'
                onClick={onClose}
                style={buttonStyle(false)}
              >
                Cancel
              </button>
              <button
                type={
                  startOption === 'url' || startOption === 'connect'
                    ? 'button'
                    : 'submit'
                }
                onClick={
                  startOption === 'url'
                    ? urlInput.trim()
                      ? () => setShowImportModal(true)
                      : undefined
                    : startOption === 'connect'
                      ? connectParseResult
                        ? () => void handleConnectImport()
                        : undefined
                      : undefined
                }
                disabled={
                  loading ||
                  isImporting ||
                  connectImporting ||
                  (startOption === 'empty' && !name.trim()) ||
                  (startOption === 'documents' &&
                    (!selectedFiles ||
                      selectedFiles.length === 0 ||
                      !name.trim())) ||
                  (startOption === 'url' && !urlInput.trim()) ||
                  (startOption === 'connect' && !connectParseResult)
                }
                style={buttonStyle(true)}
              >
                {connectImporting
                  ? 'Importing...'
                  : loading || isImporting
                    ? isImporting
                      ? 'Importing...'
                      : 'Creating...'
                    : mode === 'edit'
                      ? 'Save Changes'
                      : startOption === 'documents'
                        ? 'Import & Create'
                        : startOption === 'url'
                          ? 'Import from URL'
                          : startOption === 'connect'
                            ? 'Import from Connector'
                            : 'Create Context'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Import Modal for URL import */}
      {showImportModal && projectId && (
        <ImportModal
          visible={showImportModal}
          projectId={Number(projectId)}
          mode='create_table'
          tableName={name || 'Imported Content'}
          initialUrl={urlInput}
          initialCrawlOptions={crawlOptions}
          onClose={() => {
            setShowImportModal(false);
            setUrlInput('');
          }}
          onSuccess={() => {
            setShowImportModal(false);
            setUrlInput('');
            refreshProjects();
            onClose();
          }}
        />
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  background: '#151515',
  border: '1px solid #333',
  borderRadius: 6,
  color: '#EDEDED',
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
  transition: 'border-color 0.15s',
};

const buttonStyle = (
  primary: boolean,
  danger = false
): React.CSSProperties => ({
  height: '28px',
  padding: '0 12px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 6,
  border: '1px solid transparent',
  background: danger
    ? 'rgba(239,68,68,0.15)'
    : primary
      ? '#EDEDED'
      : 'rgba(255,255,255,0.05)',
  color: danger ? '#ef4444' : primary ? '#1a1a1a' : '#EDEDED',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
  transition: 'all 0.15s',
});
