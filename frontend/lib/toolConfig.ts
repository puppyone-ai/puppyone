export const FONT = {
  primary: 13,
  secondary: 12,
  tertiary: 11,
};

export const TOOL_TYPE_CONFIG: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  get_data_schema: {
    label: 'Schema',
    color: '#67e8f9',
    bg: 'rgba(6, 182, 212, 0.15)',
  },
  query_data: {
    label: 'Query',
    color: '#60a5fa',
    bg: 'rgba(59, 130, 246, 0.15)',
  },
  search: {
    label: 'Search',
    color: '#22d3ee',
    bg: 'rgba(34, 211, 238, 0.15)',
  },
  get_all_data: {
    label: 'Get All',
    color: '#60a5fa',
    bg: 'rgba(59, 130, 246, 0.15)',
  },
  preview: {
    label: 'Preview',
    color: '#a78bfa',
    bg: 'rgba(139, 92, 246, 0.15)',
  },
  select: { label: 'Select', color: '#a78bfa', bg: 'rgba(139, 92, 246, 0.15)' },
  create: { label: 'Create', color: '#34d399', bg: 'rgba(16, 185, 129, 0.15)' },
  update: { label: 'Update', color: '#fbbf24', bg: 'rgba(245, 158, 11, 0.15)' },
  delete: { label: 'Delete', color: '#f87171', bg: 'rgba(239, 68, 68, 0.15)' },
};
