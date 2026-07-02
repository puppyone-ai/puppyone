export type CloudWorkspaceBindingState =
  | { status: "unmapped" }
  | { status: "resolving"; remoteUrl: string }
  | { status: "mapped"; projectId: string }
  | { status: "remote-only"; remoteUrl: string }
  | { status: "error"; message: string };
