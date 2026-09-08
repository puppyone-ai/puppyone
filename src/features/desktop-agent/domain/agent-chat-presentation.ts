/** Feature-owned presentation projected into the shared Workbench Item. */
export type AgentChatTabPresentation = {
  title: string;
  runtimeLabel: string | null;
  runtimeIconKey: string | null;
  sessionId: string | null;
  statusCode: string;
  running: boolean;
};
