import { createContext, useContext, useMemo, type ReactNode } from "react";

export type AgentMarkdownEnvironment = Readonly<{
  openExternalUrl?: (href: string) => void | Promise<void>;
}>;

const EMPTY_AGENT_MARKDOWN_ENVIRONMENT: AgentMarkdownEnvironment = Object.freeze({});
const AgentMarkdownEnvironmentContext = createContext<AgentMarkdownEnvironment>(EMPTY_AGENT_MARKDOWN_ENVIRONMENT);

/** Supplies host capabilities without allowing Markdown leaves to read preload. */
export function AgentMarkdownEnvironmentProvider({
  children,
  openExternalUrl,
}: Readonly<AgentMarkdownEnvironment & { children: ReactNode }>) {
  const value = useMemo(() => ({ openExternalUrl }), [openExternalUrl]);
  return (
    <AgentMarkdownEnvironmentContext.Provider value={value}>
      {children}
    </AgentMarkdownEnvironmentContext.Provider>
  );
}

export function useAgentMarkdownEnvironment() {
  return useContext(AgentMarkdownEnvironmentContext);
}
