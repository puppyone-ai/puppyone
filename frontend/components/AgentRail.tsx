'use client';

import React, { useState, useCallback } from 'react';

// --- Types ---

export type AgentType = 'chat' | 'devbox' | 'webhook';

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
}

// 模拟简单的图标选择
const SERVICE_ICONS = ['⚡', '🧹', '📊', '🔍', '🚀', '🤖', '📝', '🎨'];

// --- Dock Item Component ---
// This file is kept only for type exports and constants to avoid breaking imports in other files
// The actual UI component logic has been moved to ProjectsHeader.tsx or is deprecated.

export { SERVICE_ICONS };

