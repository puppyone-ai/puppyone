import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { build } from "vite";
import { loadDesktopCloudConfiguration, parseDesktopCloudConfiguration } from "../../../../electron/main/cloud-configuration.mjs";
import { loadDesktopDevelopmentEnvironment } from "../../../../scripts/local-cloud-dev.mjs";
import { cloudConfigurationPlugin } from "../../../../tooling/desktop/build/cloud-configuration-plugin.mjs";

const endpoints = { VITE_DESKTOP_CLOUD_API_URL: "https://qubits-api.puppyone.ai/api/v1", VITE_DESKTOP_CLOUD_WEB_URL: "https://qubits-try.puppyone.ai" };

describe("Desktop Cloud environment binding", () => {
  it("keeps development file values and explicit sandbox overrides consistent", () => {
    const loaded = loadDesktopDevelopmentEnvironment({ desktopRoot: "/project", environment: endpoints,
      readFile: () => "VITE_DESKTOP_CLOUD_API_URL=http://localhost:9090/api/v1\nVITE_DESKTOP_CLOUD_WEB_URL=http://localhost:3000" });
    expect(loadDesktopCloudConfiguration({ development: true, environment: loaded }).apiBase).toBe(endpoints.VITE_DESKTOP_CLOUD_API_URL);
  });

  it("does not silently use production when the build configuration is missing", () => {
    expect(loadDesktopCloudConfiguration({ appPath: "/missing", development: false, environment: endpoints,
      readFile: () => { throw new Error("Missing build asset"); } })).toBeNull();
    expect(() => parseDesktopCloudConfiguration({})).toThrow();
  });

  it.each([
    "https://user:secret@qubits-api.puppyone.ai/api/v1",
    "http://qubits-api.puppyone.ai/api/v1",
    "https://example.com/api/v1",
    "https://qubits-api.puppyone.ai/api/v1?token=secret",
    "https://qubits-api.puppyone.ai/api/v2",
  ])("rejects an unsafe or ambiguous configured API: %s", (api) => {
    expect(() => parseDesktopCloudConfiguration({ ...endpoints, VITE_DESKTOP_CLOUD_API_URL: api })).toThrow();
  });

  it("emits the same non-secret build endpoints used by Renderer and ignores later shell overrides", async () => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "agent-cloud-config-")));
    try {
      for (const [key, value] of Object.entries(endpoints)) vi.stubEnv(key, value);
      await fs.writeFile(path.join(root, "index.html"), '<script type="module" src="/entry.js"></script>');
      await fs.writeFile(path.join(root, "entry.js"), "document.body.textContent = import.meta.env.VITE_DESKTOP_CLOUD_API_URL");
      await fs.writeFile(path.join(root, ".env.production"), Object.entries({ ...endpoints, PRIVATE_KEY: "must-stay-private" }).map(([key, value]) => `${key}=${value}`).join("\n"));
      await build({ root, configFile: false, logLevel: "silent", plugins: [cloudConfigurationPlugin()] });
      const configuration = loadDesktopCloudConfiguration({ appPath: root, development: false,
        environment: { VITE_DESKTOP_CLOUD_API_URL: "https://api.puppyone.ai/api/v1" } });
      expect(configuration).toEqual({ schemaVersion: 1, apiBase: endpoints.VITE_DESKTOP_CLOUD_API_URL, webOrigin: endpoints.VITE_DESKTOP_CLOUD_WEB_URL });
      const asset = await fs.readFile(path.join(root, "dist/desktop-cloud.json"), "utf8");
      expect(asset).not.toContain("PRIVATE_KEY");
      const js = (await fs.readdir(path.join(root, "dist/assets"))).find((name) => name.endsWith(".js"));
      expect(await fs.readFile(path.join(root, "dist/assets", js), "utf8")).toContain(configuration.apiBase);
    } finally { vi.unstubAllEnvs(); await fs.rm(root, { recursive: true, force: true }); }
  });
});
