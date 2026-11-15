export type LocalComputerStatus =
  | "running"
  | "asleep"
  | "provisioning"
  | "stopped"
  | "error";

export type LocalComputerEngine = "lima" | "managed";

export type LocalComputerRuntimeInfo = Readonly<{
  available: boolean;
  engine: LocalComputerEngine;
  limactlPath: string | null;
  architecture: string;
  platform: string;
}>;

export type LocalComputerRecord = Readonly<{
  id: string;
  name: string;
  workspacePath: string;
  instanceName: string;
  engine: LocalComputerEngine;
  status: LocalComputerStatus;
  desktopReady: boolean;
  vncPort: number | null;
  statusDetail: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type LocalComputerSnapshot = Readonly<{
  experimentalEnabled: boolean;
  runtime: LocalComputerRuntimeInfo;
  computers: readonly LocalComputerRecord[];
}>;

export type LocalComputerScreenSession = Readonly<{
  transport: "vnc-ws" | "managed-preview";
  url: string;
  protocols?: string[];
  width: number;
  height: number;
}>;

export type LocalComputerRegisterRequest = Readonly<{
  workspacePath: string;
  name?: string;
  startNow?: boolean;
}>;

export type LocalComputersBridge = Readonly<{
  getSnapshot: () => Promise<LocalComputerSnapshot>;
  setExperimentalOptIn: (request: { enabled: boolean }) => Promise<LocalComputerSnapshot>;
  register: (request: LocalComputerRegisterRequest) => Promise<LocalComputerSnapshot>;
  wake: (request: { id: string }) => Promise<LocalComputerSnapshot>;
  sleep: (request: { id: string }) => Promise<LocalComputerSnapshot>;
  provisionDesktop: (request: { id: string }) => Promise<LocalComputerSnapshot>;
  remove: (request: { id: string }) => Promise<LocalComputerSnapshot>;
  connectScreen: (request: { id: string }) => Promise<LocalComputerScreenSession>;
  onChanged: (callback: (snapshot: LocalComputerSnapshot) => void) => () => void;
}>;
