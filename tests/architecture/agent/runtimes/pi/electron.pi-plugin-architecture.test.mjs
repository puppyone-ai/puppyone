import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const piRoot = path.join(repoRoot, "electron/main/agent/runtimes/pi");
const protocolRoot = path.join(repoRoot, "electron/main/agent/protocols/pi-rpc");

describe("Pi RuntimeDefinition plug-in architecture", () => {
  it("keeps user Pi policy thin over the shared Pi RPC protocol layer", () => {
    const expectedFiles = [
      "pi-identity.mjs",
      "pi-discovery.mjs",
      "pi-rpc-client.mjs",
      "pi-rpc-adapter.mjs",
      "pi-event-normalizer.mjs",
      "pi-prompt-input.mjs",
      "pi-runtime-definition.mjs",
    ];
    expect(expectedFiles.every((filename) => existsSync(path.join(piRoot, filename)))).toBe(true);

    const definition = source("electron/main/agent/runtimes/pi/pi-runtime-definition.mjs");
    const identity = source("electron/main/agent/runtimes/pi/pi-identity.mjs");
    const client = source("electron/main/agent/protocols/pi-rpc/pi-rpc-client.mjs");
    const protocolAdapter = source("electron/main/agent/protocols/pi-rpc/pi-rpc-runtime-adapter.mjs");
    const adapter = source("electron/main/agent/runtimes/pi/pi-rpc-adapter.mjs");
    expect(definition).toContain("createPiRuntimeDefinition");
    expect(definition).toContain("manifest: PI_RUNTIME_MANIFEST");
    expect(definition).toContain("createAdapter:");
    expect(identity).toContain('transport: "stdio-jsonl"');
    expect(existsSync(protocolRoot)).toBe(true);
    expect(client).toContain('args: [...argsPrefix, "--mode", "rpc", "--no-approve", ...args]');
    expect(client).not.toContain('jsonrpc: "2.0"');
    expect(adapter).toContain("extends PiRpcRuntimeAdapter");
    expect(protocolAdapter).not.toMatch(/runtimes\/(?:pi|puppyone-agent)/u);
    expect(adapter).not.toMatch(/protocols\/acp|runtimes\/(?:codex|claude|cursor|opencode)/u);
  });

  it("allows concrete Pi construction only at the production composition edge", () => {
    const bootstrap = source("electron/main/agent/bootstrap/create-agent-runtime-host.mjs");
    expect(bootstrap).toContain("createPiRuntimeDefinition");
    expect(bootstrap).toContain("createPiRuntimeDefinition({ logger, ...pi })");

    for (const root of [
      "electron/main/agent/application",
      "electron/main/agent/domain",
      "electron/main/agent/runtime",
      "electron/main/agent/protocols",
      "electron/main/agent/security",
      "electron/main/agent/transports",
      "shared/agent-contract",
    ]) {
      for (const filename of sourceFiles(path.join(repoRoot, root))) {
        expect(readFileSync(filename, "utf8"), path.relative(repoRoot, filename)).not.toContain("runtimes/pi");
      }
    }
  });

  it("keeps shared Renderer behavior capability-driven and Pi UI work limited to composition identity", () => {
    for (const root of [
      "src/features/desktop-agent/application",
      "src/features/desktop-agent/domain",
    ]) {
      for (const filename of sourceFiles(path.join(repoRoot, root))) {
        const text = readFileSync(filename, "utf8");
        expect(text, path.relative(repoRoot, filename)).not.toMatch(/(?:runtimeId|provider)\s*===?\s*["']pi["']/u);
      }
    }
    expect(source("src/features/app-shell/auxiliary-workbench/agentChatCreationRecipes.ts"))
      .toContain('id: "pi", label: "Pi", iconKey: "pi", status: "available", availability: "local-installation"');
    expect(source("packages/shared-ui/src/core/agentBrandCatalog.ts")).toContain('pi: defineBrand("pi", "Pi Agent"');
    expect(source("src/features/desktop-agent/ui/AgentBrandMark.tsx")).toContain("resolveAgentBrand");
  });
});

function source(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function sourceFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  for (const entry of readdirSync(root)) {
    const filename = path.join(root, entry);
    if (statSync(filename).isDirectory()) files.push(...sourceFiles(filename));
    else if (/\.(?:mjs|cjs|js|ts|tsx)$/u.test(entry)) files.push(filename);
  }
  return files;
}
