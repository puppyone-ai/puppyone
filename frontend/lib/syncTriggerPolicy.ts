export type SyncModeType = 'import_once' | 'manual' | 'scheduled' | 'realtime';

export const SYNC_MODE_META: Record<SyncModeType, { label: string; desc: string }> = {
  import_once: { label: 'Import once', desc: 'Pull data once and stop' },
  manual: { label: 'Manual', desc: 'Sync on demand' },
  scheduled: { label: 'Scheduled', desc: 'Sync on a recurring schedule' },
  realtime: { label: 'Real-time', desc: 'Sync continuously as changes happen' },
};

interface TriggerPolicy {
  supportedModes: SyncModeType[];
  defaultMode: SyncModeType;
}

const PROVIDER_POLICIES: Record<string, TriggerPolicy> = {
  filesystem: {
    supportedModes: ['realtime'],
    defaultMode: 'realtime',
  },
  gmail: {
    supportedModes: ['import_once', 'manual', 'scheduled'],
    defaultMode: 'import_once',
  },
  google_calendar: {
    supportedModes: ['import_once', 'manual', 'scheduled'],
    defaultMode: 'import_once',
  },
  google_sheets: {
    supportedModes: ['import_once', 'manual', 'scheduled'],
    defaultMode: 'import_once',
  },
  google_docs: {
    supportedModes: ['import_once', 'manual', 'scheduled'],
    defaultMode: 'import_once',
  },
  github: {
    supportedModes: ['import_once', 'manual', 'scheduled'],
    defaultMode: 'import_once',
  },
  url: {
    supportedModes: ['import_once', 'manual', 'scheduled'],
    defaultMode: 'import_once',
  },
  google_drive: {
    supportedModes: ['import_once', 'manual', 'scheduled'],
    defaultMode: 'manual',
  },
  google_search_console: {
    supportedModes: ['manual', 'scheduled'],
    defaultMode: 'scheduled',
  },
};

const DEFAULT_POLICY: TriggerPolicy = {
  supportedModes: ['manual'],
  defaultMode: 'manual',
};

export function getSyncTriggerPolicy(provider: string): TriggerPolicy {
  return PROVIDER_POLICIES[provider] || DEFAULT_POLICY;
}

const PROVIDER_DISPLAY_LABELS: Record<string, string> = {
  filesystem: 'Desktop Folder',
  gmail: 'Gmail',
  google_calendar: 'Google Calendar',
  google_sheets: 'Google Sheets',
  google_docs: 'Google Docs',
  github: 'GitHub',
  url: 'Web Page',
  google_drive: 'Google Drive',
  google_search_console: 'Google Search Console',
  agent: 'Agent',
  mcp: 'MCP Server',
  sandbox: 'Sandbox',
};

export function getProviderDisplayLabel(provider: string): string {
  return PROVIDER_DISPLAY_LABELS[provider] || provider;
}
