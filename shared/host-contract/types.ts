/**
 * Host × folder identities shared by Main, preload and Renderer.
 *
 * Wire format: `puppyone-cloud/contracts/host-file-protocol-v1.json`
 * (pinned copy: tests/fixtures/cloud/contracts/host-file-protocol-v1.json).
 * A host is where a folder lives: this computer, another of the owner's
 * computers, or (later) a hosted workspace. There is no global machine switch.
 */

export type HostKind = "this-computer" | "my-computer" | "hosted-workspace";

/** Folder capabilities granted by the Cloud. Execution crosses computers only with the host's per-folder consent. */
/** Running things (shell, git, agent) also needs folder.write and the host's own consent. */
export type HostFolderCapability = "folder.read" | "folder.write" | "folder.shell" | "folder.git" | "folder.agent";

export type HostRef = Readonly<{
  kind: HostKind;
  /** Server device id; absent for this computer before it shares anything. */
  deviceId: string | null;
  name: string;
}>;

/** Stable identity of a folder on another computer. Never a path or a connection epoch. */
export type HostFolderRef = Readonly<{
  deployment: string;
  accountId: string;
  deviceId: string;
  folderId: string;
}>;

export type HostSession = Readonly<{ userId: string; generation: string }>;

export type HostCatalogFolder = Readonly<{
  id: string;
  name: string;
  state: "active" | "paused";
  revision: number;
  capabilities: HostFolderCapability[];
}>;

export type HostCatalogDevice = Readonly<{
  id: string;
  name: string;
  platform: "darwin" | "win32" | "linux";
  state: "active" | "paused";
  revision: number;
  online: boolean;
  last_seen_at: string | null;
  /** Protocol version and App version of an online host; null while offline. */
  protocol?: number | null;
  app_version?: string | null;
  folders: HostCatalogFolder[];
}>;

export type HostFileEntry = Readonly<{ name: string; kind: "directory" | "file"; size: number; modified_ns: string }>;

export type HostFileOperation =
  | Readonly<{ action: "list"; path: string }>
  | Readonly<{ action: "read"; path: string }>
  | Readonly<{ action: "write"; path: string; content_base64: string; expected_revision: string | null }>
  | Readonly<{ action: "mkdir" | "remove"; path: string }>
  | Readonly<{ action: "move"; path: string; destination: string }>;

/** IPC result: Electron drops custom Error fields, so failures are values. */
export type HostFolderResult<T> =
  | Readonly<{ ok: true; result: T }>
  | Readonly<{ ok: false; status: number; code: string; outcomeUnknown?: boolean }>;

export type HostFolderEvent =
  | Readonly<{ id: string; type: "change"; paths: string[]; reset: boolean }>
  | Readonly<{ id: string; type: "offline"; code: string }>
  | Readonly<{ id: string; type: "unavailable"; retryable: boolean; code?: string }>;

export type HostSharingStatus = Readonly<{
  /** "outdated": the Cloud no longer serves this App's protocol; update to keep sharing. */
  state: "off" | "connecting" | "online" | "offline" | "outdated";
  deviceId: string | null;
  paused: boolean;
  activeRequests: number;
  watching: number;
  lastAccessAt: string | null;
  folders?: ReadonlyArray<Readonly<{ folderId: string; name: string; writable: boolean;
    execution?: HostExecutionSetting }>>;
  /** Terminals and Agents other computers are running here right now. */
  running?: ReadonlyArray<Readonly<{ session: string; folderId: string; kind: "shell" | "agent"; launcher: string;
    startedAt: string }>>;
}>;

export type HostExecutionSetting = Readonly<{ terminal: boolean; git: boolean; agent: boolean }>;

export type HostLauncher = "shell" | "codex" | "claude" | "cursor" | "opencode" | "pi" | "hermes";

export type HostTerminalEvent =
  | Readonly<{ id: string; type: "started" }>
  | Readonly<{ id: string; type: "output"; data: string }>
  | Readonly<{ id: string; type: "exit"; status: number | null }>
  | Readonly<{ id: string; type: "error"; code: string }>
  | Readonly<{ id: string; type: "closed" }>;

export type RecentHostFolder = Readonly<{
  deployment: string;
  accountId: string;
  deviceId: string;
  folderId: string;
  name: string;
  hostName: string;
  writable: boolean;
  lastOpenedAt: string;
}>;
