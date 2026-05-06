/**
 * SWR 数据请求 Hooks
 *
 * 提供缓存、去重、自动重新验证的数据请求能力
 */

import { useEffect } from 'react';
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
  getToolsByPath,
  type Tool,
} from '../mcpApi';
import { listDir, treeList, entryToNodeInfo, sortNodes, type NodeInfo, type TreeEntry } from '../contentTreeApi';
import { getConnectorSpecs, type ConnectorSpec } from '../syncApi';

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
export function useProjects(orgId?: string | null) {
  const key = orgId ? ['projects', orgId] : 'projects';
  const {
    data,
    error,
    isLoading,
    mutate: revalidate,
  } = useSWR<ProjectInfo[]>(
    key,
    () => getProjects(orgId ?? undefined),
    { ...defaultConfig, keepPreviousData: true }
  );

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
export async function refreshProjects(orgId?: string | null) {
  mutate('orphan-tables');
  if (orgId) {
    return mutate(['projects', orgId], undefined, { revalidate: true });
  }
  return mutate('projects', undefined, { revalidate: true });
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
 * Fetch directory listing for a given path (SWR cached).
 *
 * - Global cache: ExplorerSidebar / GridView / ListView share same data
 * - keepPreviousData: preserves old list while new data loads
 */
export function useTreeDir(projectId: string, dirPath: string | null | undefined) {
  const normalizedPath = dirPath ?? '';
  const key = projectId ? ['tree', projectId, normalizedPath] : null;
  const {
    data,
    error,
    isLoading,
    mutate: revalidate,
  } = useSWR<NodeInfo[]>(
    key,
    // Normalize the order at the fetcher boundary so that *whatever* the
    // backend returns ends up in canonical UI order in the SWR cache. This
    // keeps the sidebar's row order stable regardless of which read path
    // (`/ls` vs `/tree` pre-population in `useShallowTree`) last wrote the
    // cache — see `sortNodes` for the full rationale.
    () => listDir(projectId, normalizedPath).then(r => sortNodes(r.nodes)),
    {
      ...defaultConfig,
      dedupingInterval: 30000,
      keepPreviousData: true,
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
 * Backward-compatible alias for useTreeDir.
 * parentId is now treated as a directory path.
 */
export function useContentNodes(projectId: string, parentPath: string | null | undefined) {
  return useTreeDir(projectId, parentPath);
}

/**
 * Manually refresh directory listing for a given path.
 */
export function refreshContentNodes(projectId: string, dirPath: string | null) {
  return mutate(['tree', projectId, dirPath ?? '']);
}

/**
 * Refresh all directory caches for a project (used after external changes: MCP/Bot/Sync).
 */
export function refreshAllContentNodes(projectId: string) {
  return mutate(
    key => Array.isArray(key) && key[0] === 'tree' && key[1] === projectId,
    undefined,
    { revalidate: true }
  );
}

/**
 * Shallow tree: fetch the entire tree up to `maxDepth` in a single request.
 *
 * One request replaces N per-folder requests. The flat response is split by
 * parent path and pre-populated into the per-folder SWR cache so that
 * `useContentNodes(projectId, folderPath)` gets instant cache hits.
 *
 * Returns root-level nodes directly for the sidebar's initial render.
 */
export function useShallowTree(projectId: string, maxDepth: number = 1) {
  const key = projectId ? ['tree', projectId, `__shallow_${maxDepth}`] : null;
  const {
    data,
    isLoading,
    mutate: revalidate,
  } = useSWR<TreeEntry[]>(
    key,
    () => treeList(projectId, '', maxDepth),
    {
      ...defaultConfig,
      dedupingInterval: 30000,
      keepPreviousData: true,
    }
  );

  const entries = data ?? [];

  // Pre-populate per-folder SWR caches from the flat response.
  // This way useContentNodes(projectId, "docs") gets an instant cache hit.
  //
  // CRITICAL: each per-folder bucket is normalized through `sortNodes` before
  // it lands in the cache, mirroring exactly what `useTreeDir`'s fetcher does
  // when `/ls` later overwrites the same key. Without this, the cache flips
  // between the backend's `_walk_tree` order (alphabetical, case-sensitive,
  // folders intermixed with files) and `/ls`'s "folders first" order the
  // first time the user clicks into a subfolder, visibly reshuffling the
  // sidebar. By making both writes go through the same sort, the order is
  // stable regardless of which path populated the cache last.
  useEffect(() => {
    if (entries.length === 0 || !projectId) return;
    const byParent = new Map<string, NodeInfo[]>();
    for (const entry of entries) {
      const parentPath = entry.path.includes('/')
        ? entry.path.substring(0, entry.path.lastIndexOf('/'))
        : '';
      if (!byParent.has(parentPath)) byParent.set(parentPath, []);
      byParent.get(parentPath)!.push(entryToNodeInfo(entry, projectId));
    }
    for (const [parentPath, nodes] of byParent) {
      mutate(['tree', projectId, parentPath], sortNodes(nodes), { revalidate: false });
    }
  }, [entries, projectId]);

  // Root nodes = entries whose path has no "/" (top-level items).
  const rootNodes: NodeInfo[] = sortNodes(
    entries.filter(e => !e.path.includes('/')).map(e => entryToNodeInfo(e, projectId)),
  );

  return { rootNodes, isLoading, refresh: revalidate };
}

/**
 * 获取指定路径的 Tools（使用后端直接过滤）
 *
 * @param path MUT 路径 (可选，为空时不请求)
 *
 * - 按需加载：只有 path 存在时才请求
 * - 后端过滤：直接调用 /api/v1/tools/by-path/{path}
 * - 自动缓存：相同 path 共享数据
 */
export function useToolsByPath(path: string | undefined) {
  const {
    data: tableTools,
    error,
    isLoading,
    mutate: revalidate,
  } = useSWR<Tool[]>(
    path ? ['tools-by-path', path] : null,
    () => getToolsByPath(path!),
    {
      ...defaultConfig,
      dedupingInterval: 10000,
      keepPreviousData: true,
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
      dedupingInterval: 30000,
      keepPreviousData: true,
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
 * 手动刷新指定路径的 Tools
 */
export function refreshToolsByPath(path?: string) {
  if (path) {
    mutate(['tools-by-path', path]);
  }
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

/**
 * Connector specs from backend (source of truth for sync providers)
 */
export function useConnectorSpecs() {
  const { data, error, isLoading } = useSWR<ConnectorSpec[]>(
    'connector-specs',
    getConnectorSpecs,
    { ...defaultConfig, dedupingInterval: 300000 }
  );

  return { specs: data ?? [], isLoading, error };
}
