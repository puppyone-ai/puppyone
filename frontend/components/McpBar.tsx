'use client';

import {
  useState,
  useRef,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { useAuth } from '../app/supabase/SupabaseAuthProvider';
import { McpInstanceInfo } from './McpInstanceInfo';
import { treePathToJsonPointer } from '../lib/jsonPointer';
import { McpInstance } from '../lib/mcpApi';
import { createTable } from '../lib/projectsApi';

interface McpBarProps {
  projectId?: string;
  tableId?: string;
  currentTreePath?: string | null;
  onProjectsRefresh?: () => void;
  onLog?: (
    type: 'error' | 'warning' | 'info' | 'success',
    message: string
  ) => void;
  onCloseOtherMenus?: () => void;
}

// 辅助函数：检查文件是否为文本文件
async function isTextFileType(file: File): Promise<boolean> {
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
    '.pdf',
    '.doc',
    '.docx',
    '.xls',
    '.xlsx',
    '.ppt',
    '.pptx',
    '.zip',
    '.rar',
    '.tar',
    '.gz',
    '.jpg',
    '.jpeg',
    '.png',
    '.gif',
    '.bmp',
    '.tiff',
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
  ];

  const fileName = file.name.toLowerCase();

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

export const McpBar = forwardRef<{ closeMenus: () => void }, McpBarProps>(
  (
    {
      projectId,
      tableId,
      currentTreePath,
      onProjectsRefresh,
      onLog,
      onCloseOtherMenus,
    },
    ref
  ) => {
    const { userId, session } = useAuth();
    const [isOpen, setIsOpen] = useState(false);
    const [addedMethods, setAddedMethods] = useState<string[]>([]);
    const [isApplying, setIsApplying] = useState(false);
    const [result, setResult] = useState<{
      apiKey: string;
      url: string;
      port: number;
    } | null>(null);
    const [useJsonPointer, setUseJsonPointer] = useState(false);
    const [isImportMenuOpen, setIsImportMenuOpen] = useState(false);
    const [selectedProject, setSelectedProject] = useState<string>('');
    const [tableName, setTableName] = useState('');
    const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
    const [isImporting, setIsImporting] = useState(false);
    const [importProgress, setImportProgress] = useState(0);
    const [projects, setProjects] = useState<any[]>([]);

    const [menuHeight, setMenuHeight] = useState(0);
    const [importMenuHeight, setImportMenuHeight] = useState(0);
    const barRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const importMenuRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Close all menus when onClose prop is called from parent
    const closeMenus = () => {
      setIsOpen(false);
      setIsImportMenuOpen(false);
    };

    // Expose closeMenus function to parent via ref
    useImperativeHandle(ref, () => ({
      closeMenus,
    }));

    const methodOptions = [
      { value: 'get_all', label: 'Get All' },
      { value: 'vector_retrieve', label: 'Vector Retrieve' },
      { value: 'llm_retrieve', label: 'LLM Retrieve' },
      { value: 'create_element', label: 'Create Element' },
      { value: 'update_element', label: 'Update Element' },
      { value: 'delete_element', label: 'Delete Element' },
    ];

    // Debug: log userId and projectId
    useEffect(() => {
      console.log('McpBar mounted/updated:', { userId, projectId, session });
    }, [userId, projectId, session]);

    // Close bars when clicking outside
    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (barRef.current && !barRef.current.contains(event.target as Node)) {
          setIsOpen(false);
          setIsImportMenuOpen(false);
        }
      };

      if (isOpen || isImportMenuOpen) {
        document.addEventListener('mousedown', handleClickOutside);
        // Animate menus open
        if (isOpen) setTimeout(() => setMenuHeight(380), 0);
        if (isImportMenuOpen) setTimeout(() => setImportMenuHeight(500), 0);
      } else {
        // Reset menu heights for next animation
        setMenuHeight(0);
        setImportMenuHeight(0);
      }

      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }, [isOpen, isImportMenuOpen]);

    // Fetch projects when import menu opens
    useEffect(() => {
      if (isImportMenuOpen && projects.length === 0) {
        const fetchProjects = async () => {
          try {
            const response = await fetch(
              `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/v1/projects`,
              {
                headers: {
                  Authorization: `Bearer ${session?.access_token}`,
                },
              }
            );
            if (response.ok) {
              const data = await response.json();
              setProjects(data.data || []);
            }
          } catch (error) {
            console.error('Failed to fetch projects:', error);
          }
        };
        fetchProjects();
      }
    }, [isImportMenuOpen, projects.length, session?.access_token]);

    const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
      if (event.target.files) {
        setSelectedFiles(event.target.files);
      }
    };

    const parseFolderStructure = async (
      files: FileList,
      onProgress?: (current: number, total: number) => void
    ): Promise<Record<string, any>> => {
      const structure: Record<string, any> = {};
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

        // Add file
        const fileName = pathParts[pathParts.length - 1];
        try {
          // 检查是否为文本文件
          const isTextFile = await isTextFileType(file);
          if (isTextFile) {
            let content = await file.text();
            current[fileName] = sanitizeUnicodeContent(content);
          } else {
            current[fileName] = null;
          }
        } catch (error) {
          console.error(`Failed to read file ${fileName}:`, error);
          current[fileName] = null;
        }

        processedFiles++;
        if (onProgress) {
          onProgress(processedFiles, totalFiles);
        }
      }

      return structure;
    };

    const handleImport = async () => {
      if (!selectedFiles || selectedFiles.length === 0) {
        alert('Please select files to import');
        return;
      }

      if (!selectedProject) {
        alert('Please select a project');
        return;
      }

      // Generate table name
      const finalTableName = tableName.trim()
        ? tableName.replace(/[^a-zA-Z0-9_-]/g, '_')
        : `table_${Date.now()}`;

      setIsImporting(true);
      setImportProgress(0);

      try {
        // Build folder structure
        if (onLog) {
          onLog('info', 'Starting to parse folder structure...');
        }
        const folderStructure = await parseFolderStructure(
          selectedFiles,
          (current, total) => {
            setImportProgress((current / total) * 50); // Parse phase is 50% of progress
          }
        );

        // Create table using the API
        if (onLog) {
          onLog('info', 'Creating table...');
        }
        await createTable(selectedProject, finalTableName, folderStructure);
        setImportProgress(100);

        // Trigger refresh
        if (onProjectsRefresh) {
          onProjectsRefresh();
        } else {
          window.dispatchEvent(new CustomEvent('projects-refresh'));
        }

        // Reset form
        setSelectedProject('');
        setTableName('');
        setSelectedFiles(null);
        setIsImportMenuOpen(false);

        if (onLog) {
          onLog(
            'success',
            `Folder imported successfully! Context name: ${finalTableName}`
          );
        }
      } catch (error) {
        console.error('Import error:', error);
        if (onLog) {
          onLog(
            'error',
            `Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      } finally {
        setIsImporting(false);
        setImportProgress(0);
      }
    };

    const handleApply = async () => {
      console.log('handleApply called', { userId, projectId, session });
      // Check if userId and projectId are valid (cannot be empty string, null, or undefined)
      if (
        !userId ||
        (typeof userId === 'string' && userId.trim() === '') ||
        !projectId ||
        (typeof projectId === 'string' && projectId.trim() === '')
      ) {
        alert(
          `Missing user ID or project ID\nuserId: ${userId || 'undefined'}\nprojectId: ${projectId || 'undefined'}`
        );
        return;
      }

      setIsApplying(true);
      try {
        const toolsDefinition: any = {};
        if (
          addedMethods.includes('get_all') ||
          addedMethods.includes('vector_retrieve') ||
          addedMethods.includes('llm_retrieve')
        ) {
          toolsDefinition['get'] = {
            tool_name: 'get_context',
            tool_desc_template: 'Get context. Project: {project_name}',
            tool_desc_parameters: [{ project_name: projectId }],
          };
        }
        if (addedMethods.includes('create_element')) {
          toolsDefinition['create'] = {
            tool_name: 'create_element',
            tool_desc_template: 'Create element. Project: {project_name}',
            tool_desc_parameters: [{ project_name: projectId }],
          };
        }
        if (addedMethods.includes('update_element')) {
          toolsDefinition['update'] = {
            tool_name: 'update_element',
            tool_desc_template: 'Update element. Project: {project_name}',
            tool_desc_parameters: [{ project_name: projectId }],
          };
        }
        if (addedMethods.includes('delete_element')) {
          toolsDefinition['delete'] = {
            tool_name: 'delete_element',
            tool_desc_template: 'Delete element. Project: {project_name}',
            tool_desc_parameters: [{ project_name: projectId }],
          };
        }

        // Build request body
        // context_id should be tableId, not projectId
        const requestBody: any = {
          user_id: userId,
          project_id: projectId,
          context_id: tableId || projectId, // Use tableId if available, fallback to projectId
          tools_definition:
            Object.keys(toolsDefinition).length > 0
              ? toolsDefinition
              : undefined,
        };

        if (!tableId) {
          console.warn(
            'McpBar: tableId not provided, using projectId as context_id. This may cause issues.'
          );
        }

        // Add json_pointer if checkbox is checked and currentTreePath exists (not empty string)
        if (useJsonPointer && currentTreePath && currentTreePath !== '') {
          const jsonPointer = treePathToJsonPointer(currentTreePath);
          requestBody.json_pointer = jsonPointer;
        }

        const response = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'}/api/v1/mcp/`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
          }
        );

        const data = await response.json();
        console.log('Create MCP instance response:', data);
        if (data.code === 0) {
          const apiKey = data.data.api_key;
          const url = data.data.url;
          // Extract port number from URL
          const portMatch = url.match(/localhost:(\d+)/);
          const port = portMatch ? parseInt(portMatch[1]) : 0;
          setResult({ apiKey, url, port });
        } else {
          alert('Failed to create MCP instance: ' + data.message);
        }
      } catch (e) {
        console.error(e);
        alert('Error creating MCP instance');
      } finally {
        setIsApplying(false);
      }
    };

    return (
      <>
        <div
          ref={barRef}
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <button
            onClick={() => {
              setIsImportMenuOpen(!isImportMenuOpen);
              setIsOpen(false); // Close MCP menu when opening Import menu
              onCloseOtherMenus?.(); // Close editor menu when opening Import menu
            }}
            style={{
              height: 32,
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid #333',
              background: '#1a1a1a',
              color: '#CDCDCD',
              fontSize: 12,
              cursor: 'pointer',
              transition: 'background 0.15s, border-color 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = '#2a2a2a';
              e.currentTarget.style.borderColor = '#444';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = '#1a1a1a';
              e.currentTarget.style.borderColor = '#333';
            }}
          >
            Import Context
          </button>
          <button
            onClick={() => {
              setIsOpen(!isOpen);
              setIsImportMenuOpen(false); // Close Import menu when opening MCP menu
              onCloseOtherMenus?.(); // Close editor menu when opening MCP menu
            }}
            style={{
              height: 32,
              padding: '4px 10px',
              borderRadius: 6,
              border: '1px solid #333',
              background: '#1a1a1a',
              color: '#CDCDCD',
              fontSize: 12,
              cursor: 'pointer',
              transition: 'background 0.15s, border-color 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = '#2a2a2a';
              e.currentTarget.style.borderColor = '#444';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = '#1a1a1a';
              e.currentTarget.style.borderColor = '#333';
            }}
          >
            Configure MCP
          </button>
          {isImportMenuOpen && (
            <div
              ref={importMenuRef}
              style={{
                position: 'absolute',
                top: 36,
                left: 0,
                width: 180,
                background: '#1a1a1a',
                border: '1px solid #333',
                borderRadius: 8,
                padding: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                zIndex: 50,
                boxShadow:
                  '0 8px 25px rgba(0, 0, 0, 0.4), 0 4px 10px rgba(0, 0, 0, 0.2)',
                opacity: importMenuHeight > 0 ? 1 : 0,
                transform: `translateY(${importMenuHeight > 0 ? 0 : -10}px) scaleY(${importMenuHeight > 0 ? 1 : 0.8})`,
                transformOrigin: 'top',
                maxHeight: importMenuHeight,
                overflow: 'hidden',
                transition: 'all 0.2s cubic-bezier(0.2, 0, 0.2, 1)',
              }}
            >
              {/* Project Selection */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label
                  style={{ fontSize: 10, color: '#CDCDCD', fontWeight: 500 }}
                >
                  Project
                </label>
                <select
                  value={selectedProject}
                  onChange={e => setSelectedProject(e.target.value)}
                  disabled={isImporting}
                  style={{
                    height: 24,
                    padding: '0 8px',
                    borderRadius: 4,
                    border: '1px solid #333',
                    background: '#1a1a1a',
                    color: '#CDCDCD',
                    fontSize: 10,
                    cursor: isImporting ? 'not-allowed' : 'pointer',
                  }}
                >
                  <option value=''>Select Project</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Table Name */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label
                  style={{ fontSize: 10, color: '#CDCDCD', fontWeight: 500 }}
                >
                  Context Name
                </label>
                <input
                  type='text'
                  value={tableName}
                  onChange={e => setTableName(e.target.value)}
                  placeholder='Leave empty to auto-generate'
                  disabled={isImporting}
                  style={{
                    height: 24,
                    padding: '0 8px',
                    borderRadius: 4,
                    border: '1px solid #333',
                    background: '#1a1a1a',
                    color: '#CDCDCD',
                    fontSize: 10,
                  }}
                />
              </div>

              {/* Folder Selection */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label
                  style={{ fontSize: 10, color: '#CDCDCD', fontWeight: 500 }}
                >
                  Import Folder
                </label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    ref={fileInputRef}
                    type='file'
                    {...({ webkitdirectory: '', directory: '' } as any)}
                    onChange={handleFileSelect}
                    disabled={isImporting}
                    multiple
                    style={{ display: 'none' }}
                  />
                  <button
                    type='button'
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isImporting}
                    style={{
                      height: 24,
                      padding: '0 8px',
                      borderRadius: 4,
                      border: '1px solid #333',
                      background: '#1a1a1a',
                      color: '#CDCDCD',
                      fontSize: 10,
                      cursor: isImporting ? 'not-allowed' : 'pointer',
                      whiteSpace: 'nowrap',
                      transition: 'background 0.15s, border-color 0.15s',
                    }}
                    onMouseEnter={e => {
                      if (!isImporting) {
                        e.currentTarget.style.background = '#2a2a2a';
                        e.currentTarget.style.borderColor = '#444';
                      }
                    }}
                    onMouseLeave={e => {
                      if (!isImporting) {
                        e.currentTarget.style.background = '#1a1a1a';
                        e.currentTarget.style.borderColor = '#333';
                      }
                    }}
                  >
                    Select
                  </button>
                  {selectedFiles && selectedFiles.length > 0 && (
                    <div style={{ fontSize: 9, color: '#94a3b8' }}>
                      {selectedFiles[0].webkitRelativePath.split('/')[0]},{' '}
                      {selectedFiles.length} files
                    </div>
                  )}
                </div>
              </div>

              {/* Progress Bar */}
              {isImporting && (
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span style={{ fontSize: 10, color: '#CDCDCD' }}>
                      Processing...
                    </span>
                    <span style={{ fontSize: 10, color: '#94a3b8' }}>
                      {Math.round(importProgress)}%
                    </span>
                  </div>
                  <div
                    style={{
                      width: '100%',
                      height: 6,
                      background: '#1a1a1a',
                      borderRadius: 3,
                      overflow: 'hidden',
                      border: '1px solid #333',
                    }}
                  >
                    <div
                      style={{
                        width: `${importProgress}%`,
                        height: '100%',
                        background: '#1e3a8a',
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Action Button */}
              <button
                onClick={handleImport}
                disabled={
                  isImporting ||
                  !selectedFiles ||
                  selectedFiles.length === 0 ||
                  !selectedProject
                }
                style={{
                  height: 32,
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: 'none',
                  background:
                    isImporting ||
                    !selectedFiles ||
                    selectedFiles.length === 0 ||
                    !selectedProject
                      ? '#374151'
                      : '#1e3a8a',
                  color:
                    isImporting ||
                    !selectedFiles ||
                    selectedFiles.length === 0 ||
                    !selectedProject
                      ? '#9ca3af'
                      : '#ffffff',
                  fontSize: 10,
                  fontWeight: 500,
                  cursor:
                    isImporting ||
                    !selectedFiles ||
                    selectedFiles.length === 0 ||
                    !selectedProject
                      ? 'not-allowed'
                      : 'pointer',
                  transition: 'background 0.15s',
                  marginTop: 6,
                }}
                onMouseEnter={e => {
                  if (
                    !isImporting &&
                    selectedFiles &&
                    selectedFiles.length > 0 &&
                    selectedProject
                  ) {
                    e.currentTarget.style.background = '#1e40af';
                  }
                }}
                onMouseLeave={e => {
                  if (
                    !isImporting &&
                    selectedFiles &&
                    selectedFiles.length > 0 &&
                    selectedProject
                  ) {
                    e.currentTarget.style.background = '#1e3a8a';
                  }
                }}
              >
                {isImporting ? 'Importing...' : 'Import'}
              </button>
            </div>
          )}
          {isOpen && (
            <div
              ref={menuRef}
              style={{
                position: 'absolute',
                top: 36,
                right: 0,
                width: 180,
                background: '#1a1a1a',
                border: '1px solid #333',
                borderRadius: 8,
                padding: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                zIndex: 50,
                boxShadow:
                  '0 8px 25px rgba(0, 0, 0, 0.4), 0 4px 10px rgba(0, 0, 0, 0.2)',
                opacity: menuHeight > 0 ? 1 : 0,
                transform: `translateY(${menuHeight > 0 ? 0 : -10}px) scaleY(${menuHeight > 0 ? 1 : 0.8})`,
                transformOrigin: 'top',
                maxHeight: menuHeight,
                overflow: 'hidden',
                transition: 'all 0.2s cubic-bezier(0.2, 0, 0.2, 1)',
              }}
            >
              {!result ? (
                <>
                  <div
                    style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
                  >
                    {methodOptions.map(m => {
                      const added = addedMethods.includes(m.value);
                      return (
                        <button
                          key={m.value}
                          onClick={() => {
                            if (added) {
                              setAddedMethods(prev =>
                                prev.filter(v => v !== m.value)
                              );
                            } else {
                              setAddedMethods(prev => [...prev, m.value]);
                            }
                          }}
                          style={{
                            height: 32,
                            padding: '6px 8px',
                            borderRadius: 4,
                            border: added ? '1px solid #333' : '1px solid #333',
                            background: added
                              ? 'rgba(107,114,128,0.15)'
                              : 'transparent',
                            color: added ? '#CDCDCD' : '#CDCDCD',
                            fontSize: 10,
                            cursor: 'pointer',
                            textAlign: 'left',
                            transition:
                              'background 0.15s, border-color 0.15s, color 0.15s',
                            fontWeight: added ? 500 : 400,
                            display: 'flex',
                            alignItems: 'center',
                          }}
                          onMouseEnter={e => {
                            if (!added) {
                              e.currentTarget.style.background = '#2a2a2a';
                              e.currentTarget.style.borderColor = '#444';
                            }
                          }}
                          onMouseLeave={e => {
                            if (!added) {
                              e.currentTarget.style.background = 'transparent';
                              e.currentTarget.style.borderColor = '#333';
                            }
                          }}
                        >
                          <span>{m.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  {(!userId || !projectId) && (
                    <div
                      style={{
                        fontSize: 10,
                        color: '#f87171',
                        marginTop: 2,
                        padding: '3px 6px',
                        background: 'rgba(248, 113, 113, 0.1)',
                        borderRadius: 3,
                      }}
                    >
                      {!userId && 'Missing user ID. '}
                      {!projectId && 'Missing project ID.'}
                    </div>
                  )}
                  {addedMethods.length === 0 && (
                    <div
                      style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}
                    >
                      Select at least one method
                    </div>
                  )}
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      marginTop: 8,
                    }}
                  >
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                    >
                      <input
                        type='checkbox'
                        id='useJsonPointer'
                        checked={useJsonPointer}
                        onChange={e => setUseJsonPointer(e.target.checked)}
                        disabled={!currentTreePath || currentTreePath === ''}
                        style={{
                          width: 16,
                          height: 16,
                          cursor:
                            currentTreePath && currentTreePath !== ''
                              ? 'pointer'
                              : 'not-allowed',
                          accentColor: '#2563eb',
                        }}
                      />
                      <label
                        htmlFor='useJsonPointer'
                        style={{
                          fontSize: 10,
                          color:
                            currentTreePath && currentTreePath !== ''
                              ? '#CDCDCD'
                              : '#6b7280',
                          cursor:
                            currentTreePath && currentTreePath !== ''
                              ? 'pointer'
                              : 'not-allowed',
                          userSelect: 'none',
                        }}
                      >
                        JSON Pointer
                        {currentTreePath && currentTreePath !== '' && (
                          <span
                            style={{
                              fontSize: 9,
                              color: '#94a3b8',
                              marginLeft: 4,
                            }}
                          >
                            (
                            {currentTreePath.length > 15
                              ? currentTreePath.substring(0, 15) + '...'
                              : currentTreePath}
                            )
                          </span>
                        )}
                      </label>
                    </div>
                    {!currentTreePath && (
                      <div
                        style={{
                          fontSize: 9,
                          color: '#94a3b8',
                          marginLeft: 20,
                        }}
                      >
                        Select a node to enable
                      </div>
                    )}
                    {currentTreePath === '' && (
                      <div
                        style={{
                          fontSize: 9,
                          color: '#94a3b8',
                          marginLeft: 20,
                        }}
                      >
                        Root node - no pointer needed
                      </div>
                    )}
                    {useJsonPointer &&
                      (!currentTreePath || currentTreePath === '') && (
                        <div
                          style={{
                            fontSize: 9,
                            color: '#f87171',
                            marginLeft: 20,
                          }}
                        >
                          No valid path selected
                        </div>
                      )}
                  </div>
                  <button
                    onClick={handleApply}
                    disabled={
                      isApplying ||
                      addedMethods.length === 0 ||
                      !userId ||
                      !projectId
                    }
                    title={
                      !userId || !projectId
                        ? 'Missing user ID or project ID'
                        : addedMethods.length === 0
                          ? 'Select at least one method'
                          : ''
                    }
                    style={{
                      marginTop: 6,
                      height: 32,
                      borderRadius: 6,
                      border: 'none',
                      background:
                        isApplying ||
                        addedMethods.length === 0 ||
                        !userId ||
                        !projectId
                          ? '#374151'
                          : '#1e3a8a',
                      color:
                        isApplying ||
                        addedMethods.length === 0 ||
                        !userId ||
                        !projectId
                          ? '#9ca3af'
                          : '#ffffff',
                      fontSize: 11,
                      fontWeight: 500,
                      cursor:
                        isApplying ||
                        addedMethods.length === 0 ||
                        !userId ||
                        !projectId
                          ? 'not-allowed'
                          : 'pointer',
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => {
                      if (
                        !isApplying &&
                        addedMethods.length > 0 &&
                        userId &&
                        projectId
                      ) {
                        e.currentTarget.style.background = '#1e40af';
                      }
                    }}
                    onMouseLeave={e => {
                      if (
                        !isApplying &&
                        addedMethods.length > 0 &&
                        userId &&
                        projectId
                      ) {
                        e.currentTarget.style.background = '#1e3a8a';
                      }
                    }}
                  >
                    {isApplying ? 'Creating...' : 'Create'}
                  </button>
                </>
              ) : (
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
                >
                  <McpInstanceInfo
                    instance={
                      {
                        mcp_instance_id: '',
                        api_key: result.apiKey,
                        url: result.url,
                        user_id: userId || '',
                        project_id: projectId || '',
                        table_id: tableId || '',
                        name: null,
                        json_pointer: '',
                        status: 1,
                        port: result.port,
                        docker_info: {},
                        tools_definition: null,
                        register_tools: null,
                        preview_keys: null,
                      } as McpInstance
                    }
                  />
                  <button
                    onClick={() => setResult(null)}
                    style={{
                      marginTop: 6,
                      height: 32,
                      borderRadius: 6,
                      border: '1px solid #333',
                      background: '#1a1a1a',
                      color: '#CDCDCD',
                      fontSize: 11,
                      cursor: 'pointer',
                      transition: 'background 0.15s, border-color 0.15s',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = '#2a2a2a';
                      e.currentTarget.style.borderColor = '#444';
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = '#1a1a1a';
                      e.currentTarget.style.borderColor = '#333';
                    }}
                  >
                    Back
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </>
    );
  }
);
