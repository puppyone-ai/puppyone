import type {
  AgentActivityEvent,
  AgentActivityOperation,
} from "../../../shared/agent-activity-contract/types";

const PROVIDER_LABELS: Readonly<Record<string, string>> = Object.freeze({
  codex: "Codex",
  claude: "Claude Code",
  cursor: "Cursor Agent CLI",
  opencode: "OpenCode",
  pi: "Pi Agent",
  hermes: "Hermes Agent",
});

export type AgentFilePresenceKind = "reading" | "writing";

export type AgentFilePresenceClaim = Readonly<{
  activityId: string;
  providerId: string;
  providerLabel: string;
  kind: AgentFilePresenceKind;
  phase: AgentActivityEvent["phase"];
  occurredAt: number;
}>;

export type AgentFilePresenceProjection = Readonly<{
  claims: readonly AgentFilePresenceClaim[];
  primary: AgentFilePresenceClaim;
  additionalCount: number;
}>;

export function projectFilePresence(
  events: readonly AgentActivityEvent[],
  workspaceRelativePath: string,
): AgentFilePresenceProjection | null {
  const claims = events.flatMap((event) => event.targets
    .filter((target) => (
      target.confidence === "exact"
      && normalizeWorkspaceRelativePath(target.workspaceRelativePath) === workspaceRelativePath
    ))
    .map(() => ({
      activityId: event.activityId,
      providerId: event.providerId,
      providerLabel: PROVIDER_LABELS[event.providerId] ?? event.providerId,
      kind: operationKind(event.operation),
      phase: event.phase,
      occurredAt: event.occurredAt,
    } as const)))
    .sort(compareClaims);
  if (claims.length === 0) return null;
  return Object.freeze({
    claims: Object.freeze(claims),
    primary: claims[0],
    additionalCount: claims.length - 1,
  });
}

export function toWorkspaceRelativePath(workspaceRoot: string, resourcePath: string) {
  const resourceCandidate = String(resourcePath).replaceAll("\\", "/");
  if (isUri(resourceCandidate)) return null;
  if (!isAbsolutePath(resourceCandidate)) {
    return normalizeWorkspaceRelativePath(resourceCandidate);
  }
  const root = normalizeAbsolutePath(workspaceRoot).replace(/\/$/u, "");
  const resource = normalizeAbsolutePath(resourceCandidate);
  if (!root || resource === root || !resource.startsWith(`${root}/`)) return null;
  return normalizeWorkspaceRelativePath(resource.slice(root.length + 1));
}

export function normalizeWorkspaceRelativePath(value: string) {
  const normalized = String(value).replaceAll("\\", "/").replace(/^\.\//u, "");
  return normalized
    && !isAbsolutePath(normalized)
    && !isUri(normalized)
    && !/(?:^|\/)\.\.(?:\/|$)/u.test(normalized)
    ? normalized
    : null;
}

function operationKind(operation: AgentActivityOperation): AgentFilePresenceKind {
  return operation === "file.read" || operation === "file.search" ? "reading" : "writing";
}

function compareClaims(left: AgentFilePresenceClaim, right: AgentFilePresenceClaim) {
  if (left.kind !== right.kind) return left.kind === "writing" ? -1 : 1;
  if (left.phase !== right.phase) return left.phase === "started" ? -1 : 1;
  return right.occurredAt - left.occurredAt;
}

function normalizeAbsolutePath(value: string) {
  return String(value).replaceAll("\\", "/").replace(/\/{2,}/gu, "/");
}

function isAbsolutePath(value: string) {
  return value.startsWith("/") || /^[A-Za-z]:\//u.test(value);
}

function isUri(value: string) {
  return /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(value);
}
