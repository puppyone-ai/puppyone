import { Check, Minus } from "lucide-react";
import { useLocalization } from "@puppyone/localization/react";
import type { DesktopCloudMcpEndpoint, DesktopCloudRepositoryView } from "../../../../lib/cloudApi";

type DesktopPermissionCommandKind = "read" | "write";
type DesktopPermissionSpec = {
  key: string;
  kind: DesktopPermissionCommandKind;
  defaultAllowed: boolean;
};
export type DesktopPermissionGroup = {
  titleId: string;
  specs: readonly DesktopPermissionSpec[];
  muted?: boolean;
  danger?: boolean;
};

export const CLI_PERMISSION_CONFIG_KEY = "command_permissions";
const CLI_COMMAND_SPECS: readonly DesktopPermissionSpec[] = [
  { key: "ls", kind: "read", defaultAllowed: true },
  { key: "tree", kind: "read", defaultAllowed: true },
  { key: "find", kind: "read", defaultAllowed: true },
  { key: "grep", kind: "read", defaultAllowed: true },
  { key: "stat", kind: "read", defaultAllowed: true },
  { key: "cat", kind: "read", defaultAllowed: true },
  { key: "head", kind: "read", defaultAllowed: true },
  { key: "tail", kind: "read", defaultAllowed: true },
  { key: "download", kind: "read", defaultAllowed: true },
  { key: "write", kind: "write", defaultAllowed: true },
  { key: "mkdir", kind: "write", defaultAllowed: true },
  { key: "touch", kind: "write", defaultAllowed: true },
  { key: "upload", kind: "write", defaultAllowed: true },
  { key: "cp", kind: "write", defaultAllowed: true },
  { key: "mv", kind: "write", defaultAllowed: true },
  { key: "rm", kind: "write", defaultAllowed: false },
  { key: "rmdir", kind: "write", defaultAllowed: false },
];
const CLI_COMMAND_ORDER = new Map(CLI_COMMAND_SPECS.map((command, index) => [command.key, index]));
export const CLI_VALID_COMMANDS = new Set(CLI_COMMAND_SPECS.map((command) => command.key));
const CLI_DEFAULT_ALLOWED = CLI_COMMAND_SPECS
  .filter((command) => command.defaultAllowed)
  .map((command) => command.key);

const MCP_TOOL_SPECS: readonly DesktopPermissionSpec[] = [
  { key: "fs_semantics", kind: "read", defaultAllowed: true },
  { key: "fs_ls", kind: "read", defaultAllowed: true },
  { key: "fs_tree", kind: "read", defaultAllowed: true },
  { key: "fs_find", kind: "read", defaultAllowed: true },
  { key: "fs_grep", kind: "read", defaultAllowed: true },
  { key: "fs_cat", kind: "read", defaultAllowed: true },
  { key: "fs_head", kind: "read", defaultAllowed: true },
  { key: "fs_tail", kind: "read", defaultAllowed: true },
  { key: "fs_stat", kind: "read", defaultAllowed: true },
  { key: "fs_write", kind: "write", defaultAllowed: true },
  { key: "fs_mkdir", kind: "write", defaultAllowed: true },
  { key: "fs_touch", kind: "write", defaultAllowed: true },
  { key: "fs_cp", kind: "write", defaultAllowed: true },
  { key: "fs_mv", kind: "write", defaultAllowed: true },
  { key: "fs_rmdir", kind: "write", defaultAllowed: false },
  { key: "fs_rm", kind: "write", defaultAllowed: false },
];
const MCP_TOOL_ORDER = new Map(MCP_TOOL_SPECS.map((tool, index) => [tool.key, index]));
const MCP_VALID_TOOLS = new Set(MCP_TOOL_SPECS.map((tool) => tool.key));
const MCP_DEFAULT_ALLOWED = MCP_TOOL_SPECS
  .filter((tool) => tool.defaultAllowed)
  .map((tool) => tool.key);

export function DesktopCloudPermissionPanel({
  title,
  groups,
  allowedKeys,
  pending,
  error,
  canUpdate,
  unavailableLabel,
  footer,
  onUpdate,
}: {
  title: string;
  groups: readonly DesktopPermissionGroup[];
  allowedKeys: ReadonlySet<string>;
  pending: boolean;
  error: string | null;
  canUpdate: boolean;
  unavailableLabel: string;
  footer?: string;
  onUpdate: (nextAllowedKeys: ReadonlySet<string>) => Promise<void>;
}) {
  const handleGroupToggle = (group: DesktopPermissionGroup, nextChecked: boolean) => {
    if (!canUpdate || pending || group.muted) return;
    const next = new Set(allowedKeys);
    group.specs.forEach((command) => {
      if (nextChecked) next.add(command.key);
      else next.delete(command.key);
    });
    void onUpdate(next);
  };
  const handleCommandToggle = (command: DesktopPermissionSpec, nextChecked: boolean, group: DesktopPermissionGroup) => {
    if (!canUpdate || pending || group.muted) return;
    const next = new Set(allowedKeys);
    if (nextChecked) next.add(command.key);
    else next.delete(command.key);
    void onUpdate(next);
  };

  return (
    <div className="desktop-cloud-access-permission-body">
      <div className="desktop-cloud-access-permission-label">{title}</div>
      <div className="desktop-cloud-access-permission-panel">
        {groups.map((group, index) => (
          <DesktopCloudPermissionGroupRow
            key={group.titleId}
            group={group}
            allowedKeys={allowedKeys}
            disabled={!canUpdate || pending}
            isFirst={index === 0}
            onToggleAll={handleGroupToggle}
            onToggleCommand={handleCommandToggle}
          />
        ))}
      </div>
      {!canUpdate && (
        <div className="desktop-cloud-access-permission-help">{unavailableLabel}</div>
      )}
      {error && (
        <div className="desktop-cloud-access-permission-error">{error}</div>
      )}
      {footer && (
        <div className="desktop-cloud-access-permission-help">{footer}</div>
      )}
    </div>
  );
}

export function getDesktopCliPermissionGroups(scope: DesktopCloudRepositoryView): DesktopPermissionGroup[] {
  const readCommands = CLI_COMMAND_SPECS.filter((command) => command.kind === "read");
  const modifyCommands = CLI_COMMAND_SPECS.filter((command) => command.kind === "write" && command.defaultAllowed);
  const deleteCommands = CLI_COMMAND_SPECS.filter((command) => command.kind === "write" && !command.defaultAllowed);
  const scopeReadOnly = scope.max_mode === "r";
  return [
    { titleId: "cloud.access.permissions.readFiles", specs: readCommands },
    { titleId: "cloud.access.permissions.modifyFiles", specs: modifyCommands, muted: scopeReadOnly },
    { titleId: "cloud.access.permissions.deleteFiles", specs: deleteCommands, muted: scopeReadOnly, danger: true },
  ];
}

export function getDesktopMcpPermissionGroups(writable: boolean): DesktopPermissionGroup[] {
  const readTools = MCP_TOOL_SPECS.filter((tool) => tool.kind === "read");
  const writeTools = MCP_TOOL_SPECS.filter((tool) => tool.kind === "write" && tool.defaultAllowed);
  const deleteTools = MCP_TOOL_SPECS.filter((tool) => tool.kind === "write" && !tool.defaultAllowed);
  return [
    { titleId: "cloud.access.permissions.readTools", specs: readTools },
    { titleId: "cloud.access.permissions.writeTools", specs: writeTools, muted: !writable },
    { titleId: "cloud.access.permissions.deleteTools", specs: deleteTools, muted: !writable, danger: true },
  ];
}

export function parseCliCommandPermissions(config: Record<string, unknown> | undefined): ReadonlySet<string> {
  const raw = config?.[CLI_PERMISSION_CONFIG_KEY];
  if (!isPlainRecord(raw)) return new Set(CLI_DEFAULT_ALLOWED);
  const allowed = readCommandArray(raw.allowed) ?? readCommandArray(raw.allowed_commands);
  if (allowed) return new Set(allowed);
  if (isPlainRecord(raw.commands)) {
    const commandMap = raw.commands;
    return new Set(
      CLI_COMMAND_SPECS
        .filter((command) => commandMap[command.key] === true)
        .map((command) => command.key),
    );
  }
  if (isPlainRecord(raw.groups)) return parseLegacyCliGroups(raw.groups);
  return new Set(CLI_DEFAULT_ALLOWED);
}

export function sortCliCommands(a: string, b: string): number {
  return (CLI_COMMAND_ORDER.get(a) ?? 999) - (CLI_COMMAND_ORDER.get(b) ?? 999);
}

export function parseMcpToolPermissions(raw: unknown): ReadonlySet<string> {
  const legacyList = parseLegacyMcpToolList(raw);
  if (legacyList) return legacyList;
  if (!isPlainRecord(raw)) return new Set(MCP_DEFAULT_ALLOWED);
  const fsConfig = isPlainRecord(raw.filesystem)
    ? raw.filesystem
    : isPlainRecord(raw.fs)
      ? raw.fs
      : raw;
  const allowed = readMcpToolArray(fsConfig.allowed)
    ?? readMcpToolArray(fsConfig.allowed_tools)
    ?? readMcpToolArray(fsConfig.tools_allowed);
  if (allowed) return new Set(allowed);
  if (isPlainRecord(fsConfig.tools)) {
    const toolMap = fsConfig.tools;
    return new Set(
      MCP_TOOL_SPECS
        .filter((tool) => toolMap[tool.key] === true)
        .map((tool) => tool.key),
    );
  }
  if (isPlainRecord(fsConfig.groups)) return parseMcpGroups(fsConfig.groups);
  if ("read" in fsConfig || "write" in fsConfig || "delete" in fsConfig) return parseMcpGroups(fsConfig);
  return new Set(MCP_DEFAULT_ALLOWED);
}

export function buildMcpToolsConfig(raw: unknown, allowedTools: ReadonlySet<string>) {
  const customTools = readMcpCustomTools(raw);
  return {
    version: 1,
    filesystem: {
      allowed: Array.from(allowedTools)
        .filter((tool) => MCP_VALID_TOOLS.has(tool))
        .sort(sortMcpTools),
    },
    shell: { enabled: false },
    ...(customTools.length > 0 ? { custom_tools: customTools } : {}),
  };
}

export function getDesktopMcpWritable(endpoint: DesktopCloudMcpEndpoint | undefined, scope: DesktopCloudRepositoryView): boolean {
  if (scope.max_mode !== "rw") return false;
  const accesses = endpoint?.accesses ?? [];
  if (accesses.length === 0) return true;
  return accesses.some((access) => access.readonly === false);
}

function DesktopCloudPermissionGroupRow({
  group,
  allowedKeys,
  disabled,
  isFirst,
  onToggleAll,
  onToggleCommand,
}: {
  group: DesktopPermissionGroup;
  allowedKeys: ReadonlySet<string>;
  disabled: boolean;
  isFirst: boolean;
  onToggleAll: (group: DesktopPermissionGroup, nextChecked: boolean) => void;
  onToggleCommand: (command: DesktopPermissionSpec, nextChecked: boolean, group: DesktopPermissionGroup) => void;
}) {
  const { t } = useLocalization();
  const allowedCount = group.muted ? 0 : group.specs.filter((command) => allowedKeys.has(command.key)).length;
  const groupEnabled = !group.muted && group.specs.every((command) => allowedKeys.has(command.key));
  const anyEnabled = allowedCount > 0;
  const statusLabel = groupEnabled
    ? t("cloud.access.permissions.allowed")
    : allowedCount > 0
      ? t("cloud.access.permissions.allowedRatio", { allowed: allowedCount, total: group.specs.length })
      : t("cloud.status.off");
  const metaLabel = group.muted
    ? t("cloud.access.permissions.blockedByScope")
    : t("cloud.access.permissions.groupMeta", { status: statusLabel, count: group.specs.length });
  return (
    <div className={`desktop-cloud-access-permission-group ${isFirst ? "first" : ""} ${group.muted ? "muted" : ""}`}>
      <div className="desktop-cloud-access-permission-group-header">
        <div className="desktop-cloud-access-permission-group-title">
          <span>{t(group.titleId)}</span>
          <em>{metaLabel}</em>
        </div>
        <button
          className="desktop-cloud-access-permission-toggle"
          type="button"
          disabled={disabled || group.muted}
          aria-pressed={groupEnabled}
          onClick={() => onToggleAll(group, !anyEnabled)}
        >
          <span className={`desktop-cloud-access-permission-check ${groupEnabled ? "checked" : anyEnabled ? "partial" : ""}`} aria-hidden="true">
            {groupEnabled ? <Check size={9} /> : anyEnabled ? <Minus size={9} /> : null}
          </span>
          <span>{t("cloud.common.all")}</span>
        </button>
      </div>
      <div className="desktop-cloud-access-permission-pill-row">
        {group.specs.map((command) => {
          const enabled = !group.muted && allowedKeys.has(command.key);
          return (
            <button
              className={`desktop-cloud-access-permission-pill ${enabled ? "enabled" : ""} ${group.danger ? "danger" : ""}`}
              key={command.key}
              type="button"
              data-tooltip={command.key}
              aria-pressed={enabled}
              disabled={disabled || group.muted}
              onClick={() => onToggleCommand(command, !enabled, group)}
            >
              <span className={`desktop-cloud-access-permission-pill-check ${enabled ? "checked" : ""}`} aria-hidden="true">
                {enabled ? <Check size={9} /> : null}
              </span>
              <span>{command.key}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function parseLegacyCliGroups(groups: Record<string, unknown>): ReadonlySet<string> {
  const allowed = new Set<string>();
  const addByKind = (kind: DesktopPermissionCommandKind) => {
    CLI_COMMAND_SPECS.filter((command) => command.kind === kind).forEach((command) => allowed.add(command.key));
  };
  if (groups.read !== false) addByKind("read");
  if (groups.write === true) ["write", "mkdir", "touch", "upload"].forEach((command) => allowed.add(command));
  if (groups.move === true) ["cp", "mv"].forEach((command) => allowed.add(command));
  if (groups.delete === true) ["rm", "rmdir"].forEach((command) => allowed.add(command));
  return allowed;
}

function readCommandArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === "string" && CLI_VALID_COMMANDS.has(item));
}

function parseLegacyMcpToolList(value: unknown): ReadonlySet<string> | null {
  if (!Array.isArray(value)) return null;
  let found = false;
  const allowed = new Set<string>();
  value.forEach((item) => {
    if (!isPlainRecord(item)) return;
    const name = item.name ?? item.tool_name;
    if (typeof name !== "string" || !MCP_VALID_TOOLS.has(name)) return;
    found = true;
    if (item.enabled !== false) allowed.add(name);
  });
  return found ? allowed : null;
}

function parseMcpGroups(groups: Record<string, unknown>): ReadonlySet<string> {
  const allowed = new Set<string>();
  const addTools = (tools: readonly DesktopPermissionSpec[]) => {
    tools.forEach((tool) => allowed.add(tool.key));
  };
  if (groups.read !== false) addTools(MCP_TOOL_SPECS.filter((tool) => tool.kind === "read"));
  if (groups.write !== false) addTools(MCP_TOOL_SPECS.filter((tool) => tool.kind === "write" && tool.defaultAllowed));
  if (groups.delete === true) addTools(MCP_TOOL_SPECS.filter((tool) => tool.kind === "write" && !tool.defaultAllowed));
  return allowed;
}

function readMcpToolArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === "string" && MCP_VALID_TOOLS.has(item));
}

function readMcpCustomTools(value: unknown): Array<{ tool_id: string; enabled?: boolean }> {
  const read = (items: unknown): Array<{ tool_id: string; enabled?: boolean }> => {
    if (!Array.isArray(items)) return [];
    return items
      .filter((item): item is Record<string, unknown> => isPlainRecord(item) && typeof item.tool_id === "string")
      .map((item) => ({
        tool_id: item.tool_id as string,
        ...(typeof item.enabled === "boolean" ? { enabled: item.enabled } : {}),
      }));
  };
  if (Array.isArray(value)) return read(value);
  if (!isPlainRecord(value)) return [];
  return read(value.custom_tools).concat(read(value.bound_tools), read(value.external_tools));
}

function sortMcpTools(a: string, b: string): number {
  return (MCP_TOOL_ORDER.get(a) ?? 999) - (MCP_TOOL_ORDER.get(b) ?? 999);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
