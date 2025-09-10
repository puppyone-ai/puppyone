import { useState } from 'react';
import { useAppSettings } from '../states/AppSettingsContext';
import { SYSTEM_URLS } from '@/config/urls';
import { Node, Edge, MarkerType } from '@xyflow/react';

// 类型定义
interface WorkspaceBasicInfo {
  workspace_id: string;
  workspace_name: string;
}

interface InitialUserData {
  user_id: string;
  user_name: string;
  workspaces: WorkspaceBasicInfo[];
  workspace_history: any;
}

export type WorkspaceJSON = {
  blocks: Node[];
  edges: Edge[];
  viewport?: {
    x: number;
    y: number;
    zoom: number;
  };
  version?: string;
};

// 工作区切换结果类型
export type WorkspaceSwitchResult = {
  success: boolean;
  workspaceId: string;
  content: WorkspaceJSON | null;
  error?: string;
  fromCache?: boolean;
};

export const useWorkspaceManagement = () => {
  const { isLocalDeployment } = useAppSettings();

  // 🔒 安全修复：移除客户端认证处理，统一使用服务端代理认证

  // 获取用户 ID
  const fetchUserId = async (
    isLocal?: boolean
  ): Promise<string | undefined> => {
    const useLocal = isLocalDeployment;
    try {
      if (useLocal) {
        // 本地部署模式直接返回固定值，不需要API调用
        return 'local-user';
      } else {
        // 云端部署模式 - 认证现在由服务端代理处理
        const response = await fetch(`/api/user-system/get_user_id`, {
          method: 'GET',
          credentials: 'include', // 通过HttpOnly cookie自动认证
          headers: {
            'Content-Type': 'application/json',
          },
        });

        // 修复：添加详细的状态码处理
        if (response.status !== 200) {
          const error_data: { error: string } = await response.json();
          throw new Error(
            `HTTP error! status: ${response.status}, error message: ${error_data.error}`
          );
        }

        const data: { user_id: string } = await response.json();
        console.log('User Info:', data);
        return data.user_id;
      }
    } catch (error) {
      console.error('Error fetching user ID:', error);
      return undefined;
    }
  };

  // 获取用户名
  const fetchUserName = async (
    userId?: string,
    isLocal?: boolean
  ): Promise<string | undefined> => {
    const useLocal = isLocalDeployment;
    try {
      if (useLocal) {
        // 修复：本地部署模式直接返回固定值
        return 'Puppy';
      } else {
        // 云端部署模式
        let finalUserId = userId;
        if (!finalUserId) {
          finalUserId = await fetchUserId();
          if (!finalUserId) {
            throw new Error('You do not have a valid user id');
          }
        }

        const response = await fetch(
          `/api/user-system/get_user_name/${finalUserId}`,
          {
            method: 'GET',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );

        // 修复：添加完整的状态码处理
        if (response.status === 204) {
          return 'Unnamed User';
        } else if (response.status === 404) {
          const error_data: { error: string } = await response.json();
          throw new Error(
            `HTTP error! status: ${response.status}, error message: ${error_data.error}`
          );
        } else if (response.status === 200) {
          const data: { user_name: string } = await response.json();
          console.log('User Info:', data);
          return data.user_name;
        } else {
          throw new Error(
            `HTTP error! status: ${response.status}, error message: Other errors`
          );
        }
      }
    } catch (error) {
      console.error('Error fetching user name:', error);
      return 'Unnamed User';
    }
  };

  // 获取工作区列表（统一走内部API）
  const fetchWorkspacesList = async (
    userId?: string,
    isLocal?: boolean
  ): Promise<WorkspaceBasicInfo[]> => {
    const useLocal = isLocalDeployment;
    try {
      // 本地/云端统一：从内部API获取
      const response = await fetch('/api/workspace/list');
      if (!response.ok) {
        throw new Error('Failed to fetch workspace list');
      }
      const data = await response.json();
      return data.workspaces || [];
    } catch (error) {
      console.error('Error fetching workspaces info:', error);
      return [];
    }
  };

  // 初始化用户数据（完整版本）
  const initializeUserData = async (
    isLocal?: boolean
  ): Promise<InitialUserData> => {
    const useLocal = isLocalDeployment;
    try {
      if (useLocal) {
        // 本地部署模式
        const userIdResult = await fetchUserId(true);
        const userNameResult = await fetchUserName(undefined, true);
        const workspacesResult = await fetchWorkspacesList(undefined, true);

        return {
          user_id: userIdResult || 'local-user',
          user_name: userNameResult || 'Puppy',
          workspaces: workspacesResult || [],
          workspace_history: {},
        };
      } else {
        // 云端部署模式 - 认证现在由服务端代理处理
        const response = await fetch(
          `/api/user-system/initialize_user_data_v2`,
          {
            method: 'GET',
            credentials: 'include', // 通过HttpOnly cookie自动认证
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );

        if (response.status !== 200) {
          const error_data: { error: string } = await response.json();
          throw new Error(
            `HTTP error! status: ${response.status}, error message: ${error_data.error}`
          );
        }

        const data = await response.json();
        console.log('Initialize User Data V2:', data);
        return data;
      }
    } catch (error) {
      console.error('Error in initializeUserData:', error);

      return {
        user_id: useLocal ? 'local-user' : '',
        user_name: useLocal ? 'Puppy' : '',
        workspaces: [],
        workspace_history: {},
      };
    }
  };

  // 创建工作区
  const createWorkspace = async (
    workspaceId: string,
    workspaceName: string,
    userId?: string
  ): Promise<WorkspaceBasicInfo | undefined> => {
    try {
      if (isLocalDeployment) {
        // 本地部署模式：直接返回workspace信息，目录会在保存时创建
        return {
          workspace_id: workspaceId,
          workspace_name: workspaceName,
        };
      } else {
        // 云端部署模式：统一走内部创建接口（服务端解析用户）
        const response = await fetch(`/api/workspace/create`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            workspace_id: workspaceId,
            workspace_name: workspaceName,
          }),
        });

        if (!response.ok) {
          const error_data: { error?: string } = await response
            .json()
            .catch(() => ({}) as any);
          throw new Error(
            `HTTP error! status: ${response.status}, error message: ${error_data?.error || response.statusText}`
          );
        }

        const data: { workspace_id: string; workspace_name: string } =
          await response.json();
        return {
          workspace_id: data.workspace_id,
          workspace_name: data.workspace_name,
        };
      }
    } catch (error) {
      console.error('Error creating workspace:', error);
    }
    return undefined;
  };

  // 删除工作区
  const deleteWorkspace = async (workspaceId: string): Promise<boolean> => {
    try {
      if (isLocalDeployment) {
        // 本地部署模式
        const response = await fetch(`/api/workspace/${workspaceId}`, {
          method: 'DELETE',
        });
        return response.ok;
      } else {
        // 云端统一内部接口
        const response = await fetch(`/api/workspace/${workspaceId}`, {
          method: 'DELETE',
        });
        return response.ok;
      }
    } catch (error) {
      console.error('Error deleting workspace:', error);
      return false;
    }
  };

  // 重命名工作区
  const renameWorkspace = async (
    workspaceId: string,
    newName: string
  ): Promise<WorkspaceBasicInfo | undefined> => {
    try {
      if (isLocalDeployment) {
        // 本地部署模式
        const response = await fetch(`/api/workspace/${workspaceId}/rename`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ new_name: newName }),
        });

        if (response.ok) {
          const data = await response.json();
          return {
            workspace_id: data.workspace_id,
            workspace_name: data.workspace_name,
          };
        }
      } else {
        // 云端统一内部接口
        const response = await fetch(`/api/workspace/${workspaceId}/rename`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ new_name: newName }),
        });
        if (!response.ok) return undefined;
        const data = await response.json();
        return {
          workspace_id: data.workspace_id,
          workspace_name: data.workspace_name,
        };
      }
    } catch (error) {
      console.error('Error renaming workspace:', error);
    }
    return undefined;
  };

  // 获取工作区的最新内容
  const fetchWorkspaceContent = async (
    workspaceId: string,
    isLocal?: boolean
  ): Promise<WorkspaceJSON | null> => {
    const useLocal = isLocalDeployment;
    try {
      if (useLocal) {
        // 修复：本地部署模式使用正确的API路径
        const response = await fetch(`/api/workspace?flowId=${workspaceId}`);
        if (!response.ok) {
          return null;
        }
        const { data } = await response.json();
        return data || null;
      } else {
        // 云端统一内部接口
        const response = await fetch(`/api/workspace?flowId=${workspaceId}`);
        if (!response.ok) return null;
        const { data } = await response.json();
        return data || null;
      }
    } catch (error) {
      console.error(
        'Error fetching workspace content for workspace:',
        workspaceId,
        error
      );
      return null;
    }
  };

  // 保存工作区内容
  const saveWorkspaceContent = async (
    workspaceId: string,
    content: WorkspaceJSON,
    timestamp: string,
    isLocal?: boolean
  ): Promise<boolean> => {
    const useLocal = isLocalDeployment;
    try {
      if (useLocal) {
        // 本地部署模式：保存到文件系统
        const response = await fetch('/api/workspace', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            flowId: workspaceId,
            json: content,
            timestamp,
          }),
        });

        return response.ok;
      } else {
        // 云端统一内部接口
        const response = await fetch(`/api/workspace`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            flowId: workspaceId,
            json: content,
            timestamp,
          }),
        });
        return response.ok;
      }
    } catch (error) {
      console.error('Error saving workspace content:', error);
      throw error; // 重新抛出error 允许外部function 识别error并报错
    }
  };

  // JSON 规范化工具函数
  const normalizeWorkspaceJson = (json: any): WorkspaceJSON => {
    if (!json?.blocks || !json?.edges) return json;

    const normalizeNode = (node: any) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      data: {
        ...node.data,
        label: node.data?.label || '',
        content: node.data?.content || '',
      },
      selected: node.selected || false,
      dragging: node.dragging || false,
      width: node.width,
      height: node.height,
      resizing: node.resizing || false,
    });

    const normalizeEdge = (edge: any) => ({
      id: edge.id,
      type: edge.type,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      data: {
        ...edge.data,
        inputs:
          edge.data?.inputs?.sort((a: any, b: any) =>
            a.id.localeCompare(b.id)
          ) || [],
        outputs:
          edge.data?.outputs?.sort((a: any, b: any) =>
            a.id.localeCompare(b.id)
          ) || [],
        connectionType: edge.data?.connectionType,
        code: edge.data?.code,
        content_type: edge.data?.content_type,
        modify_type: edge.data?.modify_type,
        extra_configs: edge.data?.extra_configs,
        messages: edge.data?.messages,
        looped: edge.data?.looped,
      },
    });

    return {
      blocks: json.blocks
        .map(normalizeNode)
        .sort((a: any, b: any) => a.id.localeCompare(b.id)),
      edges: json.edges
        .map(normalizeEdge)
        .sort((a: any, b: any) => a.id.localeCompare(b.id)),
      viewport: json.viewport || { x: 0, y: 0, zoom: 1 },
      version: json.version || '1.0.0',
    };
  };

  // JSON 相等性比较
  const isJsonEqual = (json1: any, json2: any): boolean => {
    // 基础类型快速判定
    if (!json1 || !json2) return json1 === json2;
    if (json1 === json2) return true;

    // 结构有效性判定
    const isValidWorkspaceJson = (json: any) => {
      const hasValidBlocks = Array.isArray(json?.blocks);
      const hasValidEdges = Array.isArray(json?.edges);
      return hasValidBlocks && hasValidEdges;
    };

    if (!isValidWorkspaceJson(json1) || !isValidWorkspaceJson(json2)) {
      return false;
    }

    // 长度快速判定
    if (
      json1.blocks.length !== json2.blocks.length ||
      json1.edges.length !== json2.edges.length
    ) {
      return false;
    }

    // ID集合快速判定
    const getIds = (items: any[]) => new Set(items.map(item => item.id));
    const blocks1Ids = getIds(json1.blocks);
    const blocks2Ids = getIds(json2.blocks);
    const edges1Ids = getIds(json1.edges);
    const edges2Ids = getIds(json2.edges);

    if (
      blocks1Ids.size !== blocks2Ids.size ||
      edges1Ids.size !== edges2Ids.size
    ) {
      return false;
    }

    // ID一致性快速判定
    const areIdsSame =
      Array.from(blocks1Ids).every(id => blocks2Ids.has(id)) &&
      Array.from(edges1Ids).every(id => edges2Ids.has(id));
    if (!areIdsSame) {
      return false;
    }

    // 完整的标准化比较
    const normalized1 = normalizeWorkspaceJson(json1);
    const normalized2 = normalizeWorkspaceJson(json2);

    return JSON.stringify(normalized1) === JSON.stringify(normalized2);
  };

  // 验证工作区 JSON 结构
  const validateWorkspaceJson = (json: any): boolean => {
    if (!json) return false;

    const hasValidBlocks = Array.isArray(json?.blocks);
    const hasValidEdges = Array.isArray(json?.edges);

    return hasValidBlocks && hasValidEdges;
  };

  // 获取默认工作区模板
  // 获取默认工作区模板
  // 获取默认工作区模板
  const getDefaultWorkspaceTemplate = (): WorkspaceJSON => {
    return {
      blocks: [
        {
          id: 'llmnew-default',
          type: 'llmnew',
          position: {
            x: -16,
            y: 0,
          },
          data: {
            subMenuType: null,
            content: [
              {
                role: 'system',
                content: "You are an AI that helps answer people's questions.",
              },
              {
                role: 'user',
                content: 'Answer the question: {{Query}}',
              },
            ],
            model: 'openai/gpt-4o-mini',
            base_url: '',
            structured_output: false,
            max_tokens: 4096,
            resultNode: 'response_default',
            modelAndProvider: {
              id: 'openai/gpt-4o-mini',
              name: 'GPT-4o Mini',
              provider: 'OpenAI',
              isLocal: false,
            },
          },

          selected: false,
          dragging: false,
          style: {
            zIndex: 1122,
          },
        },
        {
          id: 'query_default',
          position: {
            x: -352,
            y: -64,
          },
          data: {
            content: 'Intruduce yourself within 10 words',
            label: 'Query',
            isLoading: false,
            locked: false,
            isInput: true,
            isOutput: false,
            editable: false,
            isWaitingForFlow: false,
          },
          type: 'text',

          width: 240,
          height: 176,
          style: {
            zIndex: 1093,
          },
          selected: false,
        },
        {
          id: 'response_default',
          position: {
            x: 160,
            y: -64,
          },
          data: {
            content: "I'm an AI designed to assist with your questions.",
            label: 'Response',
            isLoading: false,
            locked: false,
            isInput: false,
            isOutput: true,
            editable: false,
            isWaitingForFlow: false,
          },
          width: 240,
          height: 176,

          type: 'text',
          style: {
            zIndex: 1125,
          },
          selected: false,
          dragging: false,
        },
      ],
      edges: [
        {
          source: 'query_default',
          sourceHandle: 'query_default-b',
          target: 'llmnew-default',
          targetHandle: 'llmnew-default-d',
          id: 'connection-1754293236547',
          type: 'floating',
          data: {
            connectionType: 'STC',
          },
        },
        {
          id: 'connection-1754293296391',
          source: 'llmnew-default',
          target: 'response_default',
          type: 'floating',
          data: {
            connectionType: 'CTT',
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 8,
            height: 20,
            color: '#CDCDCD',
            strokeWidth: 0.1,
          },
        },
      ],
      viewport: { x: 915, y: 801, zoom: 1 },
      version: '0.0.1',
    };
  };
  // 切换到指定工作区并获取其内容
  const switchToWorkspace = async (
    workspaceId: string,
    existingWorkspace?: {
      content: WorkspaceJSON | null;
      pullFromDatabase: boolean;
    }
  ): Promise<WorkspaceSwitchResult> => {
    console.log('🔄 Switching to workspace:', workspaceId);

    // 如果已经从数据库拉取过，直接使用缓存的数据
    if (
      existingWorkspace &&
      existingWorkspace.pullFromDatabase &&
      existingWorkspace.content
    ) {
      console.log('🚀 Using cached workspace content:', workspaceId);

      return {
        success: true,
        workspaceId,
        content: existingWorkspace.content,
        fromCache: true, // 添加标识表示来自缓存
      };
    }

    // 如果没有缓存或者没有从数据库拉取过，才从数据库获取
    console.log('📥 Fetching workspace content from database:', workspaceId);

    try {
      const content = await fetchWorkspaceContent(workspaceId);

      if (content) {
        console.log('✅ Successfully switched to workspace:', {
          workspaceId,
          content,
          blocksCount: content.blocks?.length || 0,
          edgesCount: content.edges?.length || 0,
          viewport: content.viewport,
          version: content.version,
        });

        return {
          success: true,
          workspaceId,
          content,
          fromCache: false, // 表示来自数据库
        };
      } else {
        console.log(
          '⚠️ No content found for workspace, using default template:',
          workspaceId
        );

        // 如果没有内容，返回默认模板
        const defaultTemplate = getDefaultWorkspaceTemplate();

        console.log('📝 Using default template for workspace:', {
          workspaceId,
          content: defaultTemplate,
          blocksCount: defaultTemplate.blocks?.length || 0,
          edgesCount: defaultTemplate.edges?.length || 0,
        });

        return {
          success: true,
          workspaceId,
          content: defaultTemplate,
          fromCache: false,
        };
      }
    } catch (error) {
      console.error('❌ Error switching to workspace:', {
        workspaceId,
        error: error instanceof Error ? error.message : 'Unknown error',
        fullError: error,
      });

      return {
        success: false,
        workspaceId,
        content: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  };

  // 批量获取多个工作区的内容（用于预加载）
  const preloadWorkspaceContents = async (
    workspaceIds: string[]
  ): Promise<Record<string, WorkspaceJSON | null>> => {
    console.log('🔄 Preloading workspace contents for:', workspaceIds);

    const results: Record<string, WorkspaceJSON | null> = {};

    // 并行获取所有工作区内容
    const promises = workspaceIds.map(async id => {
      try {
        const content = await fetchWorkspaceContent(id);
        console.log(
          `✅ Preloaded workspace ${id}:`,
          content ? 'success' : 'no content'
        );
        return { id, content };
      } catch (error) {
        console.error(`❌ Error preloading workspace ${id}:`, error);
        return { id, content: null };
      }
    });

    const resolvedResults = await Promise.all(promises);

    resolvedResults.forEach(({ id, content }) => {
      results[id] = content;
    });

    console.log(
      '📦 Preload results:',
      Object.keys(results).length,
      'workspaces processed'
    );
    return results;
  };

  // 检查工作区是否存在内容
  const hasWorkspaceContent = async (workspaceId: string): Promise<boolean> => {
    try {
      const content = await fetchWorkspaceContent(workspaceId);
      const hasContent = content !== null && validateWorkspaceJson(content);
      console.log(`🔍 Workspace ${workspaceId} has content:`, hasContent);
      return hasContent;
    } catch (error) {
      console.error('❌ Error checking workspace content:', workspaceId, error);
      return false;
    }
  };

  // 创建工作区并初始化默认内容
  const createWorkspaceWithContent = async (
    workspaceId: string,
    workspaceName: string,
    initialContent?: WorkspaceJSON,
    userId?: string
  ): Promise<{
    workspace: WorkspaceBasicInfo | null;
    content: WorkspaceJSON | null;
    success: boolean;
    error?: string;
  }> => {
    try {
      // 1. 创建工作区
      const workspace = await createWorkspace(
        workspaceId,
        workspaceName,
        userId
      );

      if (!workspace) {
        return {
          workspace: null,
          content: null,
          success: false,
          error: 'Failed to create workspace',
        };
      }

      // 2. 初始化内容
      const content = initialContent || getDefaultWorkspaceTemplate();
      const timestamp = new Date().toISOString();

      // 3. 保存初始内容
      const saveSuccess = await saveWorkspaceContent(
        workspaceId,
        content,
        timestamp
      );

      if (!saveSuccess) {
        console.warn('⚠️ Workspace created but failed to save initial content');
      }

      console.log('✅ Created workspace with content:', {
        workspaceId,
        workspaceName,
        contentSaved: saveSuccess,
      });

      return {
        workspace,
        content,
        success: true,
      };
    } catch (error) {
      console.error('❌ Error creating workspace with content:', error);
      return {
        workspace: null,
        content: null,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  };

  return {
    // 用户数据获取
    fetchUserId,
    fetchUserName,
    initializeUserData,

    // 工作区列表管理
    fetchWorkspacesList,
    createWorkspace,
    createWorkspaceWithContent,
    deleteWorkspace,
    renameWorkspace,

    // 工作区内容管理
    fetchWorkspaceContent,
    saveWorkspaceContent,
    switchToWorkspace,
    preloadWorkspaceContents,
    hasWorkspaceContent,

    // JSON 处理工具
    normalizeWorkspaceJson,
    isJsonEqual,
    validateWorkspaceJson,
    getDefaultWorkspaceTemplate,
  };
};
