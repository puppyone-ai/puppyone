import type {
  WorkflowConfigField,
  WorkflowConnection,
  WorkflowProviderSpec,
  WorkflowStatusItem,
} from '@/lib/workflowApi';

export type BusyAction = 'refresh' | 'pause' | 'resume' | 'delete' | null;
export type DetailMode = 'new' | 'detail';
export type TriggerMode = 'manual' | 'scheduled';

export interface TriggerDraft {
  mode: TriggerMode;
  schedule: string;
  timezone: string;
}

export interface RecentRun {
  id: string;
  time: string;
  result: string;
  items: string;
  target: string;
  duration: string;
}

export function normalizeDefaultValue(field: WorkflowConfigField): string {
  if (field.default === null || field.default === undefined) return '';
  return String(field.default);
}

export function defaultConfigForProvider(provider: WorkflowProviderSpec | undefined): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of provider?.config_fields ?? []) {
    values[field.key] = normalizeDefaultValue(field);
  }
  return values;
}

export function cleanConfig(values: Record<string, string>): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value.trim() === '') continue;
    config[key] = value;
  }
  return config;
}

export function providerName(provider: WorkflowProviderSpec | undefined, fallback: string): string {
  return provider?.display_name || fallback.replaceAll('_', ' ');
}

export function workflowName(
  connection: WorkflowConnection | undefined,
  provider: WorkflowProviderSpec | undefined,
): string {
  if (!connection) return 'New workflow';
  const configuredName = connection.config?.name;
  if (typeof configuredName === 'string' && configuredName.trim()) return configuredName;
  const source = providerName(provider, connection.provider);
  const target = connection.path ? connection.path.split('/').filter(Boolean).pop() : 'Project root';
  return `${source} to ${target || 'Project root'}`;
}

export function targetDefault(provider: WorkflowProviderSpec | undefined): string {
  const name = provider?.display_name || provider?.provider || 'Workflow';
  return name.replace(/[<>:"|?*]/g, '-');
}

export function formatDate(value?: string | null): string {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function dataPath(projectId: string, path?: string | null): string {
  if (!path) return `/projects/${projectId}/data`;
  const encoded = path.split('/').filter(Boolean).map(encodeURIComponent).join('/');
  return `/projects/${projectId}/data/${encoded}`;
}

export function configString(config: Record<string, unknown> | undefined, key: string, fallback: string): string {
  const value = config?.[key];
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number') return String(value);
  return fallback;
}

export function nestedConfigString(
  config: Record<string, unknown> | undefined,
  parent: string,
  key: string,
  fallback: string,
): string {
  const nested = config?.[parent];
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) return fallback;
  const value = (nested as Record<string, unknown>)[key];
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number') return String(value);
  return fallback;
}

export function labelize(value: string): string {
  return value.replaceAll('_', ' ');
}

export function triggerFromStatus(status?: WorkflowStatusItem): TriggerDraft {
  const trigger = status?.trigger ?? {};
  const type = typeof trigger.type === 'string' ? trigger.type : 'manual';
  const schedule = typeof trigger.schedule === 'string' ? trigger.schedule : '0 9 * * *';
  const timezone = typeof trigger.timezone === 'string' ? trigger.timezone : 'UTC';
  return {
    mode: type === 'scheduled' ? 'scheduled' : 'manual',
    schedule,
    timezone,
  };
}

export function triggerLabel(mode: TriggerMode, schedule: string): string {
  if (mode === 'scheduled') return schedule.trim() || 'Scheduled';
  return 'Manual';
}

export function providerOAuthKey(provider?: WorkflowProviderSpec): string | undefined {
  return provider?.oauth_ui_type || provider?.oauth_type || provider?.provider;
}
