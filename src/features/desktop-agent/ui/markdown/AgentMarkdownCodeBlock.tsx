import { AGENT_MARKDOWN_CODE_BLOCK_LIMIT } from "./agentMarkdownPolicy";
import {
  agentMarkdownBlockRegistry,
  normalizeLanguage,
  type AgentMarkdownBlockRegistry,
} from "./agentMarkdownBlockRegistry";
import { AgentMarkdownSourceBlock } from "./AgentMarkdownSourceBlock";

export function AgentMarkdownCodeBlock({
  language,
  source,
  registry = agentMarkdownBlockRegistry,
}: Readonly<{
  language: string;
  source: string;
  registry?: AgentMarkdownBlockRegistry;
}>) {
  const normalizedLanguage = normalizeLanguage(language);
  const boundedSource = source.slice(0, AGENT_MARKDOWN_CODE_BLOCK_LIMIT);
  const definition = registry.resolve(normalizedLanguage);
  if (definition) {
    const RichBlock = definition.component;
    return <RichBlock language={normalizedLanguage} source={boundedSource} />;
  }
  return <AgentMarkdownSourceBlock language={normalizedLanguage} source={boundedSource} />;
}
