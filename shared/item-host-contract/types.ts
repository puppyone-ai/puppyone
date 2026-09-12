import type { ProjectSessionContext } from "../project-session-contract/types";
import type { AgentDraftReference, AgentPromptReferenceMention } from "../agent-contract/user-message-types";

export type ItemHostKind = "terminal" | "agent";
export type ItemHostAppearance = Readonly<{
  dark: boolean;
  direction: "ltr" | "rtl";
  attributes: Record<string, string>;
  variables: Record<string, string>;
}>;
export type ItemHostIdentity = Readonly<{ itemId: string; kind: ItemHostKind; projectContext: ProjectSessionContext }>;
export type ItemHostPresentationIdentity = Readonly<{ generation: string; presentationId: number }>;
export type ItemHostFocus = Readonly<{ presentationId: number; sequence: number; focused: boolean; activate: boolean }>;
export type ItemHostGeometry = Readonly<{
  bounds: { x: number; y: number; width: number; height: number };
  revision: number;
  visible: boolean;
}>;
export type ItemHostConfiguration = Readonly<{
  appearance?: ItemHostAppearance;
  settings?: Record<string, unknown>;
  presented?: boolean;
  commandTarget?: boolean;
}>;
export type ItemHostDraft = Readonly<{ revision: number; text: string; references?: AgentDraftReference[];
  mentions?: AgentPromptReferenceMention[]; referenceEpoch?: string }>;
export type ItemHostBootstrap = ItemHostIdentity & ItemHostConfiguration & Readonly<{
  generation: string;
  recipeId?: string | null;
  historyTarget?: { sessionId: string; runtimeId: string } | null;
  session?: { sessionId: string; instanceId: string; runtimeId: string; root: string } | null;
  draft?: ItemHostDraft | null;
}>;
export type ItemHostState = Readonly<{
  itemId: string;
  generation: string;
  display: "starting" | "ready" | "unresponsive" | "crashed" | "closed";
  execution: "idle" | "ready" | "interrupted";
  message?: string;
  processId?: number | null;
}>;
export type ItemHostEvent = Readonly<{ itemId: string; generation: string; type: string; payload: unknown }>;
export type ItemHostBridge = Readonly<{
  create(request: ItemHostIdentity & ItemHostConfiguration & { recipeId?: string | null; historyTarget?: { sessionId: string; runtimeId: string } | null }): Promise<ItemHostState>;
  configure(request: ItemHostIdentity & ItemHostPresentationIdentity & ItemHostConfiguration): Promise<void>;
  setGeometry(request: ItemHostIdentity & ItemHostPresentationIdentity & ItemHostGeometry): void;
  focus(request: ItemHostIdentity & ItemHostPresentationIdentity): void;
  close(request: ItemHostIdentity): Promise<void>;
  recover(request: ItemHostIdentity): Promise<ItemHostState>;
  onState(listener: (state: ItemHostState) => void): () => void;
  onEvent(listener: (event: ItemHostEvent) => void): () => void;
  respond(request: { itemId: string; requestId: string; value?: unknown; error?: string }): void;
}>;
export type ItemRendererBridge = Readonly<{
  bootstrap(): Promise<ItemHostBootstrap>;
  ready(): Promise<void>;
  publish(type: string, payload: unknown): void;
  request(type: string, payload: unknown): Promise<unknown>;
  onConfiguration(listener: (configuration: ItemHostConfiguration) => void): () => void;
  connectTerminal(): Promise<unknown>;
  connectAgent(request: { sessionId: string; instanceId: string }): Promise<{ connection: string; hostGeneration: string }>;
  saveDraft(request: ItemHostDraft): Promise<{ revision: number }>;
}>;
