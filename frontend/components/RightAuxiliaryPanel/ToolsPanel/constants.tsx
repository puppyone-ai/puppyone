import React from 'react';
import { type McpToolType } from '../../../lib/mcpApi';

// Theme Color - Consistent Orange
export const ACCENT_COLOR = '#f97316'; // Orange-500

// Define Tool Groups
// NOTE: shell_access is NOT a Tool - it's managed via agent_bash table per Agent
export const READ_TOOLS = [
  'query_data',
  'search',
  'get_all_data',
] as McpToolType[];
export const WRITE_TOOLS = ['create', 'update', 'delete'] as McpToolType[];
export const ALL_TOOLS = [
  ...READ_TOOLS,
  ...WRITE_TOOLS,
  'custom_script',
] as McpToolType[];

// Tool Config Map for display
export const TOOL_CONFIG: Record<string, { label: string; short: string }> = {
  get_data_schema: { label: 'Get Schema', short: 'Schema' },
  query_data: { label: 'Query Data', short: 'Query' },
  search: { label: 'Semantic Search', short: 'Search' },
  get_all_data: { label: 'Get All Data', short: 'Get All' },
  create: { label: 'Create Row', short: 'Create' },
  update: { label: 'Update Row', short: 'Update' },
  delete: { label: 'Delete Row', short: 'Delete' },
  custom_script: { label: 'Custom Script', short: 'Script' },
};

// Bash Icon - shared across components
export const BashIcon = ({
  size = 12,
}: {
  size?: number;
}): React.JSX.Element => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='2'
    strokeLinecap='round'
    strokeLinejoin='round'
  >
    <polyline points='4 17 10 11 4 5' />
    <line x1='12' y1='19' x2='20' y2='19' />
  </svg>
);

// Default Tool Icon
export const DefaultToolIcon = ({
  size = 12,
}: {
  size?: number;
}): React.JSX.Element => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 24 24'
    fill='none'
    stroke='currentColor'
    strokeWidth='2'
  >
    <rect x='3' y='3' width='18' height='18' rx='2' />
  </svg>
);


