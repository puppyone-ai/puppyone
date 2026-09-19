import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
describe("Built-in compute selection ownership", () => {
  it("mounts compute policy only behind app-managed model capability, without changing Harness routing", () => {
    const panel = read("src/features/desktop-agent/ui/AgentChatTabPanel.tsx");
    expect(panel).toContain('capabilities?.modelConnections && <BuiltInAgentCompute');
    expect(panel).toContain('control.id !== "model"');
    expect(panel).toContain('!capabilities?.modelConnections || computeReady');
    expect(panel).toContain('!pendingConnectionModel');
    expect(read("src/features/desktop-agent/domain/agent-backend-routing.ts")).not.toMatch(/ollama|lm-studio|unsloth|ComputeSource/iu);
  });
  it("keeps source choice in Built-in UI and reuses the connection domain for setup", () => {
    const source = read("src/features/desktop-agent/ui/built-in-agent/BuiltInAgentCompute.tsx");
    expect(source).toContain('id: "managed"'); expect(source).toContain('id: "api"'); expect(source).toContain('id: "local"');
    expect(source).toContain('<ModelConnectionsSettings key={source} embedded sourceKind={source} store={store}');
    expect(source).not.toMatch(/fetch\s*\(|ipcRenderer|safeStorage|localStorage|pi-coding-agent/u);
  });
  it("bounds the expanded compute setup so the shared composer remains reachable", () => {
    const source = read("src/features/desktop-agent/ui/built-in-agent/BuiltInAgentCompute.tsx");
    const css = read("src/features/desktop-agent/ui/built-in-agent/built-in-agent-compute.css");
    expect(source).toContain('data-po-scrollbar="content"');
    expect(css).toContain("max-height: min(50vh, 480px); overflow: auto");
    expect(css).toContain(".model-connections-embedded { max-height: none; overflow: visible; }");
    expect(css).not.toMatch(/cursor:\s*pointer/u);
  });
});
