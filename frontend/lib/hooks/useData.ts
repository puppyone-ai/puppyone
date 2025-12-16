/**
 * SWR 数据请求 Hooks
 * 
 * 提供缓存、去重、自动重新验证的数据请求能力
 */

import useSWR, { mutate } from 'swr'
import { getProjects, getTable, type ProjectInfo, type TableData } from '../projectsApi'

// SWR 配置：关闭自动重新验证，依赖手动刷新
const defaultConfig = {
  revalidateOnFocus: false,      // 窗口聚焦时不自动刷新
  revalidateOnReconnect: false,  // 网络恢复时不自动刷新
  dedupingInterval: 30000,       // 30秒内相同请求去重
  errorRetryCount: 2,            // 错误重试次数
}

/**
 * 获取项目列表
 * 
 * - 自动缓存，多个组件共享同一份数据
 * - 30秒内不重复请求
 */
export function useProjects() {
  const { data, error, isLoading, mutate: revalidate } = useSWR<ProjectInfo[]>(
    'projects',
    getProjects,
    defaultConfig
  )

  return {
    projects: data ?? [],
    isLoading,
    error,
    refresh: revalidate,
  }
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
  const { data, error, isLoading, mutate: revalidate } = useSWR<TableData>(
    // key: 只有 tableId 存在时才请求
    tableId ? ['table', projectId, tableId] : null,
    () => getTable(projectId, tableId!),
    {
      ...defaultConfig,
      dedupingInterval: 10000, // 表数据 10 秒去重
    }
  )

  return {
    tableData: data,
    isLoading,
    error,
    refresh: revalidate,
  }
}

/**
 * 手动刷新项目列表（用于创建/删除项目后）
 */
export function refreshProjects() {
  return mutate('projects')
}

/**
 * 手动刷新指定表数据（用于保存后）
 */
export function refreshTable(projectId: string, tableId: string) {
  return mutate(['table', projectId, tableId])
}

/**
 * 更新表数据缓存（乐观更新，不发请求）
 */
export function updateTableCache(projectId: string, tableId: string, newData: TableData) {
  return mutate(['table', projectId, tableId], newData, { revalidate: false })
}

