import type { ComponentType } from "react";
import { AgentMarkdownMermaidBlock } from "./AgentMarkdownMermaidBlock";

export type AgentMarkdownRichBlockProps = Readonly<{
  language: string;
  source: string;
}>;

export type AgentMarkdownRichBlockDefinition = Readonly<{
  id: string;
  languages: readonly string[];
  component: ComponentType<AgentMarkdownRichBlockProps>;
}>;

export type AgentMarkdownBlockRegistry = Readonly<{
  definitions: readonly AgentMarkdownRichBlockDefinition[];
  resolve: (language: string) => AgentMarkdownRichBlockDefinition | null;
}>;

/**
 * Compile-time rich-block registry. Definitions are explicit product
 * capabilities, not runtime Markdown plugins, so untrusted content can only
 * select a renderer the application deliberately ships.
 */
export function createAgentMarkdownBlockRegistry(
  definitions: readonly AgentMarkdownRichBlockDefinition[],
): AgentMarkdownBlockRegistry {
  const byLanguage = new Map<string, AgentMarkdownRichBlockDefinition>();
  const ids = new Set<string>();
  for (const definition of definitions) {
    if (!definition.id || ids.has(definition.id)) throw new Error(`Duplicate Agent Markdown block id: ${definition.id}`);
    ids.add(definition.id);
    for (const language of definition.languages) {
      const normalized = normalizeLanguage(language);
      if (!normalized) throw new Error(`Agent Markdown block ${definition.id} has an empty language.`);
      if (byLanguage.has(normalized)) throw new Error(`Duplicate Agent Markdown block language: ${normalized}`);
      byLanguage.set(normalized, definition);
    }
  }
  const frozen = Object.freeze([...definitions]);
  return Object.freeze({
    definitions: frozen,
    resolve: (language: string) => byLanguage.get(normalizeLanguage(language)) ?? null,
  });
}

export function normalizeLanguage(language: string) {
  return language.trim().toLowerCase().replace(/[^a-z0-9_+#.-]/g, "").slice(0, 30);
}

export const agentMarkdownBlockRegistry = createAgentMarkdownBlockRegistry([
  {
    id: "mermaid",
    languages: ["mermaid"],
    component: AgentMarkdownMermaidBlock,
  },
]);
