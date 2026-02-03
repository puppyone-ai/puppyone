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
  updateTaskStatusById,
  removeTaskById,
  type TaskType,
} from './BackgroundTaskNotifier';
import { type CrawlOptions } from '../lib/importApi';
import { openOAuthPopup, type SaasType } from '../lib/oauthApi';
import CrawlOptionsPanel from './CrawlOptionsPanel';
import SyncProgressPanel from './SyncProgressPanel';
import {
  submitImport,
  getImportTask,
  cancelImportTask,
  isTerminalStatus,
  type ImportTaskResponse,
} from '../lib/importApi';

type StartOption = 'empty' | 'documents' | 'url' | 'connect';
type DialogMode = 'create' | 'edit' | 'delete';
type SaasId = 'notion' | 'github' | 'airtable' | 'linear' | 'google_sheets' | 'gmail' | 'calendar' | 'drive' | 'docs' | 'sheets';

type TableManageDialogProps = {
  mode: DialogMode;
  projectId: string | null;
  tableId: string | null;
  parentId?: string | null;
  projects: ProjectInfo[];
  onClose: () => void;
  onModeChange?: (mode: DialogMode) => void;
  defaultStartOption?: StartOption;
  defaultSelectedSaas?: SaasId;
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
  defaultSelectedSaas,
}: TableManageDialogProps) {
  const { session } = useAuth();
  const project = projectId ? projects.find(p => p.id === projectId) : null;
  const table = tableId && project ? project.nodes.find(t => t.id === tableId) : null;

  const [name, setName] = useState(table?.name || '');
  const [loading, setLoading] = useState(false);
  const [startOption, setStartOption] = useState<StartOption>(defaultSelectedSaas ? 'connect' : defaultStartOption);
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
  const [selectedSaas, setSelectedSaas] = useState<string | null>(defaultSelectedSaas || null);
  const [syncTaskId, setSyncTaskId] = useState<string | null>(null);
  const [oauthConnected, setOauthConnected] = useState<{ connected: boolean; email?: string } | null>(null);
  const [oauthChecking, setOauthChecking] = useState(false);
  
  const connectStatusMeta = (() => {
    if (connectImporting) return { label: 'Importing...', color: '#22c55e' };
    if (connectLoading) return { label: 'Connecting...', color: '#3b82f6' };
    if (connectError && !connectNeedsAuth) return { label: connectError, color: '#ef4444' };
    if (connectUrlInput.trim()) return { label: 'Ready to import', color: '#22c55e' };
    // 对于需要 URL 输入的 sources，提示输入 URL
    // URL-type: github, notion, airtable, linear
    // OAuth-type 但需要 URL: sheets, docs
    const urlRequiredSources = ['github', 'notion', 'airtable', 'linear', 'sheets', 'docs'];
    if (selectedSaas && urlRequiredSources.includes(selectedSaas)) {
      return { label: 'Enter URL to continue', color: '#595959' };
    }
    // 对于纯 OAuth sources (gmail, calendar)，不显示 URL 提示
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
    setOauthConnected(null);
  }, []);

  // Check OAuth connection status when selecting an OAuth-type SaaS
  useEffect(() => {
    const checkOAuthStatus = async () => {
      if (!selectedSaas) {
        setOauthConnected(null);
        return;
      }
      
      const saasConfig = SAAS_OPTIONS.find(s => s.id === selectedSaas);
      if (!saasConfig || saasConfig.type !== 'oauth') {
        setOauthConnected(null);
        return;
      }

      setOauthChecking(true);
      try {
        const { getGmailStatus, getGoogleDriveStatus, getGoogleCalendarStatus, getGoogleSheetsStatus, getGoogleDocsStatus } = await import('@/lib/oauthApi');
        let status: { connected: boolean; email?: string } = { connected: false };
        
        if (selectedSaas === 'gmail') {
          status = await getGmailStatus();
        } else if (selectedSaas === 'drive') {
          status = await getGoogleDriveStatus();
        } else if (selectedSaas === 'calendar') {
          status = await getGoogleCalendarStatus();
        } else if (selectedSaas === 'sheets') {
          const sheetsStatus = await getGoogleSheetsStatus();
          status = { connected: sheetsStatus.connected, email: sheetsStatus.workspace_name };
        } else if (selectedSaas === 'docs') {
          status = await getGoogleDocsStatus();
        }
        
        setOauthConnected(status);
      } catch (err) {
        console.error('Failed to check OAuth status:', err);
        setOauthConnected({ connected: false });
      } finally {
        setOauthChecking(false);
      }
    };

    checkOAuthStatus();
  }, [selectedSaas]);

  const isNotionUrl = (value: string) => value.includes('notion.so') || value.includes('notion.site');

  // SaaS 配置
  // type: 'url' = 粘贴 URL 导入, 'oauth' = 需要 OAuth 授权后配置
  const SAAS_OPTIONS: Array<{
    id: string;
    name: string;
    type: 'url' | 'oauth';
    placeholder?: string;
    description?: string;
    icon: React.ReactNode;
    configFields?: Array<{
      key: string;
      label: string;
      type: 'select' | 'text' | 'checkbox' | 'date-range';
      options?: Array<{ value: string; label: string }>;
      defaultValue?: unknown;
    }>;
  }> = [
    // Notion temporarily hidden - still in development
    // { 
    //   id: 'notion', 
    //   name: 'Notion', 
    //   type: 'url',
    //   placeholder: 'https://notion.so/your-page or https://notion.site/...',
    //   icon: <img src="/icons/notion.svg" alt="Notion" width={24} height={24} style={{ display: 'block' }} />
    // },
    { 
      id: 'github', 
      name: 'GitHub', 
      type: 'url',
      placeholder: 'https://github.com/owner/repo or https://github.com/owner/repo/issues',
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
        </svg>
      )
    },
    { 
      id: 'gmail', 
      name: 'Gmail', 
      type: 'oauth',
      description: 'Import emails from your Gmail account',
      icon: <img src="/icons/gmail.svg" alt="Gmail" width={24} height={24} style={{ display: 'block' }} />,
      configFields: [
        {
          key: 'label',
          label: 'Label',
          type: 'select',
          options: [
            { value: 'INBOX', label: 'Inbox' },
            { value: 'SENT', label: 'Sent' },
            { value: 'IMPORTANT', label: 'Important' },
            { value: 'STARRED', label: 'Starred' },
            { value: 'ALL', label: 'All Mail' },
          ],
          defaultValue: 'INBOX'
        },
        {
          key: 'timeRange',
          label: 'Time Range',
          type: 'select',
          options: [
            { value: '7d', label: 'Last 7 days' },
            { value: '30d', label: 'Last 30 days' },
            { value: '90d', label: 'Last 90 days' },
            { value: 'all', label: 'All time' },
          ],
          defaultValue: '30d'
        },
        {
          key: 'maxEmails',
          label: 'Max Emails',
          type: 'select',
          options: [
            { value: '50', label: '50 emails' },
            { value: '100', label: '100 emails' },
            { value: '500', label: '500 emails' },
            { value: '1000', label: '1000 emails' },
          ],
          defaultValue: '100'
        },
      ]
    },
    // Google Drive temporarily disabled
    // { 
    //   id: 'drive', 
    //   name: 'Google Drive', 
    //   type: 'oauth',
    //   description: 'Import files from your Google Drive',
    //   icon: <img src="/icons/google_drive.svg" alt="Google Drive" width={24} height={24} style={{ display: 'block' }} />,
    //   configFields: [...]
    // },
    { 
      id: 'calendar', 
      name: 'Google Calendar', 
      type: 'oauth',
      description: 'Import events from your Google Calendar',
      icon: <img src="/icons/google_calendar.svg" alt="Google Calendar" width={24} height={24} style={{ display: 'block' }} />,
      configFields: [
        {
          key: 'calendarId',
          label: 'Calendar',
          type: 'select',
          options: [
            { value: 'primary', label: 'Primary Calendar' },
          ],
          defaultValue: 'primary'
        },
        {
          key: 'timeRange',
          label: 'Time Range',
          type: 'select',
          options: [
            { value: 'future_7d', label: 'Next 7 days' },
            { value: 'future_30d', label: 'Next 30 days' },
            { value: 'past_30d', label: 'Past 30 days' },
            { value: 'past_90d', label: 'Past 90 days' },
          ],
          defaultValue: 'future_30d'
        },
      ]
    },
    { 
      id: 'sheets', 
      name: 'Google Sheets', 
      type: 'oauth',
      description: 'Paste a URL to import data',
      placeholder: 'https://docs.google.com/spreadsheets/d/...',
      icon: <img src="/icons/google_sheet.svg" alt="Google Sheets" width={24} height={24} style={{ display: 'block' }} />,
      configFields: [
        {
          key: 'url',
          label: 'Google Sheets URL',
          type: 'text',
          defaultValue: ''
        },
      ]
    },
    { 
      id: 'docs', 
      name: 'Google Docs', 
      type: 'oauth',
      description: 'Paste a URL to import document',
      placeholder: 'https://docs.google.com/document/d/...',
      icon: <img src="/icons/google_doc.svg" alt="Google Docs" width={24} height={24} style={{ display: 'block' }} />,
      configFields: [
        {
          key: 'url',
          label: 'Google Docs URL',
          type: 'text',
          defaultValue: ''
        },
      ]
    },
    // Airtable and Linear temporarily disabled - not yet integrated
    // { 
    //   id: 'airtable', 
    //   name: 'Airtable', 
    //   type: 'url',
    //   placeholder: 'https://airtable.com/appXXX/tblXXX/... or shared view link',
    //   icon: <img src="/icons/airtable.png" alt="Airtable" width={24} height={24} style={{ display: 'block', borderRadius: 4 }} />
    // },
    // { 
    //   id: 'linear', 
    //   name: 'Linear', 
    //   type: 'url',
    //   placeholder: 'https://linear.app/team/issue/XXX-123 or project URL',
    //   icon: <img src="/icons/linear.svg" alt="Linear" width={24} height={24} style={{ display: 'block' }} />
    // },
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
   * 一键导入 SaaS 数据 - 统一使用新的异步 /api/v1/import/submit API
   * 所有 SaaS 导入（GitHub, Notion, Airtable 等）都走相同的异步路径
   */
  const handleSaasImport = useCallback(async () => {
    if (!connectUrlInput.trim() || !projectId || !selectedSaas) return;
    
    setConnectLoading(true);
    setConnectError(null);
    setConnectNeedsAuth(false);
    
    const url = connectUrlInput.trim();
    const taskName = name.trim() || url.split('/').pop() || 'Imported Data';
    const taskType = selectedSaas as 'notion' | 'github' | 'airtable' | 'google_sheets' | 'linear';
    
    const attemptImport = async (): Promise<boolean> => {
      try {
        // 1. 提交导入任务到新的统一 API
        const response = await submitImport({
          project_id: projectId,
          url: url,
          name: taskName,
        });
        
        // 2. 添加任务到 pending tasks 列表（使用后端返回的真实 task_id）
        addPendingTasks([{
          taskId: response.task_id,
          projectId: projectId,
          filename: taskName,
          taskType: taskType,
          status: 'pending',
        }]);
        
        // 3. 立即关闭对话框
        resetConnectState();
        onClose();
        
        // 4. 开始轮询任务状态
        pollTaskStatus(response.task_id, taskName, taskType);
        
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to import';
        const lower = message.toLowerCase();
        if (lower.includes('auth') || lower.includes('401') || lower.includes('not connected')) {
          setConnectNeedsAuth(true);
          setConnectError('Authorization required. Please connect your account first.');
          setConnectLoading(false);
          return false;
        }
        setConnectError(message);
        setConnectLoading(false);
        return true;
      }
    };
    
    const success = await attemptImport();
    if (!success) {
      try {
        const authorized = await openOAuthPopup(selectedSaas as SaasType);
        if (authorized) {
          setConnectLoading(true);
          setConnectError(null);
          setConnectNeedsAuth(false);
          await new Promise(resolve => setTimeout(resolve, 500));
          await attemptImport();
        }
      } catch (authErr) {
        setConnectError('Authorization failed. Please try again.');
        setConnectLoading(false);
      }
    }
  }, [connectUrlInput, projectId, selectedSaas, name, onClose, resetConnectState]);

  /**
   * 轮询任务状态，更新 UI
   */
  const pollTaskStatus = useCallback(async (
    taskId: string,
    taskName: string,
    taskType: TaskType
  ) => {
    const poll = async () => {
      try {
        const task = await getImportTask(taskId);
        
        // 更新任务状态
        updateTaskStatusById(taskId, task.status as any);
        
        if (isTerminalStatus(task.status)) {
          if (task.status === 'completed') {
            // 刷新项目列表
            await refreshProjects();
            // 触发完成事件
            window.dispatchEvent(new CustomEvent('saas-task-completed', {
              detail: { taskId, filename: taskName, taskType, contentNodeId: task.content_node_id },
            }));
          } else if (task.status === 'failed') {
            // 触发失败事件
            window.dispatchEvent(new CustomEvent('saas-task-failed', {
              detail: { taskId, filename: taskName, error: task.error },
            }));
          }
        } else {
          // 继续轮询
          setTimeout(poll, 1500);
        }
      } catch (error) {
        console.error('Failed to poll task status:', error);
        // 出错时标记为失败
        updateTaskStatusById(taskId, 'failed');
      }
    };
    
    poll();
  }, []);

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
        await cancelImportTask(syncTaskId);
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
          const baseTimestamp = Date.now();
          const placeholderTasks = etlFiles.map(({ file }, index) => ({
            taskId: `placeholder-${baseTimestamp}-${index}-${Math.random().toString(36).slice(2, 8)}`,
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
                      taskId: String(item.task_id),
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
                  {/* SaaS Logo 选择器 - 紧凑正方形布局 */}
                  {!selectedSaas && (
                  <div>
                      <label style={labelStyle}>Select Data Source</label>
                      <div style={{ 
                        display: 'grid', 
                        gridTemplateColumns: 'repeat(5, 1fr)', 
                        gap: 8,
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
                              justifyContent: 'center',
                              gap: 6,
                              aspectRatio: '1',
                              padding: 8,
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
                            <div>
                              {saas.icon}
                            </div>
                            <span style={{ fontSize: 10, color: '#A1A1AA', fontWeight: 500 }}>
                              {saas.name}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 选中 SaaS 后显示对应的 UI (hide when syncing) */}
                  {selectedSaas && !syncTaskId && (() => {
                    const selectedSaasConfig = SAAS_OPTIONS.find(s => s.id === selectedSaas);
                    if (!selectedSaasConfig) return null;
                    
                    return (
                      <>
                        {/* SaaS Header */}
                        <div style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: 12,
                          padding: '12px 16px',
                          background: '#27272A',
                          borderRadius: 8,
                          border: '1px solid #3F3F46',
                        }}>
                          <div>
                            {selectedSaasConfig.icon}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 14, fontWeight: 500, color: '#E4E4E7' }}>
                              {selectedSaasConfig.name}
                            </div>
                            <div style={{ fontSize: 11, color: '#71717A', marginTop: 2 }}>
                              {selectedSaasConfig.type === 'url' 
                                ? 'Paste a URL to import data'
                                : selectedSaasConfig.description || 'Connect your account to import data'
                              }
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

                        {/* URL 类型: 显示 URL 输入框 */}
                        {selectedSaasConfig.type === 'url' && (
                          <div>
                            <label style={labelStyle}>
                              {selectedSaasConfig.name} URL
                            </label>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <input
                                type='text'
                                placeholder={selectedSaasConfig.placeholder || 'Enter URL...'}
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
                        )}

                        {/* OAuth 类型: 简化的连接 + 导入流程 */}
                        {selectedSaasConfig.type === 'oauth' && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {/* 未连接: 显示连接按钮 */}
                            {!oauthConnected?.connected && !oauthChecking && (
                              <div style={{ 
                                padding: 20,
                                background: '#1C1C1E',
                                borderRadius: 8,
                                border: '1px solid #3F3F46',
                                textAlign: 'center',
                              }}>
                                <div style={{ fontSize: 13, color: '#71717A', marginBottom: 16 }}>
                                  Connect your {selectedSaasConfig.name} account to import data
                                </div>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    try {
                                      setConnectLoading(true);
                                      const { openOAuthPopup, getGmailStatus, getGoogleDriveStatus, getGoogleCalendarStatus } = await import('@/lib/oauthApi');
                                      await openOAuthPopup(selectedSaas as 'gmail' | 'drive' | 'calendar');
                                      // Re-check status after OAuth
                                      let status: { connected: boolean; email?: string } = { connected: false };
                                      if (selectedSaas === 'gmail') status = await getGmailStatus();
                                      else if (selectedSaas === 'drive') status = await getGoogleDriveStatus();
                                      else if (selectedSaas === 'calendar') status = await getGoogleCalendarStatus();
                                      setOauthConnected(status);
                                    } catch (err) {
                                      setConnectError(err instanceof Error ? err.message : 'OAuth failed');
                                    } finally {
                                      setConnectLoading(false);
                                    }
                                  }}
                                  disabled={connectLoading}
                                  style={{
                                    padding: '10px 24px',
                                    background: '#3B82F6',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: 6,
                                    fontSize: 14,
                                    fontWeight: 500,
                                    cursor: connectLoading ? 'not-allowed' : 'pointer',
                                    opacity: connectLoading ? 0.7 : 1,
                                  }}
                                >
                                  {connectLoading ? 'Connecting...' : `Connect ${selectedSaasConfig.name}`}
                                </button>
                              </div>
                            )}

                            {/* 检查中 */}
                            {oauthChecking && (
                              <div style={{ 
                                padding: 20,
                                background: '#1C1C1E',
                                borderRadius: 8,
                                border: '1px solid #3F3F46',
                                textAlign: 'center',
                                color: '#71717A',
                              }}>
                                Checking connection...
                              </div>
                            )}

                            {/* 已连接: 显示账户信息 + 配置 + 导入按钮 */}
                            {oauthConnected?.connected && (
                              <>
                                {/* 账户信息条 */}
                                <div style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  padding: '10px 14px',
                                  background: 'rgba(34, 197, 94, 0.1)',
                                  borderRadius: 6,
                                  border: '1px solid rgba(34, 197, 94, 0.3)',
                                }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2">
                                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                                      <polyline points="22 4 12 14.01 9 11.01" />
                                    </svg>
                                    <span style={{ fontSize: 13, color: '#22c55e' }}>
                                      {oauthConnected.email || 'Connected'}
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      try {
                                        setConnectLoading(true);
                                        const { openOAuthPopup, getGmailStatus, getGoogleDriveStatus, getGoogleCalendarStatus } = await import('@/lib/oauthApi');
                                        await openOAuthPopup(selectedSaas as 'gmail' | 'drive' | 'calendar');
                                        let status: { connected: boolean; email?: string } = { connected: false };
                                        if (selectedSaas === 'gmail') status = await getGmailStatus();
                                        else if (selectedSaas === 'drive') status = await getGoogleDriveStatus();
                                        else if (selectedSaas === 'calendar') status = await getGoogleCalendarStatus();
                                        setOauthConnected(status);
                                      } catch (err) {
                                        setConnectError(err instanceof Error ? err.message : 'OAuth failed');
                                      } finally {
                                        setConnectLoading(false);
                                      }
                                    }}
                                    style={{
                                      background: 'transparent',
                                      border: 'none',
                                      color: '#71717A',
                                      fontSize: 12,
                                      cursor: 'pointer',
                                      textDecoration: 'underline',
                                    }}
                                  >
                                    Switch
                                  </button>
                                </div>

                                {/* 配置选项 (简化显示) */}
                                {selectedSaasConfig.configFields && (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    {selectedSaasConfig.configFields.map(field => (
                                      <div key={field.key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                        <label style={{ fontSize: 13, color: '#A1A1AA', minWidth: 80 }}>{field.label}</label>
                                        {field.type === 'select' && (
                                          <select
                                            id={`oauth-config-${field.key}`}
                                            style={{
                                              flex: 1,
                                              padding: '6px 10px',
                                              background: '#27272A',
                                              border: '1px solid #3F3F46',
                                              borderRadius: 6,
                                              color: '#E4E4E7',
                                              fontSize: 13,
                                            }}
                                            defaultValue={field.defaultValue as string}
                                          >
                                            {field.options?.map(opt => (
                                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                                            ))}
                                          </select>
                                        )}
                                        {field.type === 'text' && (
                                          <input
                                            id={`oauth-config-${field.key}`}
                                            type="text"
                                            placeholder={selectedSaasConfig.placeholder || field.label}
                                            defaultValue={field.defaultValue as string}
                                            style={{ ...inputStyle, flex: 1, padding: '6px 10px', fontSize: 13 }}
                                          />
                                        )}
                                        {field.type === 'checkbox' && (
                                          <input
                                            id={`oauth-config-${field.key}`}
                                            type="checkbox"
                                            defaultChecked={field.defaultValue as boolean}
                                            style={{ width: 16, height: 16 }}
                                          />
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* Import 按钮 - 和 Notion 一样的样式 */}
                                <button
                                  type="button"
                                  disabled={connectImporting}
                                  onClick={async () => {
                                    if (!projectId) return;
                                    
                                    // 收集配置值
                                    const syncConfig: Record<string, unknown> = {};
                                    selectedSaasConfig.configFields?.forEach(field => {
                                      const el = document.getElementById(`oauth-config-${field.key}`) as HTMLInputElement | HTMLSelectElement;
                                      if (el) {
                                        syncConfig[field.key] = field.type === 'checkbox' ? (el as HTMLInputElement).checked : el.value;
                                      }
                                    });
                                    
                                    // 对于 sheets 和 docs，验证 URL 是否已输入
                                    if ((selectedSaas === 'sheets' || selectedSaas === 'docs') && !syncConfig.url) {
                                      setConnectError('Please enter a URL');
                                      return;
                                    }
                                    
                                    setConnectImporting(true);
                                    const taskName = name.trim() || `${selectedSaasConfig.name} Import`;
                                    
                                    try {
                                      // 提交任务到统一的 import API
                                      const { submitImport } = await import('@/lib/importApi');
                                      
                                      // 对于 sheets 和 docs，使用用户输入的 URL；其他 OAuth 类型使用特殊前缀
                                      let importUrl = `oauth://${selectedSaas}`;
                                      if ((selectedSaas === 'sheets' || selectedSaas === 'docs') && syncConfig.url) {
                                        importUrl = syncConfig.url as string;
                                        delete syncConfig.url; // 从 sync_config 中移除，避免重复
                                      }
                                      
                                      const response = await submitImport({
                                        project_id: projectId,
                                        url: importUrl,
                                        name: taskName,
                                        sync_config: syncConfig,
                                      });
                                      
                                      // Map SAAS option ids to TaskType
                                      const taskTypeMap: Record<string, TaskType> = {
                                        'gmail': 'gmail',
                                        'drive': 'drive',
                                        'calendar': 'calendar',
                                        'sheets': 'google_sheets',
                                        'docs': 'google_docs',
                                      };
                                      const taskType = taskTypeMap[selectedSaas] || 'file';
                                      
                                      // 添加到 pending tasks
                                      addPendingTasks([{
                                        taskId: response.task_id,
                                        projectId: projectId,
                                        filename: taskName,
                                        taskType: taskType,
                                        status: 'pending',
                                      }]);
                                      
                                      // 关闭对话框
                                      resetConnectState();
                                      onClose();
                                      
                                      // 轮询任务状态
                                      pollTaskStatus(response.task_id, taskName, taskType);
                                    } catch (err) {
                                      const message = err instanceof Error ? err.message : 'Failed to start import';
                                      setConnectError(message);
                                      setConnectImporting(false);
                                    }
                                  }}
                                  style={{
                                    ...buttonStyle(true),
                                    width: '100%',
                                    marginTop: 4,
                                    opacity: connectImporting ? 0.7 : 1,
                                  }}
                                >
                                  {connectImporting ? 'Starting...' : 'Import'}
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </>
                    );
                  })()}

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
