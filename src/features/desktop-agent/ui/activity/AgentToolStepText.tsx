import type { MessageFormatter } from "@puppyone/localization/core";
import type { AgentActivityStatus } from "../../domain/agent-projection-types";
import { isActiveToolStatus, type AgentToolStepKind } from "./agent-tool-steps";

type LocalizedStepKind = Exclude<AgentToolStepKind, "generic">;

/** Past tense once settled, progressive while the tool is still working. */
export function agentToolStepVerb(kind: LocalizedStepKind, status: AgentActivityStatus, t: MessageFormatter) {
  return t(`agent.toolStep.${kind}.${isActiveToolStatus(status) ? "active" : "done"}`);
}

/** A file reads as its name first; the folder is quiet context that may truncate. */
export function AgentToolStepPath({ path }: Readonly<{ path: string }>) {
  const { name, folder } = splitPath(path);
  return (
    <span className="desktop-agent-tool-subject" dir="ltr">
      <span className="desktop-agent-tool-subject-name">{name}</span>
      {folder && <span className="desktop-agent-tool-subject-context">{folder}</span>}
    </span>
  );
}

/** Patterns, commands and URLs keep their literal monospace form. */
export function AgentToolStepCode({ text, context }: Readonly<{ text: string; context?: string }>) {
  return (
    <span className="desktop-agent-tool-subject">
      <code className="desktop-agent-tool-subject-code" dir="ltr">{firstLine(text)}</code>
      {context && <span className="desktop-agent-tool-subject-context">{context}</span>}
    </span>
  );
}

export function AgentToolStepText({ text }: Readonly<{ text: string }>) {
  return (
    <span className="desktop-agent-tool-subject">
      <span className="desktop-agent-tool-subject-context">{firstLine(text)}</span>
    </span>
  );
}

function splitPath(path: string) {
  const trimmed = path.trim().replace(/[\\/]+$/u, "");
  const separator = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (separator < 0) return { name: trimmed, folder: "" };
  return { name: trimmed.slice(separator + 1), folder: trimmed.slice(0, separator) };
}

function firstLine(text: string) {
  const line = text.trim().split(/\r?\n/u, 1)[0] ?? "";
  return line.length > 512 ? `${line.slice(0, 512)}…` : line;
}
