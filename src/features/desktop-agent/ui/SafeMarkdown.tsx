/**
 * Compatibility facade for the Agent message surface. Parsing, security,
 * performance bounds and extensible rich-block presentation live in the
 * dedicated Markdown module rather than in the transcript component.
 */
export {
  AgentMarkdownDocument as SafeMarkdown,
  agentMarkdownLimits as safeMarkdownLimits,
} from "./markdown/AgentMarkdownDocument";
