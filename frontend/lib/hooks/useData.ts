/**
 * SWR 数据请求 Hooks
 *
 * 提供缓存、去重、自动重新验证的数据请求能力
 */

import useSWR, { mutate } from 'swr';
import {
  getProjects,
  getProject,
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
import {
  directChildrenOf,
  listDir,
  normalizeTreePath,
  sortNodes,
  type NodeInfo,
} from '../contentTreeApi';
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
  const isDisabled = orgId === null;
  const key = isDisabled ? null : orgId ? ['projects', orgId] : 'projects';
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
    projects: isDisabled ? [] : data ?? [],
    isLoading: isDisabled ? false : isLoading,
    error,
    refresh: revalidate,
  };
}

/**
 * 获取单个项目详情。
 *
 * Used by project routes as the URL-level source of truth. This keeps a
 * refreshed `/projects/:projectId/...` page stable even before the selected
 * organization's project list has finished hydrating.
 */
export function useProject(projectId?: string | null) {
  const {
    data,
    error,
    isLoading,
    mutate: revalidate,
  } = useSWR<ProjectInfo>(
    projectId ? ['project', projectId] : null,
    () => getProject(projectId!),
    defaultConfig,
  );

  return {
    project: data ?? null,
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
  if (orgId === null) {
    return undefined;
  }
  if (orgId) {
    return mutate(['projects', orgId], undefined, { revalidate: true });
  }
  return mutate('projects', undefined, { revalidate: true });
}

/**
 * Atomically upsert a project in the cached project list after create/update.
 *
 * This keeps the Projects dashboard from rendering a synthetic pending card
 * and then waiting for a second list fetch before counts/previews settle.
 */
export function upsertProjectCache(orgId: string | null | undefined, project: ProjectInfo) {
  const key = orgId ? ['projects', orgId] : 'projects';
  return mutate<ProjectInfo[]>(
    key,
    (current = []) => {
      const without = current.filter((p) => p.id !== project.id);
      return [project, ...without];
    },
    { revalidate: false },
  );
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
  const normalizedPath = normalizeTreePath(dirPath);
  const key = projectId ? ['tree', projectId, normalizedPath] : null;
  const {
    data,
    error,
    isLoading,
    isValidating,
    mutate: revalidate,
  } = useSWR<NodeInfo[]>(
    key,
    // Normalize the order at the fetcher boundary so that *whatever* the
    // backend returns ends up in canonical UI order in the SWR cache. This
    // keeps folder order stable at the fetcher boundary; see `sortNodes` for
    // the full rationale.
    () => listDir(projectId, normalizedPath)
      .then(r => sortNodes(directChildrenOf(r.nodes, normalizedPath))),
    {
      ...defaultConfig,
      dedupingInterval: 30000,
      keepPreviousData: true,
    }
  );

  return {
    nodes: data ?? [],
    isLoading,
    isValidating,
    error,
    refresh: revalidate,
  };
}

/** Use the current directory-backed content listing. */
export function useContentNodes(projectId: string, parentPath: string | null | undefined) {
  return useTreeDir(projectId, parentPath);
}

/**
 * Stable project explorer listing for the left sidebar.
 *
 * This intentionally uses a separate SWR cache namespace from the folder
 * content view. The sidebar represents the whole project tree, like VS Code's
 * explorer; route changes may expand/select nodes, but they must never swap
 * the sidebar's root data source to "whatever folder the main pane is viewing".
 */
export function useExplorerTreeDir(projectId: string, dirPath: string | null | undefined) {
  const normalizedPath = normalizeTreePath(dirPath);
  const key = projectId ? ['explorer-tree', projectId, normalizedPath] : null;
  const {
    data,
    error,
    isLoading,
    isValidating,
    mutate: revalidate,
  } = useSWR<NodeInfo[]>(
    key,
    () => listDir(projectId, normalizedPath)
      .then(r => sortNodes(directChildrenOf(r.nodes, normalizedPath))),
    {
      ...defaultConfig,
      dedupingInterval: 30000,
      keepPreviousData: true,
    },
  );

  return {
    nodes: data ?? [],
    isLoading,
    isValidating,
    error,
    refresh: revalidate,
  };
}

export function useExplorerRootNodes(projectId: string) {
  const { nodes, isLoading, error, refresh } = useExplorerTreeDir(projectId, '');
  return {
    rootNodes: nodes,
    isLoading,
    error,
    refresh,
  };
}

/**
 * Manually refresh directory listing for a given path.
 */
export function refreshContentNodes(projectId: string, dirPath: string | null) {
  const normalizedPath = normalizeTreePath(dirPath);
  return Promise.all([
    mutate(['tree', projectId, normalizedPath]),
    mutate(['explorer-tree', projectId, normalizedPath]),
  ]);
}

/**
 * Refresh all directory caches for a project.
 *
 * Use ONLY when the set of changed folders is genuinely unknown
 * (external sync/MCP/bot pushes, supabase saves, connector writes).
 * User-initiated mutations whose target
 * folders are known should call ``refreshFolderNodes`` instead —
 * a single rename re-fetching every cached folder in the project
 * is what made saves feel slow.
 */
export function refreshAllContentNodes(projectId: string) {
  return Promise.all([
    mutate(
      key => Array.isArray(key) && key[0] === 'tree' && key[1] === projectId,
    ),
    mutate(
      key => Array.isArray(key) && key[0] === 'explorer-tree' && key[1] === projectId,
    ),
  ]);
}

/**
 * Refresh only the directory caches for the given folder paths.
 *
 * Use this whenever the caller knows exactly which folder listings
 * the mutation affected:
 *   - create: parent folder
 *   - rename / delete: parent folder
 *   - move: source parent + target parent
 *
 * Pass ``''`` (empty string) for the project root. ``null`` /
 * ``undefined`` are normalised to root for callers that pass
 * ``currentFolderPath`` directly.
 *
 * Compared to ``refreshAllContentNodes`` this avoids re-fetching
 * unrelated folders the user has open elsewhere — a project with
 * 20 cached folder listings now does 1 round-trip per mutation
 * instead of 20.
 */
export function refreshFolderNodes(
  projectId: string,
  ...folderPaths: (string | null | undefined)[]
) {
  if (!folderPaths.length) return Promise.resolve();
  const unique = Array.from(
    new Set(folderPaths.map((p) => normalizeTreePath(p))),
  );
  // Keep both read models fresh:
  // - `tree` backs the main content pane for the current route.
  // - `explorer-tree` backs the project-wide sidebar and is intentionally
  //   isolated so route changes cannot swap the sidebar's root listing.
  // Do not pass `undefined` as mutate data here: that clears the cached tree
  // for one render and makes the UI flash empty while revalidation is in
  // flight.
  return Promise.all([
    ...unique.map((folderPath) =>
      mutate(['tree', projectId, folderPath]),
    ),
    ...unique.map((folderPath) =>
      mutate(['explorer-tree', projectId, folderPath]),
    ),
  ]);
}

/**
 * Refresh project history wherever it is mounted. Mutating content
 * should make the History page feel live even if the websocket event
 * is delayed or the user navigates there immediately after the action.
 */
export function refreshProjectHistory(projectId: string) {
  return mutate(
    key => Array.isArray(key) && key[0] === 'project-history' && key[1] === projectId,
  );
}

/**
 * 获取指定路径的 Tools（使用后端直接过滤）
 *
 * @param path version path (可选，为空时不请求)
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
