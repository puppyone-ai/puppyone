'use client';

import React, { useState, useCallback } from 'react';

// --- Types ---

export type AgentType = 'chat' | 'devbox' | 'webhook' | 'schedule';
export type TriggerType = 'manual' | 'cron' | 'webhook';

// 触发配置
export interface TriggerConfig {
  schedule?: string;  // cron 表达式，如 "0 9 * * 1-5"
  timezone?: string;  // 时区，如 "Asia/Shanghai"
  webhook_url?: string;  // webhook URL
  secret?: string;  // webhook secret
}

// 外部配置 (N8N/Zapier)
export interface ExternalConfig {
  n8n_url?: string;
  workflow_id?: string;
  auth?: Record<string, string>;
  [key: string]: unknown;
}

// 资源访问配置
export interface AccessResource {
  nodeId: string;
  nodeName: string;
  nodeType: 'folder' | 'json' | 'file';
  terminal: boolean;
  terminalReadonly: boolean;
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  jsonPath?: string;
}

export interface SavedAgent {
  id: string;
  name: string;
  icon: string;
  type: AgentType;
  capabilities: string[]; // Saved capability IDs (legacy)
  resources?: AccessResource[]; // 新：资源访问配置
  mcp_api_key?: string; // MCP API key for external access
  
  // Schedule Agent 新字段
  trigger_type?: TriggerType;
  trigger_config?: TriggerConfig;
  task_content?: string;
  task_node_id?: string;
  external_config?: ExternalConfig;
}

// 模拟简单的图标选择
const SERVICE_ICONS = ['⚡', '🧹', '📊', '🔍', '🚀', '🤖', '📝', '🎨'];

// --- Dock Item Component ---
// This file is kept only for type exports and constants to avoid breaking imports in other files
// The actual UI component logic has been moved to ProjectsHeader.tsx or is deprecated.

export { SERVICE_ICONS };

