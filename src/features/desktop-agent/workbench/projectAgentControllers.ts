import type { AuxiliaryWorkbenchProject } from "../../app-shell/auxiliary-workbench/types";
import { AgentControllerRegistry } from "../application/AgentControllerRegistry";
import { createElectronProjectAgentClient } from "../infrastructure/electron/electronAgentClient";
import type { AgentClientProvider } from "../application/AgentClientPort";

/** Controllers belong to the project, so hiding or moving their UI does not end a session. */
export function projectAgentControllers(project: AuxiliaryWorkbenchProject, options: {
  createClient?: () => AgentClientProvider; preserveDraftOnDispose?: boolean;
} = {}) {
  return project.getResource("agent", () => new AgentControllerRegistry(
    project.context.rootPath,
    options.createClient ?? ((itemId) => createElectronProjectAgentClient(project.context, itemId)),
    options.preserveDraftOnDispose ?? false,
  ));
}
