import { createContext, useContext } from "react";

export type AgentToolGroupDisclosure = Readonly<{
  itemId: string;
  expandedId: string | null;
  setExpandedId: (itemId: string | null) => void;
}>;

export const AgentToolGroupContext = createContext<AgentToolGroupDisclosure | null>(null);

export function useAgentToolGroupDisclosure() {
  return useContext(AgentToolGroupContext);
}
