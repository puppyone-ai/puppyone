import type { AuxiliaryWorkbenchProject } from "../../app-shell/auxiliary-workbench/types";
import { AgentControllerRegistry } from "../application/AgentControllerRegistry";
import { createProjectAgentClientProvider } from "../infrastructure/electron/electronAgentClient";
import type { AgentClientProvider } from "../application/AgentClientPort";

/** A content resource scope owns its controllers; the Shell owns only proxies. */
export function projectAgentControllers(project: AuxiliaryWorkbenchProject, options: {
  createClient?: () => AgentClientProvider; preserveDraftOnDispose?: boolean;
} = {}) {
  return project.getResource("agent", () => new AgentControllerRegistry(
    project.context.rootPath,
    options.createClient ?? (() => createProjectAgentClientProvider(project.context)),
    options.preserveDraftOnDispose ?? false,
  ));
}
