import type { ProjectSessionSnapshot } from "../../../../shared/project-session-contract/types";
export interface ProjectSessionClient {
  read(): Promise<ProjectSessionSnapshot>;
  subscribe(callback: (snapshot: ProjectSessionSnapshot) => void): () => void;
}
export function getProjectSessionClient(): ProjectSessionClient | null {
  const bridge = window.puppyoneDesktop;
  return bridge?.readProjectSessions ? {
    read: () => bridge.readProjectSessions(),
    subscribe: (callback) => bridge.onProjectSessionsChanged(callback),
  } : null;
}
