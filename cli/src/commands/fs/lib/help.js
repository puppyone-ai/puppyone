export const SCOPE_NOTE = "All remote paths are relative to the active Access Point scope.";
export const READ_STDOUT_NOTE = "Default output is Unix-like stdout; use global --json for structured metadata.";
export const MUTATION_SILENT_NOTE = "Success is silent by default, like Unix cp/mv/rm/mkdir/write redirection.";
export const MUTATION_AUDIT_NOTE = "Mutations create PuppyOne version history and audit entries.";
export const JSON_METADATA_NOTE = "Use global --json before fs to receive commit/path metadata.";
export const LIMIT_NOTE = "Recursive scans may be truncated; narrow the path or raise --limit when needed.";

export function helpBlock({ examples = [], notes = [] } = {}) {
  const sections = [];
  if (examples.length) {
    sections.push([
      "Examples:",
      ...examples.map((example) => `  ${example}`),
    ].join("\n"));
  }
  if (notes.length) {
    sections.push([
      "Notes:",
      ...notes.map((note) => `  - ${note}`),
    ].join("\n"));
  }
  return sections.length ? `\n${sections.join("\n\n")}` : "";
}

export function addFsHelp(command, config) {
  const text = helpBlock(config);
  return text ? command.addHelpText("after", text) : command;
}
