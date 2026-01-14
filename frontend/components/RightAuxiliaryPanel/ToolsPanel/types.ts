import { type McpToolPermissions, type Tool } from '../../../lib/mcpApi';

// Access Point 类型定义
export interface AccessPoint {
  id: string;
  path: string;
  permissions: McpToolPermissions;
}

// 保存结果类型
export interface SaveToolsResult {
  tools: Tool[];
  count: number;
}

