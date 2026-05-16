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
    color: 'var(--po-info)',
    bg: 'color-mix(in srgb, var(--po-info) 15%, transparent)',
  },
  query_data: {
    label: 'Query',
    color: 'var(--po-accent-text)',
    bg: 'color-mix(in srgb, var(--po-accent) 15%, transparent)',
  },
  search: {
    label: 'Search',
    color: 'var(--po-info)',
    bg: 'color-mix(in srgb, var(--po-info) 15%, transparent)',
  },
  get_all_data: {
    label: 'Get All',
    color: 'var(--po-accent-text)',
    bg: 'color-mix(in srgb, var(--po-accent) 15%, transparent)',
  },
  preview: {
    label: 'Preview',
    color: 'var(--po-file-accent-audio)',
    bg: 'color-mix(in srgb, var(--po-file-accent-audio) 15%, transparent)',
  },
  select: { label: 'Select', color: 'var(--po-file-accent-audio)', bg: 'color-mix(in srgb, var(--po-file-accent-audio) 15%, transparent)' },
  create: { label: 'Create', color: 'var(--po-success)', bg: 'color-mix(in srgb, var(--po-success) 15%, transparent)' },
  update: { label: 'Update', color: 'var(--po-warning)', bg: 'color-mix(in srgb, var(--po-warning) 15%, transparent)' },
  delete: { label: 'Delete', color: 'var(--po-danger)', bg: 'color-mix(in srgb, var(--po-danger) 15%, transparent)' },
};
