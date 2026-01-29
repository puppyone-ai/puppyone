'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ProjectInfo } from '../lib/projectsApi';
import { createTable, updateTable, deleteTable } from '../lib/projectsApi';
import { refreshProjects } from '../lib/hooks/useData';
import { useAuth } from '../app/supabase/SupabaseAuthProvider';
import { ImportModal } from './editors/tree/components/ImportModal';
import { uploadAndSubmit } from '../lib/etlApi';
import {
  bulkCreateNodes,
  createFolder,
  type BulkCreateNodeItem,
} from '../lib/contentNodesApi';
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
import { openOAuthPopup, type SaasType } from '../lib/oauthApi';
import CrawlOptionsPanel from './CrawlOptionsPanel';
import { startSyncImport, cancelSyncTask } from '../lib/syncApi';
import { SyncProgressPanel } from './SyncProgressPanel';

type StartOption = 'empty' | 'documents' | 'url' | 'connect';
type DialogMode = 'create' | 'edit' | 'delete';

type TableManageDialogProps = {
  mode: DialogMode;
  projectId: string | null;
  tableId: string | null;
  parentId?: string | null;
  projects: ProjectInfo[];
  onClose: () => void;
  onModeChange?: (mode: DialogMode) => void;
  defaultStartOption?: StartOption;
};

// ... helper functions omitted for brevity, they are unchanged ...
function needsETL(file: File): boolean {
  const etlExtensions = [
    '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.jpg', '.jpeg', '.png', '.tiff', '.bmp',
  ];
  return etlExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
}

async function isTextFileType(file: File): Promise<boolean> {
  if (needsETL(file)) return false;
  const textExts = [
    '.txt', '.md', '.json', '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c', '.h', '.html', '.css', '.xml', '.yaml', '.yml', '.csv', '.sql', '.sh',
  ];
  const binaryExts = [
    '.zip', '.rar', '.tar', '.gz', '.gif', '.svg', '.webp', '.mp3', '.mp4', '.exe', '.dll', '.xls', '.xlsx',
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

function sanitizeUnicode(s: string): string {
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFFFE\uFFFF]/g, '').trim();
}

export function TableManageDialog({
  mode,
  projectId,
  tableId,
  parentId = null,
  projects,
  onClose,
  onModeChange,
  defaultStartOption = 'empty',
}: TableManageDialogProps) {
  const { session } = useAuth();
  const project = projectId ? projects.find(p => p.id === projectId) : null;
  const table = tableId && project ? project.nodes.find(t => t.id === tableId) : null;

  const [name, setName] = useState(table?.name || '');
  const [loading, setLoading] = useState(false);
  const [startOption, setStartOption] = useState<StartOption>(defaultStartOption);
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
  // connectParseResult 已移除 - 新流程是一键导入，不需要预解析
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectNeedsAuth, setConnectNeedsAuth] = useState(false);
  const [connectImporting, setConnectImporting] = useState(false);
  const [selectedSaas, setSelectedSaas] = useState<string | null>(null);
  const [syncTaskId, setSyncTaskId] = useState<number | null>(null);
  
  const connectStatusMeta = (() => {
    if (connectImporting) return { label: 'Importing...', color: '#22c55e' };
    if (connectLoading) return { label: 'Connecting...', color: '#3b82f6' };
    if (connectError && !connectNeedsAuth) return { label: connectError, color: '#ef4444' };
    if (connectUrlInput.trim()) return { label: 'Ready to import', color: '#22c55e' };
    if (selectedSaas) return { label: 'Enter URL to continue', color: '#595959' };
    return null;
  })();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropzoneRef = useRef<HTMLDivElement>(null);

  const resetConnectState = useCallback(() => {
    setConnectUrlInput('');
    setConnectError(null);
    setConnectNeedsAuth(false);
    setConnectLoading(false);
    setConnectImporting(false);
    setSelectedSaas(null);
  }, []);

  const isNotionUrl = (value: string) => value.includes('notion.so') || value.includes('notion.site');

  // SaaS 配置
  const SAAS_OPTIONS = [
    { 
      id: 'notion', 
      name: 'Notion', 
      color: '#ffffff',
      placeholder: 'https://notion.so/your-page or https://notion.site/...',
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.98-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.886l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952l1.448.327s0 .84-1.168.84l-3.22.186c-.094-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.14c-.093-.514.28-.886.747-.933zM2.197 1.548l13.542-.934c1.682-.14 2.103.093 2.803.607l3.875 2.706c.466.326.607.746.607 1.26v14.697c0 .84-.326 1.542-1.494 1.588l-15.503.887c-.888.047-1.308-.14-1.776-.7L.935 18.93c-.514-.653-.747-1.213-.747-1.866V2.995c0-.654.28-1.354 1.027-1.447z"/>
        </svg>
      )
    },
    { 
      id: 'github', 
      name: 'GitHub', 
      color: '#ffffff',
      placeholder: 'https://github.com/owner/repo or https://github.com/owner/repo/issues',
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
        </svg>
      )
    },
    { 
      id: 'airtable', 
      name: 'Airtable', 
      color: '#18BFFF',
      placeholder: 'https://airtable.com/appXXX/tblXXX/... or shared view link',
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <path d="M11.992 1.966L2.477 5.347a.35.35 0 00-.227.328v8.434c0 .139.083.265.21.32l9.514 4.093a.35.35 0 00.278 0l9.514-4.093a.35.35 0 00.21-.32V5.675a.35.35 0 00-.227-.328l-9.515-3.381a.35.35 0 00-.242 0zM12 6.523l7.396 2.63L12 11.782 4.604 9.153z"/>
        </svg>
      )
    },
    { 
      id: 'linear', 
      name: 'Linear', 
      color: '#5E6AD2',
      placeholder: 'https://linear.app/team/issue/XXX-123 or project URL',
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <path d="M3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12Z" fillOpacity="0.2"/>
          <path d="M3.51472 14.8285L9.17158 20.4854C4.89697 19.6056 1.72955 15.8946 1.72955 11.4142C1.72955 10.4988 1.85855 9.61372 2.09969 8.77539L6.32373 13.0005L3.51472 14.8285Z"/>
          <path d="M20.4853 14.8285L14.8284 20.4854C19.103 19.6056 22.2704 15.8946 22.2704 11.4142C22.2704 10.4988 22.1414 9.61372 21.9003 8.77539L17.6762 13.0005L20.4853 14.8285Z"/>
          <path d="M12 4.72949L17.6568 10.3863C17.6568 6.30015 14.5279 3.00098 10.5858 3.00098C9.67037 3.00098 8.78532 3.12998 7.94699 3.37112L12 4.72949Z"/>
        </svg>
      )
    },
    { 
      id: 'sheets', 
      name: 'Google Sheets', 
      color: '#34A853',
      placeholder: 'https://docs.google.com/spreadsheets/d/...',
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 2v3H5V5h14zm-9 5h4v9h-4v-9zm-5 0h4v9H5v-9zm14 9h-4v-9h4v9z"/>
        </svg>
      )
    },
  ];

  useEffect(() => {
    if (table) setName(table.name);
  }, [table]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); 
    if (e.currentTarget === dropzoneRef.current) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      setSelectedFiles(files);
      if (!name.trim()) {
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
  }, [name]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFiles(e.target.files);
      if (!name.trim()) {
        const firstFile = e.target.files[0];
        if (firstFile.webkitRelativePath) {
          const folderName = firstFile.webkitRelativePath.split('/')[0];
          setName(folderName);
        } else {
          const fn = firstFile.name;
          setName(fn.substring(0, fn.lastIndexOf('.')) || fn);
        }
      }
    }
  };

  /**
   * 一键导入 SaaS 数据（使用新的 Sync Task API）
   * 1. 尝试创建 sync task
   * 2. 如果需要授权，自动弹出 OAuth popup
   * 3. 授权完成后自动重试
   * 4. task 创建后，显示进度面板
   */
  const handleSaasImport = useCallback(async () => {
    if (!connectUrlInput.trim() || !projectId || !selectedSaas) return;
    
    setConnectLoading(true);
    setConnectError(null);
    setConnectNeedsAuth(false);
    
    const attemptStartSync = async (): Promise<boolean> => {
      try {
        // 启动 sync task
        const task = await startSyncImport({
          url: connectUrlInput.trim(),
          project_id: projectId,
        });
        
        // 成功！显示进度面板
        setConnectLoading(false);
        setSyncTaskId(task.id);
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to import';
        const lower = message.toLowerCase();
        
        // 检查是否需要授权
        if (lower.includes('auth') || lower.includes('401') || lower.includes('not connected')) {
          return false; // 需要授权
        }
        
        // 其他错误
        setConnectError(message);
        setConnectLoading(false);
        return true; // 不需要重试
      }
    };
    
    // 第一次尝试
    const success = await attemptStartSync();
    
    if (!success) {
      // 需要授权 - 自动弹出 OAuth popup
      setConnectLoading(false);
      
      try {
        // 弹出 OAuth 授权窗口
        const authorized = await openOAuthPopup(selectedSaas as SaasType);
        
        if (authorized) {
          // 授权完成，自动重试
          setConnectLoading(true);
          setConnectError(null);
          
          // 等待一下让后端处理完
          await new Promise(resolve => setTimeout(resolve, 500));
          
          await attemptStartSync();
        }
      } catch (authErr) {
        setConnectError('Authorization failed. Please try again.');
      }
    }
  }, [connectUrlInput, projectId, selectedSaas]);

  // 处理 sync task 完成
  const handleSyncComplete = useCallback(async (rootNodeId: string) => {
    await refreshProjects();
    resetConnectState();
    setSyncTaskId(null);
    onClose();
  }, [onClose, resetConnectState]);

  // 处理 sync task 错误
  const handleSyncError = useCallback((error: string) => {
    setConnectError(error);
    setSyncTaskId(null);
  }, []);

  // 处理取消 sync task
  const handleCancelSync = useCallback(async () => {
    if (syncTaskId) {
      try {
        await cancelSyncTask(syncTaskId);
      } catch (e) {
        // Ignore cancel errors
      }
      setSyncTaskId(null);
    }
  }, [syncTaskId]);

  /**
   * 解析文件列表，构建节点列表（方案 B：真正的节点层级）
   * 
   * 返回：
   * - nodes: 要创建的节点列表（folder, markdown, json, pending）
   * - etlFiles: 需要 ETL 处理的文件列表，每个带有 temp_id 用于关联
   */
  const parseFolderStructure = async (
    files: FileList,
    onProgress?: (c: number, t: number) => void
  ): Promise<{ nodes: BulkCreateNodeItem[]; etlFiles: { file: File; tempId: string }[] }> => {
    const nodes: BulkCreateNodeItem[] = [];
    const etlFiles: { file: File; tempId: string }[] = [];
    const fileArray = Array.from(files);
    let processed = 0;
    let tempIdCounter = 0;
    
    // 路径 -> temp_id 的映射，用于建立父子关系
    const pathToTempId = new Map<string, string>();
    
    // 收集所有需要创建的文件夹路径
    const folderPaths = new Set<string>();
    for (const file of fileArray) {
      const pathParts = file.webkitRelativePath
        ? file.webkitRelativePath.split('/').filter(Boolean).slice(1) // 跳过根文件夹名
        : [];
      // 收集所有父文件夹路径
      for (let i = 1; i < pathParts.length; i++) {
        folderPaths.add(pathParts.slice(0, i).join('/'));
      }
    }
    
    // 先创建所有文件夹节点（按路径深度排序，确保父文件夹先创建）
    const sortedFolderPaths = Array.from(folderPaths).sort((a, b) => 
      a.split('/').length - b.split('/').length
    );
    
    for (const folderPath of sortedFolderPaths) {
      const parts = folderPath.split('/');
      const folderName = parts[parts.length - 1];
      const parentPath = parts.slice(0, -1).join('/');
      const tempId = `t_${tempIdCounter++}`;
      
      pathToTempId.set(folderPath, tempId);
      
      nodes.push({
        temp_id: tempId,
        name: folderName,
        type: 'folder',
        parent_temp_id: parentPath ? pathToTempId.get(parentPath) || null : null,
      });
    }
    
    // 然后创建所有文件节点
    for (const file of fileArray) {
      const pathParts = file.webkitRelativePath
        ? file.webkitRelativePath.split('/').filter(Boolean).slice(1)
        : [file.name];
      
      if (pathParts.length === 0) {
        processed++;
        onProgress?.(processed, fileArray.length);
        continue;
      }
      
      const fileName = pathParts[pathParts.length - 1];
      const parentPath = pathParts.slice(0, -1).join('/');
      const parentTempId = parentPath ? pathToTempId.get(parentPath) || null : null;
      const tempId = `t_${tempIdCounter++}`;
      
      try {
        if (needsETL(file)) {
          // 需要 ETL 处理的文件，创建 pending 节点
          nodes.push({
            temp_id: tempId,
            name: fileName,
            type: 'pending',
            parent_temp_id: parentTempId,
          });
          etlFiles.push({ file, tempId });
          setImportMessage(`Found ${fileName} for processing...`);
        } else {
          const isText = await isTextFileType(file);
          if (isText) {
            const content = sanitizeUnicode(await file.text());
            const ext = fileName.toLowerCase();
            
            // 根据扩展名决定节点类型
            if (ext.endsWith('.json')) {
              try {
                const jsonContent = JSON.parse(content);
                nodes.push({
                  temp_id: tempId,
                  name: fileName,
                  type: 'json',
                  parent_temp_id: parentTempId,
                  content: jsonContent,
                });
              } catch {
                // JSON 解析失败，作为 markdown 处理
                nodes.push({
                  temp_id: tempId,
                  name: fileName,
                  type: 'markdown',
                  parent_temp_id: parentTempId,
                  content: content,
                });
              }
            } else {
              // 其他文本文件作为 markdown
              nodes.push({
                temp_id: tempId,
                name: fileName,
                type: 'markdown',
                parent_temp_id: parentTempId,
                content: content,
              });
            }
          } else {
            // 非文本文件，创建 pending 节点
            nodes.push({
              temp_id: tempId,
              name: fileName,
              type: 'pending',
              parent_temp_id: parentTempId,
            });
          }
        }
      } catch (err) {
        // 出错时创建 pending 节点
        nodes.push({
          temp_id: tempId,
          name: fileName,
          type: 'pending',
          parent_temp_id: parentTempId,
        });
      }
      
      processed++;
      onProgress?.(processed, fileArray.length);
    }
    
    return { nodes, etlFiles };
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      setLoading(true);
      if (mode === 'edit' && tableId) {
        await updateTable(projectId || '', tableId, name.trim());
        await refreshProjects();
        onClose();
      } else if (startOption === 'documents' && selectedFiles && selectedFiles.length > 0) {
        setImportMessage('Preparing files...');
        const finalName = name.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
        
        // 方案 B：使用批量创建 API，创建真正的节点层级
        const { nodes, etlFiles } = await parseFolderStructure(selectedFiles);
        
        setImportMessage('Creating folder structure...');
        
        // 先创建根文件夹
        const rootFolder = await createFolder(finalName, projectId || '', parentId);
        const rootFolderId = rootFolder.id;
        
        // 然后批量创建子节点（如果有的话）
        let tempIdToRealId = new Map<string, string>();
        if (nodes.length > 0) {
          const bulkResult = await bulkCreateNodes(projectId || '', nodes, rootFolderId);
          // 建立 temp_id -> real_id 的映射
          for (const item of bulkResult.created) {
            tempIdToRealId.set(item.temp_id, item.node_id);
          }
        }
        
        // 处理 ETL 文件
        if (etlFiles.length > 0 && projectId) {
          const placeholderTasks = etlFiles.map(({ file }, index) => ({
            taskId: -(Date.now() + index),
            projectId: projectId,
            tableId: rootFolderId,
            tableName: finalName,
            filename: file.name,
            status: 'pending' as const,
          }));
          addPendingTasks(placeholderTasks);
        }
        
        await refreshProjects();
        onClose();
        
        // 上传 ETL 文件（每个文件单独上传，指定目标节点 ID）
        if (etlFiles.length > 0 && projectId && session?.access_token) {
          setTimeout(async () => {
            try {
              // 每个 ETL 文件单独上传，指定目标节点 ID
              for (const { file, tempId } of etlFiles) {
                const targetNodeId = tempIdToRealId.get(tempId);
                if (!targetNodeId) {
                  console.warn(`No target node for ETL file: ${file.name}`);
                  continue;
                }
                
                try {
                  const response = await uploadAndSubmit(
                    { 
                      projectId: Number(projectId), 
                      files: [file], 
                      nodeId: targetNodeId, // 直接更新这个 pending 节点
                    }, 
                    session.access_token
                  );
                  
                  const item = response.items[0];
                  if (item && item.status !== 'failed') {
                    replacePlaceholderTasks(rootFolderId, [{
                      taskId: item.task_id,
                      projectId: projectId,
                      tableId: rootFolderId,
                      tableName: finalName,
                      filename: file.name,
                      status: 'pending' as const,
                    }]);
                  } else if (item?.status === 'failed') {
                    removeFailedPlaceholders(rootFolderId, [file.name]);
                  }
                } catch (err) {
                  console.error(`Failed to upload ETL file ${file.name}:`, err);
                  removeFailedPlaceholders(rootFolderId, [file.name]);
                }
              }
            } catch (etlError) {
              console.error('ETL upload failed:', etlError);
              removeAllPlaceholdersForTable(rootFolderId);
            }
          }, 100);
        }
        return;
      } else {
        await createTable(projectId, name.trim(), [], parentId);
        await refreshProjects();
        onClose();
      }
    } catch (error) {
      console.error('Failed to save table:', error);
      alert('Operation failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
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
      alert('Delete failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  // Title logic
  const getDialogTitle = () => {
    if (mode === 'delete') return 'Delete Context';
    if (mode === 'edit') return 'Edit Context';
    switch (startOption) {
      case 'empty': return 'Create JSON Context';
      case 'documents': return 'Import from Files';
      case 'url': return 'Import from Web';
      case 'connect': return 'Connect Data Source';
      default: return 'Create Context';
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0, 0, 0, 0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
        backdropFilter: 'blur(2px)'
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#1C1C1E',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 12,
          width: 520, // Slightly simpler width
          maxWidth: '90vw',
          boxShadow: '0 24px 48px rgba(0,0,0,0.4), 0 12px 24px rgba(0,0,0,0.4)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          animation: 'dialog-fade-in 0.2s ease-out',
        }}
        onClick={e => e.stopPropagation()}
      >
        <style jsx>{`
          @keyframes dialog-fade-in {
            from { opacity: 0; transform: scale(0.98); }
            to { opacity: 1; transform: scale(1); }
          }
          input::placeholder { color: #525252; }
        `}</style>

        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 500, color: '#E4E4E7' }}>
            {getDialogTitle()}
          </h2>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: '#71717A',
            cursor: 'pointer', padding: 4, display: 'flex', borderRadius: 4,
            transition: 'color 0.15s, background 0.15s'
          }}
          onMouseEnter={e => {
            e.currentTarget.style.color = '#E4E4E7';
            e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color = '#71717A';
            e.currentTarget.style.background = 'transparent';
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {mode === 'delete' ? (
          <div style={{ padding: 24 }}>
            <p style={{ color: '#A1A1AA', fontSize: 16, lineHeight: 1.6, margin: '0 0 24px' }}>
              Are you sure you want to delete <strong style={{ color: '#E4E4E7' }}>{table?.name}</strong>? This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={buttonStyle(false)}>Cancel</button>
              <button onClick={handleDelete} disabled={loading} style={buttonStyle(true, true)}>
                {loading ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
              
              {/* CONTENT BASED ON START OPTION */}
              
              {startOption === 'empty' && (
                <div>
                  <label style={labelStyle}>Name</label>
                  <input
                    type='text'
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder='e.g. User Configuration'
                    style={inputStyle}
                    autoFocus
                  />
                </div>
              )}

              {startOption === 'documents' && (
                <>
                  <input
                    ref={fileInputRef}
                    type='file'
                    {...({ webkitdirectory: '', directory: '' } as any)}
                    multiple
                    onChange={handleFileSelect}
                    style={{ display: 'none' }}
                  />
                  
                  {isImporting ? (
                    <div style={{ padding: '24px', textAlign: 'center', background: '#27272A', borderRadius: 8, border: '1px solid #3F3F46' }}>
                      <div style={{ fontSize: 16, color: '#A1A1AA', marginBottom: 12 }}>{importMessage} {Math.round(importProgress)}%</div>
                      <div style={{ height: 4, background: '#3F3F46', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ width: `${importProgress}%`, height: '100%', background: '#10B981', transition: 'width 0.2s' }} />
                      </div>
                    </div>
                  ) : selectedFiles && selectedFiles.length > 0 ? (
                    <div style={{ border: '1px solid #3F3F46', borderRadius: 8, background: '#27272A', overflow: 'hidden' }}>
                      <div style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #3F3F46', background: 'rgba(255,255,255,0.02)' }}>
                         <span style={{ fontSize: 12, color: '#A1A1AA' }}>{selectedFiles.length} files selected</span>
                         <button type="button" onClick={() => { setSelectedFiles(null); setName(''); }} style={{ background: 'none', border: 'none', color: '#A1A1AA', fontSize: 12, cursor: 'pointer', padding: '2px 6px' }}>Clear</button>
                      </div>
                      <div style={{ maxHeight: 180, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {Array.from(selectedFiles).slice(0, 5).map((file, i) => (
                           <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.03)' }}>
                              <span style={{ fontSize: 16, color: '#E4E4E7', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
                              <span style={{ fontSize: 11, color: '#71717A', marginLeft: 'auto', whiteSpace: 'nowrap' }}>{(file.size/1024).toFixed(0)}KB</span>
                           </div>
                        ))}
                        {selectedFiles.length > 5 && <div style={{ fontSize: 11, color: '#71717A', textAlign: 'center', padding: 4 }}>+{selectedFiles.length - 5} more</div>}
                      </div>
                    </div>
                  ) : (
                    <div
                      ref={dropzoneRef}
                      onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        padding: '32px 24px',
                        border: '1px dashed',
                        borderColor: isDragging ? '#3B82F6' : '#3F3F46',
                        borderRadius: 8,
                        background: isDragging ? 'rgba(59,130,246,0.1)' : '#27272A',
                        cursor: 'pointer',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                        transition: 'all 0.15s'
                      }}
                    >
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={isDragging ? '#3B82F6' : '#71717A'} strokeWidth="1.5">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="17 8 12 3 7 8"></polyline>
                        <line x1="12" y1="3" x2="12" y2="15"></line>
                      </svg>
                      <div style={{ fontSize: 16, color: '#E4E4E7' }}>Drop files here or click to upload</div>
                      <div style={{ fontSize: 12, color: '#71717A' }}>Supports PDF, MD, CSV, JSON</div>
                    </div>
                  )}

                  {selectedFiles && selectedFiles.length > 0 && (
                     <div>
                        <label style={labelStyle}>Name</label>
                        <input type='text' value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
                     </div>
                  )}
                </>
              )}

              {startOption === 'url' && (
                <>
                  <div>
                    <label style={labelStyle}>URL</label>
                    <input
                      type='text'
                      placeholder='https://...'
                      value={urlInput}
                      onChange={e => setUrlInput(e.target.value)}
                      style={inputStyle}
                      autoFocus
                    />
                  </div>
                  <CrawlOptionsPanel url={urlInput} options={crawlOptions} onChange={setCrawlOptions} />
                  {urlInput.trim() && (
                    <div>
                      <label style={labelStyle}>Name</label>
                      <input type='text' value={name} onChange={e => setName(e.target.value)} placeholder='e.g. Website Content' style={inputStyle} />
                    </div>
                  )}
                </>
              )}

              {startOption === 'connect' && (
                <>
                  {/* SaaS Logo 选择器 */}
                  {!selectedSaas && (
                    <div>
                      <label style={labelStyle}>Select Data Source</label>
                      <div style={{ 
                        display: 'grid', 
                        gridTemplateColumns: 'repeat(3, 1fr)', 
                        gap: 12,
                        marginTop: 8,
                      }}>
                        {SAAS_OPTIONS.map(saas => (
                          <button
                            key={saas.id}
                            type="button"
                            onClick={() => setSelectedSaas(saas.id)}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              gap: 8,
                              padding: '16px 12px',
                              background: '#27272A',
                              border: '1px solid #3F3F46',
                              borderRadius: 8,
                              cursor: 'pointer',
                              transition: 'all 0.15s',
                            }}
                            onMouseEnter={e => {
                              e.currentTarget.style.background = '#3F3F46';
                              e.currentTarget.style.borderColor = '#52525B';
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.background = '#27272A';
                              e.currentTarget.style.borderColor = '#3F3F46';
                            }}
                          >
                            <div style={{ color: saas.color }}>
                              {saas.icon}
                            </div>
                            <span style={{ fontSize: 12, color: '#E4E4E7', fontWeight: 500 }}>
                              {saas.name}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 选中 SaaS 后显示 URL 输入 (hide when syncing) */}
                  {selectedSaas && !syncTaskId && (
                    <>
                      <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: 12,
                        padding: '12px 16px',
                        background: '#27272A',
                        borderRadius: 8,
                        border: '1px solid #3F3F46',
                      }}>
                        <div style={{ color: SAAS_OPTIONS.find(s => s.id === selectedSaas)?.color || '#fff' }}>
                          {SAAS_OPTIONS.find(s => s.id === selectedSaas)?.icon}
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 14, fontWeight: 500, color: '#E4E4E7' }}>
                            {SAAS_OPTIONS.find(s => s.id === selectedSaas)?.name}
                          </div>
                          <div style={{ fontSize: 11, color: '#71717A', marginTop: 2 }}>
                            Paste a URL to import data
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedSaas(null);
                            setConnectUrlInput('');
                            setConnectError(null);
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#71717A',
                            cursor: 'pointer',
                            padding: 4,
                            display: 'flex',
                            alignItems: 'center',
                          }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6L6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </div>

                      <div>
                        <label style={labelStyle}>
                          {SAAS_OPTIONS.find(s => s.id === selectedSaas)?.name} URL
                        </label>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <input
                            type='text'
                            placeholder={SAAS_OPTIONS.find(s => s.id === selectedSaas)?.placeholder || 'Enter URL...'}
                            value={connectUrlInput}
                            onChange={e => setConnectUrlInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleSaasImport(); } }}
                            style={{ ...inputStyle, flex: 1 }}
                            autoFocus
                          />
                          <button
                            type='button'
                            onClick={() => void handleSaasImport()}
                            disabled={connectLoading || connectImporting || !connectUrlInput.trim()}
                            style={{
                              ...buttonStyle(true),
                              opacity: connectLoading || connectImporting || !connectUrlInput.trim() ? 0.5 : 1
                            }}
                          >
                            {connectLoading ? 'Connecting...' : connectImporting ? 'Importing...' : 'Import'}
                          </button>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Sync Progress Panel */}
                  {syncTaskId && (
                    <SyncProgressPanel
                      taskId={syncTaskId}
                      onComplete={handleSyncComplete}
                      onError={handleSyncError}
                      onCancel={handleCancelSync}
                    />
                  )}

                  {/* 状态提示 (only show when not syncing) */}
                  {selectedSaas && connectStatusMeta && !syncTaskId && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: connectStatusMeta.color }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: connectStatusMeta.color }}></span>
                      {connectStatusMeta.label}
                    </div>
                  )}

                </>
              )}
            </div>

            {/* Footer */}
            <div style={{
              padding: '16px 20px',
              borderTop: '1px solid rgba(255,255,255,0.06)',
              display: 'flex', justifyContent: 'flex-end', gap: 10,
              background: '#1C1C1E',
            }}>
              <button type='button' onClick={onClose} style={buttonStyle(false)}>Cancel</button>
              {/* SaaS 导入使用内联的 Import 按钮，不需要底部按钮 */}
              {startOption !== 'connect' && (
                <button
                  type={startOption === 'url' ? 'button' : 'submit'}
                  onClick={
                    startOption === 'url' ? (urlInput.trim() ? () => setShowImportModal(true) : undefined) :
                    undefined
                  }
                  disabled={
                    loading || isImporting ||
                    (startOption === 'empty' && !name.trim()) ||
                    (startOption === 'documents' && (!selectedFiles || selectedFiles.length === 0 || !name.trim())) ||
                    (startOption === 'url' && !urlInput.trim())
                  }
                  style={buttonStyle(true)}
                >
                  {mode === 'edit' ? 'Save Changes' : 'Create'}
                </button>
              )}
            </div>
          </form>
        )}
      </div>
      
      {showImportModal && projectId && (
        <ImportModal
          visible={showImportModal}
          projectId={Number(projectId)}
          mode='create_table'
          tableName={name || 'Imported Content'}
          initialUrl={urlInput}
          initialCrawlOptions={crawlOptions}
          onClose={() => { setShowImportModal(false); setUrlInput(''); }}
          onSuccess={() => { setShowImportModal(false); setUrlInput(''); refreshProjects(); onClose(); }}
        />
      )}
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: '#A1A1AA',
  marginBottom: 8,
  display: 'block'
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 32,
  padding: '0 12px',
  background: '#27272A',
  border: '1px solid #3F3F46',
  borderRadius: 6,
  color: '#E4E4E7',
  fontSize: 16,
  outline: 'none',
  transition: 'border-color 0.15s',
  boxSizing: 'border-box'
};

const buttonStyle = (primary: boolean, danger = false): React.CSSProperties => ({
  height: '32px',
  padding: '0 12px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 6,
  border: '1px solid transparent',
  background: danger ? 'rgba(239,68,68,0.15)' : primary ? '#E4E4E7' : 'transparent',
  color: danger ? '#ef4444' : primary ? '#18181B' : '#A1A1AA',
  fontSize: 16,
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'all 0.15s',
});
