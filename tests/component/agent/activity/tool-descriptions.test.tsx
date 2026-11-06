/** @vitest-environment happy-dom */
import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { AgentToolRenderer, type AgentToolPart } from "../../../../src/features/desktop-agent/ui/AgentToolRendererRegistry";
import { render } from "../../../support/agent/rendererHarness";

function tool(detail: Record<string, unknown>, overrides: Partial<AgentToolPart> = {}): AgentToolPart {
  return { id: "tool", turnId: "turn", itemId: "tool", kind: "tool", label: "Tool", status: "completed", output: "result", sequence: 1, detail, ...overrides } as AgentToolPart;
}

describe("Tool action descriptions", () => {
  it("puts a supplied command purpose on the row and preserves the exact command in details", () => {
    const command = "/bin/zsh -lc 'node scripts/check-layout.mjs'";
    const container = render(<AgentToolRenderer part={tool({ tool: "bash", input: { command, description: "Check editor layout" } }, { kind: "command" })} />);
    const row = container.querySelector<HTMLButtonElement>(".desktop-agent-tool-row")!;
    expect(row.textContent).toContain("Check editor layout");
    expect(row.textContent).not.toContain("/bin/zsh");
    act(() => row.click());
    expect(container.querySelector(".desktop-agent-command-line")?.textContent).toBe(command);
  });

  it("renders an explicitly named exec_command with JSON arguments as a command", () => {
    const input = JSON.stringify({ cmd: "npm run check:boundaries", title: "Validate architecture boundaries" });
    const part = tool({ tool: "exec_command", input });
    const container = render(<AgentToolRenderer part={part} />);
    const row = container.querySelector<HTMLButtonElement>(".desktop-agent-tool-row")!;
    expect(row.textContent).toContain("Ran");
    expect(row.textContent).toContain("Validate architecture boundaries");
    act(() => row.click());
    expect(container.querySelector(".desktop-agent-command-line")?.textContent).toBe("npm run check:boundaries");
    expect(part.detail.input).toBe(input);
  });

  it("uses a provider-supplied command title when no input description exists", () => {
    const container = render(<AgentToolRenderer part={tool({ tool: "bash", command: "node scripts/check-layout.mjs" }, { kind: "command", label: "Inspect layout constraints" })} />);
    expect(container.querySelector(".desktop-agent-tool-row")?.textContent).toContain("Inspect layout constraints");
  });

  it("reads JSON file arguments instead of repeating the provider's Read label", () => {
    const container = render(<AgentToolRenderer part={tool({ tool: "read", input: JSON.stringify({ file_path: "plan/check.md" }) }, { label: "Read check.md" })} />);
    expect(container.querySelector(".desktop-agent-tool-subject-name")?.textContent).toBe("check.md");
    expect(container.querySelector(".desktop-agent-tool-subject-context")?.textContent).toBe("plan");
    expect(container.textContent).not.toContain("ReadRead");
  });

  it("shows a search pattern and scope from encoded arguments", () => {
    const container = render(<AgentToolRenderer part={tool({ tool: "grep", input: JSON.stringify({ pattern: "TODO", path: "src" }) }, { label: "Grep" })} />);
    expect(container.querySelector(".desktop-agent-tool-subject-code")?.textContent).toBe("TODO");
    expect(container.querySelector(".desktop-agent-tool-subject-context")?.textContent).toBe("in src");
  });

  it("does not repeat Read when only a descriptive provider label is available", () => {
    const container = render(<AgentToolRenderer part={tool({ tool: "read" }, { label: "Read SKILL.md" })} />);
    expect(container.querySelector(".desktop-agent-tool-summary")?.textContent).toBe("SKILL.md");
  });

  it("keeps a generic tool's actual identity and supplied purpose", () => {
    const container = render(<AgentToolRenderer part={tool({ tool: "tool", input: { value: JSON.stringify({ description: "Find recent project decisions", query: "project" }) } }, { label: "persome: context" })} />);
    const row = container.querySelector(".desktop-agent-tool-row")!;
    expect(row.textContent).toContain("Called tool");
    expect(row.textContent).toContain("Find recent project decisions");
    expect(row.textContent).toContain("persome: context");
  });

  it("uses the actual command when no description was supplied", () => {
    const container = render(<AgentToolRenderer part={tool({ tool: "bash", input: { cmd: "python scripts/report.py" } }, { kind: "command" })} />);
    expect(container.querySelector(".desktop-agent-tool-subject-code")?.textContent).toBe("python scripts/report.py");
  });

  it.each(["exec_command", "functions.exec_command"])("does not mistake %s's repeated name for its purpose", name => {
    const container = render(<AgentToolRenderer part={tool({ tool: name, input: { cmd: "python scripts/report.py" } }, { label: name })} />);
    expect(container.querySelector(".desktop-agent-tool-subject-code")?.textContent).toBe("python scripts/report.py");
  });

  it("retains the server identity for same-named MCP tools", () => {
    const container = render(<><AgentToolRenderer part={tool({ tool: "context", input: { description: "Find decisions" } }, { label: "persome.context" })} />
      <AgentToolRenderer part={tool({ tool: "context", input: {} }, { label: "workspace.context" })} /></>);
    expect(container.textContent).toContain("persome.context");
    expect(container.textContent).toContain("workspace.context");
  });

  it("does not classify an unknown tool as a command based on a cmd parameter", () => {
    const container = render(<AgentToolRenderer part={tool({ tool: "custom_lookup", input: { cmd: "find records" } }, { label: "Custom lookup" })} />);
    expect(container.querySelector(".desktop-agent-generic-tool")).not.toBeNull();
    expect(container.querySelector(".desktop-agent-command")).toBeNull();
  });

  it.each(["{ echo hello; }", "[ -f report.md ]"])("preserves raw shell syntax: %s", command => {
    const container = render(<AgentToolRenderer part={tool({ tool: "bash", input: command }, { kind: "command" })} />);
    act(() => container.querySelector<HTMLButtonElement>(".desktop-agent-tool-row")!.click());
    expect(container.querySelector(".desktop-agent-command-line")?.textContent).toBe(command);
  });

  it("does not mistake an encoded description for an executed command", () => {
    const container = render(<AgentToolRenderer part={tool({ tool: "exec_command", input: JSON.stringify({ description: "Inspect project" }) })} />);
    act(() => container.querySelector<HTMLButtonElement>(".desktop-agent-tool-row")!.click());
    expect(container.querySelector(".desktop-agent-command-line")).toBeNull();
    expect(container.textContent).toContain("Inspect project");
  });

  it.each([
    { name: "missing", input: undefined },
    { name: "partial JSON", input: '{"description":' },
    { name: "array", input: '[]' },
    { name: "oversized JSON", input: JSON.stringify({ description: "x".repeat(65 * 1024) }) },
    { name: "nested encoding", input: { value: JSON.stringify({ value: JSON.stringify({ description: "hidden" }) }) } },
  ])("does not invent purpose from unsupported arguments ($name)", ({ input }) => {
    const container = render(<AgentToolRenderer part={tool({ tool: "tool", input })} />);
    expect(container.querySelector(".desktop-agent-tool-row")?.textContent).toContain("Details not provided");
  });
});
