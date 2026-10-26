import { isAgentToolActivity } from "../../../../shared/agent-contract/activity-semantics.mjs";
import type { ComponentType } from "react";
import type { AgentPart } from "../domain/agent-projection-types";
import { AgentCommandActivity, AgentFileChangeActivity, AgentFileQueryActivity, AgentGenericActivity } from "./activity";

type AgentActivityPart = Extract<AgentPart, { label: string }>;
export type AgentToolPart = AgentActivityPart & { kind: "tool" | "command" | "file-change" };
type ToolRendererProps = {
  part: AgentToolPart;
  onOpenFile?: (path: string) => void;
};

const renderers = new Map<string, ComponentType<ToolRendererProps>>();

export function registerAgentToolRenderer(tool: string, renderer: ComponentType<ToolRendererProps>) {
  const previous = renderers.get(tool);
  renderers.set(tool, renderer);
  return () => {
    if (renderers.get(tool) !== renderer) return;
    if (previous) renderers.set(tool, previous);
    else renderers.delete(tool);
  };
}

export function isAgentToolPart(part: AgentPart): part is AgentToolPart {
  return isAgentToolActivity(part);
}

export function AgentToolRenderer({ part, onOpenFile }: ToolRendererProps) {
  if (!isAgentToolPart(part)) return null;
  const tool = (typeof part.detail.tool === "string" ? part.detail.tool : part.kind).trim().toLowerCase();
  const Renderer = renderers.get(tool) || renderers.get(part.kind) || DefaultToolRenderer;
  return <Renderer part={part} onOpenFile={onOpenFile} />;
}

function DefaultToolRenderer({ part }: ToolRendererProps) {
  return <AgentGenericActivity activity={part} />;
}

function CommandToolRenderer({ part }: ToolRendererProps) {
  return <AgentCommandActivity activity={part} />;
}

function FileChangeToolRenderer({ part, onOpenFile }: ToolRendererProps) {
  return <AgentFileChangeActivity activity={part} onOpenFile={onOpenFile} />;
}

function GenericToolRenderer({ part }: ToolRendererProps) {
  return <AgentGenericActivity activity={part} />;
}

function FileQueryToolRenderer({ part, onOpenFile }: ToolRendererProps) {
  return <AgentFileQueryActivity activity={part} onOpenFile={onOpenFile} />;
}

registerAgentToolRenderer("tool", GenericToolRenderer);
registerAgentToolRenderer("command", CommandToolRenderer);
registerAgentToolRenderer("bash", CommandToolRenderer);
registerAgentToolRenderer("shell", CommandToolRenderer);
registerAgentToolRenderer("file-change", FileChangeToolRenderer);
for (const tool of ["write", "edit", "apply_patch", "patch"]) registerAgentToolRenderer(tool, FileChangeToolRenderer);
for (const tool of ["read", "glob", "grep", "search", "list"]) registerAgentToolRenderer(tool, FileQueryToolRenderer);
for (const tool of ["webfetch", "websearch"]) registerAgentToolRenderer(tool, GenericToolRenderer);
