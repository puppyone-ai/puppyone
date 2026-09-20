// Activation is installation, not account, model, or protocol readiness.
export type ActivationStatus = "preparing" | "installing" | "setup-required" | "verifying" | "ready" | "cancelling" | "cancelled" | "failed" | "interrupted";
export type ActivationStep = { id: "prepare" | "install" | "verify"; status: "pending" | "running" | "complete" | "skipped" | "failed" };
export type ActivationPlan = {
  planId: string; setupId: string; displayName: string; mode: "automatic" | "guided";
  version: string | null; publisher: string; surface: "chat" | "terminal";
};
export type ActivationOperation = {
  operationId: string; setupId: string; displayName: string; status: ActivationStatus;
  steps: ActivationStep[]; installed: boolean; errorCode: string | null; updatedAt: number;
};
export type ActivationSnapshot = { epoch: string; revision: number; operations: ActivationOperation[] };
export type LocalAgentActivationBridge = {
  read(): Promise<ActivationSnapshot>;
  plan(request: { setupId: string; surface: "chat" | "terminal" }): Promise<ActivationPlan>;
  start(request: { planId: string }): Promise<ActivationSnapshot>;
  act(request: { operationId: string; action: "cancel" | "check" | "guide" | "dismiss" }): Promise<ActivationSnapshot>;
  openGuide(request: { planId: string }): Promise<void>;
  subscribe(callback: (snapshot: ActivationSnapshot) => void): () => void;
};
