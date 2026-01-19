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
  getToolsByTableId,
  type Tool,
} from '../mcpApi';

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
 */
export function refreshProjects() {
  // 同时刷新孤儿 tables
  mutate('orphan-tables');
  return mutate('projects');
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
 * 获取指定表的 Tools（使用后端直接过滤）
 *
 * @param tableId 表 ID (可选，为空时不请求)
 *
 * - 按需加载：只有 tableId 存在时才请求
 * - 后端过滤：直接调用 /api/v1/tools/by-table/{tableId}
 * - 自动缓存：相同 tableId 共享数据
 */
export function useTableTools(tableId: string | undefined) {
  // 获取指定 table 的 tools
  const {
    data: tableTools,
    error,
    isLoading,
    mutate: revalidate,
  } = useSWR<Tool[]>(
    tableId ? ['tools-by-table', tableId] : null,
    () => getToolsByTableId(Number(tableId)),
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
 * 获取指定项目下的所有 Tools（聚合所有 tables）
 */
export function useProjectTools(projectId: string | undefined) {
  const pid = projectId ? Number(projectId) : NaN;
  const {
    data,
    error,
    isLoading,
    mutate: revalidate,
  } = useSWR<Tool[]>(
    Number.isFinite(pid) ? ['tools-by-project', pid] : null,
    () => getToolsByProjectId(pid),
    {
      ...defaultConfig,
      dedupingInterval: 10000,
      // 用户经常在左侧配置完权限再打开 Chat；允许聚焦时自动刷新一次，避免“第一次不显示”
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
export function refreshProjectTools(projectId?: string | number | null) {
  const pid =
    projectId !== undefined && projectId !== null ? Number(projectId) : NaN;
  if (Number.isFinite(pid)) {
    return mutate(['tools-by-project', pid]);
  }
  return Promise.resolve(undefined);
}

/**
 * 手动刷新指定表的 Tools
 */
export function refreshTableTools(tableId?: string) {
  if (tableId) {
    mutate(['tools-by-table', tableId]);
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
