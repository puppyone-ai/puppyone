/**
 * Domain constants for the access page.
 *
 * Provider display names, status colour map, status label map, and
 * the connector-group taxonomy used by the right-pane tab strip. All
 * pulled out of `page.tsx` so a new provider type or status change
 * is a one-file edit.
 */

export const PROVIDER_LABELS: Record<string, string> = {
  cli: 'Puppyone CLI',
  agent: 'AI Agent',
  filesystem: 'Git Remote',
  gmail: 'Gmail',
  google_sheets: 'Google Sheets',
  google_calendar: 'Google Calendar',
  google_docs: 'Google Docs',
  google_drive: 'Google Drive',
  github: 'GitHub',
  notion: 'Notion',
  linear: 'Linear',
  airtable: 'Airtable',
  url: 'Web Page',
  rss: 'RSS Feed',
  rest_api: 'REST API',
  supabase: 'Supabase',
  mcp: 'MCP Server',
  sandbox: 'Sandbox',
  hackernews: 'Hacker News',
  posthog: 'PostHog',
  google_search_console: 'Google Search Console',
  script: 'Custom Script',
};

export const STATUS_COLORS: Record<string, string> = {
  active: 'var(--po-success)',
  syncing: 'var(--po-accent)',
  error: 'var(--po-danger)',
  paused: 'var(--po-warning)',
  pending: 'var(--po-text-subtle)',
};

export const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  syncing: 'Syncing',
  error: 'Error',
  paused: 'Paused',
  pending: 'Pending',
};

// The previous version exposed an `APGroupKey` ("cli/agent/mcp/sandbox/
// integration") that drove a sidebar filter-tab strip — sliced the
// access points by *provider type*. That was the wrong axis: scope
// (the mount point a connector binds to) is the actual primary key
// in our data model, and the user wants to manage "who can see
// /docs?" not "where do my CLIs live?". The sidebar is now scope-keyed,
// and provider type is shown only on each connector row inside the
// detail panel as a small type-line. No filter tabs survive.

// Within the right pane, every AP bound to the selected scope is
// rendered as a card. We group those cards by provider type so each
// access point reads as a first-class entity in the switcher chip.
//
// CLI, Agent, and Folder-sync (MUT protocol) are the three "built-in"
// connection methods that get auto-created per scope by a DB trigger
// (see migrations/…_connectors_table.sql + …_filesystem_builtin_connector.sql).
// MCP / Sandbox / Third-party are user-created.

export const CONNECTOR_GROUP_LABELS: Record<ConnectorGroupKey, string> = {
  cli: 'Puppyone CLI',
  agent: 'Agent',
  filesystem: 'Git Remote',
  mcp: 'MCP server',
  sandbox: 'Sandbox',
  integration: 'Third-party',
};

export const CONNECTOR_GROUP_ORDER: readonly ConnectorGroupKey[] = ['cli', 'agent', 'filesystem', 'mcp', 'sandbox', 'integration'] as const;

export type ConnectorGroupKey = 'cli' | 'agent' | 'filesystem' | 'mcp' | 'sandbox' | 'integration';
