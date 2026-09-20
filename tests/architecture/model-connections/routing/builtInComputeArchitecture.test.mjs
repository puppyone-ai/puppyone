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

  it("keeps connection configuration exclusively in Settings", () => {
    const app = read("src/App.tsx");
    const panel = read("src/features/desktop-agent/ui/AgentChatTabPanel.tsx");
    const source = read("src/features/desktop-agent/ui/built-in-agent/BuiltInAgentCompute.tsx");
    const publicConnections = read("src/features/model-connections/index.ts");
    expect(app).toContain('onOpenModelConnections={() => openSettingsDialog("model-connections")}');
    expect(panel).toContain("onOpenModelConnections={onOpenModelConnections}");
    expect(source).toContain("onClick={onOpenModelConnections}");
    expect(source).toContain('t("agent.compute.managedBalance")');
    expect(source).not.toMatch(/ModelConnectionQuickSetup|ModelConnectionsSettings|store\.(save|discover|verify)\(/u);
    expect(publicConnections).not.toContain("ModelConnectionQuickSetup");
    expect(fs.existsSync(path.join(root, "src/features/model-connections/ui/ModelConnectionQuickSetup.tsx"))).toBe(false);
    expect(source).not.toMatch(/fetch\s*\(|ipcRenderer|safeStorage|localStorage|pi-coding-agent/u);
  });

  it("limits Chat to selecting verified catalog models", () => {
    const source = read("src/features/desktop-agent/ui/built-in-agent/BuiltInAgentCompute.tsx");
    expect(source).toContain('catalog.status === "ready"');
    expect(source).toContain("catalog.configGeneration === connection.configGeneration");
    expect(source).toContain("const readyModels = models.filter");
    expect(source).toContain("<AgentSessionControlPicker");
    expect(source).not.toMatch(/<(?:input|select|textarea)\b|desktop-agent-compute-editor/u);
  });
});
