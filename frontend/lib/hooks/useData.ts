/**
 * SWR 数据请求 Hooks
 *
 * 提供缓存、去重、自动重新验证的数据请求能力
 */

import useSWR, { mutate } from 'swr';
import {
  getProjects,
  getTable,
  getOrphanTables,
  type ProjectInfo,
  type TableData,
  type TableInfo,
} from '../projectsApi';
import {
  getTools,
  getToolsByProjectId,
  getToolsByNodeId,
  type Tool,
} from '../mcpApi';
import { listNodes, type NodeInfo } from '../contentNodesApi';

// SWR 配置：关闭自动重新验证，依赖手动刷新
const defaultConfig = {
  revalidateOnFocus: false, // 窗口聚焦时不自动刷新
  revalidateOnReconnect: false, // 网络恢复时不自动刷新
  dedupingInterval: 30000, // 30秒内相同请求去重
  errorRetryCount: 2, // 错误重试次数
};

/**
 * 获取项目列表
 *
 * - 自动缓存，多个组件共享同一份数据
 * - 30秒内不重复请求
 */
export function useProjects() {
  const {
    data,
    error,
    isLoading,
    mutate: revalidate,
  } = useSWR<ProjectInfo[]>('projects', getProjects, defaultConfig);

  return {
    projects: data ?? [],
    isLoading,
    error,
    refresh: revalidate,
  };
}

/**
 * 获取单个表数据
 *
 * @param projectId 项目 ID
 * @param tableId 表 ID (可选，为空时不请求)
 *
 * - 按需加载：只有 tableId 存在时才请求
 * - 自动缓存：相同 tableId 共享数据
 */
export function useTable(projectId: string, tableId: string | undefined) {
  const {
    data,
    error,
    isLoading,
    mutate: revalidate,
  } = useSWR<TableData>(
    // key: 只有 tableId 存在时才请求
    tableId ? ['table', projectId, tableId] : null,
    () => getTable(projectId, tableId!),
    {
      ...defaultConfig,
      dedupingInterval: 10000, // 表数据 10 秒去重
      keepPreviousData: true,  // 切换节点时保留旧数据直到新数据到达
    }
  );

  return {
    tableData: data,
    isLoading,
    error,
    refresh: revalidate,
  };
}

/**
 * 获取裸 Table 列表（不属于任何 Project）
 */
export function useOrphanTables() {
  const {
    data,
    error,
    isLoading,
    mutate: revalidate,
  } = useSWR<TableInfo[]>('orphan-tables', getOrphanTables, defaultConfig);

  return {
    orphanTables: data ?? [],
    isLoading,
    error,
    refresh: revalidate,
  };
}

/**
 * 手动刷新项目列表（用于创建/删除项目后）
 * 
 * @returns Promise that resolves when the data is actually fetched
 */
export async function refreshProjects() {
  // 同时刷新孤儿 tables
  mutate('orphan-tables');
  // Force revalidation and wait for the actual data to be fetched
  // Setting the second param to undefined and third to { revalidate: true }
  // ensures we actually fetch fresh data from the server
  const result = await mutate('projects', undefined, { revalidate: true });
  return result;
}

/**
 * 手动刷新指定表数据（用于保存后）
 */
export function refreshTable(projectId: string, tableId: string) {
  return mutate(['table', projectId, tableId]);
}

/**
 * 更新表数据缓存（乐观更新，不发请求）
 */
export function updateTableCache(
  projectId: string,
  tableId: string,
  newData: TableData
) {
  return mutate(['table', projectId, tableId], newData, { revalidate: false });
}

/**
 * 获取指定文件夹下的子节点列表（SWR 缓存）
 *
 * - 全局缓存：ExplorerSidebar / GridView / ListView 共享同一份数据
 * - 组件重挂后瞬间返回缓存，不显示 Loading
 * - keepPreviousData: 切换文件夹时保留旧列表直到新数据到达
 */
export function useContentNodes(projectId: string, parentId: string | null | undefined) {
  const key = projectId ? ['nodes', projectId, parentId ?? '__root__'] : null;
  const {
    data,
    error,
    isLoading,
    mutate: revalidate,
  } = useSWR<NodeInfo[]>(
    key,
    () => listNodes(projectId, parentId ?? undefined).then(r => r.nodes),
    {
      ...defaultConfig,
      dedupingInterval: 10000,
      keepPreviousData: true,
      revalidateOnFocus: true,
    }
  );

  return {
    nodes: data ?? [],
    isLoading,
    error,
    refresh: revalidate,
  };
}

/**
 * 手动刷新指定文件夹下的节点列表
 * parentId = null 表示项目根目录
 */
export function refreshContentNodes(projectId: string, parentId: string | null) {
  return mutate(['nodes', projectId, parentId ?? '__root__']);
}

/**
 * 刷新整个项目的所有文件夹缓存（用于外部变更：MCP/Bot/Sync）
 * 使用 SWR 的 key matcher 匹配所有 ['nodes', projectId, *] 的缓存
 */
export function refreshAllContentNodes(projectId: string) {
  return mutate(
    key => Array.isArray(key) && key[0] === 'nodes' && key[1] === projectId,
    undefined,
    { revalidate: true }
  );
}

/**
 * 获取指定节点的 Tools（使用后端直接过滤）
 *
 * @param nodeId 节点 ID (可选，为空时不请求)
 *
 * - 按需加载：只有 nodeId 存在时才请求
 * - 后端过滤：直接调用 /api/v1/tools/by-node/{nodeId}
 * - 自动缓存：相同 nodeId 共享数据
 */
export function useTableTools(nodeId: string | undefined) {
  // 获取指定节点的 tools
  const {
    data: tableTools,
    error,
    isLoading,
    mutate: revalidate,
  } = useSWR<Tool[]>(
    nodeId ? ['tools-by-node', nodeId] : null,
    () => getToolsByNodeId(nodeId!),
    {
      ...defaultConfig,
      dedupingInterval: 10000,
    }
  );

  // 同时获取所有 tools 的总数（用于 sidebar badge）
  const { data: allToolsData } = useSWR<Tool[]>('all-tools', () => getTools(), {
    ...defaultConfig,
    dedupingInterval: 30000, // 30 秒去重，因为只用于显示总数
  });

  return {
    tools: tableTools ?? [],
    allTools: allToolsData ?? [],
    isLoading,
    error,
    refresh: revalidate,
  };
}

/**
 * 获取指定项目下的所有 Tools（聚合所有节点）
 */
export function useProjectTools(projectId: string | undefined) {
  const {
    data,
    error,
    isLoading,
    mutate: revalidate,
  } = useSWR<Tool[]>(
    projectId ? ['tools-by-project', projectId] : null,
    () => getToolsByProjectId(projectId!),
    {
      ...defaultConfig,
      dedupingInterval: 10000,
      // 用户经常在左侧配置完权限再打开 Chat；允许聚焦时自动刷新一次，避免"第一次不显示"
      revalidateOnFocus: true,
    }
  );

  return {
    tools: data ?? [],
    isLoading,
    error,
    refresh: revalidate,
  };
}

/**
 * 手动刷新指定项目的 Tools（用于：用户在 editor 侧栏配置权限后，ChatSidebar 立刻可见）
 */
export function refreshProjectTools(projectId?: string | null) {
  if (projectId) {
    return mutate(['tools-by-project', projectId]);
  }
  return Promise.resolve(undefined);
}

/**
 * 手动刷新指定节点的 Tools
 */
export function refreshTableTools(nodeId?: string) {
  if (nodeId) {
    mutate(['tools-by-node', nodeId]);
  }
  // 同时刷新 all-tools 缓存
  return mutate('all-tools');
}

// ============================================
// Tools & MCP 页面专用 Hooks
// ============================================

import {
  getMcpV2Instances,
  getBoundTools,
  type McpV2Instance,
  type BoundTool,
} from '../mcpApi';

/**
 * 获取所有 Tools（带缓存）
 * - 30秒内不重复请求
 * - 多组件共享数据
 */
export function useAllTools() {
  const {
    data,
    error,
    isLoading,
    mutate: revalidate,
  } = useSWR<Tool[]>('all-tools', () => getTools(), defaultConfig);

  return {
    tools: data ?? [],
    isLoading,
    error,
    refresh: revalidate,
  };
}

/**
 * 获取 MCP 实例列表（不含 bound tools）
 * - 30秒内不重复请求
 * - 只获取实例基本信息，不获取绑定的 tools
 */
export function useMcpInstances() {
  const {
    data,
    error,
    isLoading,
    mutate: revalidate,
  } = useSWR<McpV2Instance[]>(
    'mcp-instances',
    () => getMcpV2Instances(),
    defaultConfig
  );

  return {
    instances: data ?? [],
    isLoading,
    error,
    refresh: revalidate,
  };
}

/**
 * 获取指定 MCP 实例的 bound tools（懒加载）
 *
 * @param apiKey MCP 实例的 api_key（为空时不请求）
 *
 * - 按需加载：只有选中某个 server 时才请求
 * - 自动缓存：相同 apiKey 共享数据
 */
export function useBoundTools(apiKey: string | undefined) {
  const {
    data,
    error,
    isLoading,
    mutate: revalidate,
  } = useSWR<BoundTool[]>(
    apiKey ? ['bound-tools', apiKey] : null,
    () => getBoundTools(apiKey!),
    {
      ...defaultConfig,
      dedupingInterval: 10000, // 10秒去重
    }
  );

  return {
    boundTools: data ?? [],
    isLoading,
    error,
    refresh: revalidate,
  };
}

/**
 * 手动刷新 Tools & MCP 相关缓存
 */
export function refreshToolsAndMcp(apiKey?: string) {
  mutate('all-tools');
  mutate('mcp-instances');
  if (apiKey) {
    mutate(['bound-tools', apiKey]);
  }
}
