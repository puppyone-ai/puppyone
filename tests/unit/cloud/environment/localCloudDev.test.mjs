import path from "node:path";
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ exists: vi.fn(), stop: vi.fn() }));
vi.mock("node:fs", async (original) => ({ ...(await original()), existsSync: mocks.exists }));
vi.mock("../../../../scripts/managed-child-lifecycle.mjs", () => ({ stopOwnedChild: mocks.stop }));
import {
  createServiceDefinitions, parseEnvText, prepareLocalCloudDevServices,
  probeLocalCloudService, resolveLocalCloudDevConfig, resolveLocalCloudDevMode,
} from "../../../../scripts/local-cloud-dev.mjs";

const health = { schemaVersion: 1, service: "puppyone-cloud-web", status: "ok", mode: "production", version: "test" };
const env = {
  PUPPYONE_LOCAL_CLOUD_MODE: "preview",
  PUPPYONE_CLOUD_DEV_ROOT: "/workspace/puppyone-cloud",
  VITE_DESKTOP_CLOUD_API_URL: "http://localhost:9090/api/v1",
  VITE_DESKTOP_CLOUD_WEB_URL: "http://localhost:3000",
};
function missingFileError() { return Object.assign(new Error("missing"), { code: "ENOENT" }); }
function config(environment = env, extra = {}) {
  return resolveLocalCloudDevConfig({ desktopRoot: "/workspace/desktop", environment,
    readFile: () => { throw missingFileError(); }, ...extra });
}
function response({ body = "", json = null, ok = true, status = 200 } = {}) {
  return { json: vi.fn().mockResolvedValue(json), ok, status, text: vi.fn().mockResolvedValue(body) };
}
function fetchHealthy(url) {
  return Promise.resolve(String(url).includes(":9090")
    ? response({ json: { status: "ready" } })
    : String(url).includes("/api/health") ? response({ json: health })
    : response({ body: "<title>Puppyone</title><p>Sign in</p>" }));
}
function child() {
  return Object.assign(new EventEmitter(), { pid: 12345, exitCode: null, signalCode: null });
}
beforeEach(() => { mocks.exists.mockReturnValue(true); mocks.stop.mockResolvedValue(undefined); });

describe("local Cloud development services", () => {
  it("parses quoted values and strips unquoted comments", () => {
    expect(parseEnvText('KEY="http://localhost"\nPLAIN=value # comment')).toEqual({ KEY: "http://localhost", PLAIN: "value" });
  });
  it("does not launch Cloud merely because endpoints are localhost", () => {
    const { PUPPYONE_LOCAL_CLOUD_MODE: _mode, ...external } = env;
    expect(config(external)).toBeNull();
    expect(resolveLocalCloudDevMode({ environment: {} })).toBe("external");
  });
  it("honors explicit modes, CLI precedence, and rejects invalid/duplicate modes", () => {
    expect(config(env, { args: ["--local-cloud=dev"] }).mode).toBe("dev");
    expect(config(env, { args: ["--local-cloud=external"] })).toBeNull();
    expect(() => config({ ...env, PUPPYONE_LOCAL_CLOUD_MODE: "typo" })).toThrow("external, preview, or dev");
    expect(() => config(env, { args: ["--local-cloud=dev", "--local-cloud=preview"] })).toThrow("only once");
    expect(() => config(env, { args: ["--local-cloud"] })).toThrow("--local-cloud=");
  });
  it("loads explicit mode from local env and resolves relative sibling paths", () => {
    const resolved = config({}, { readFile: filename => {
      if (filename.endsWith(".env.local")) return Object.entries({ ...env, PUPPYONE_CLOUD_DEV_ROOT: "../cloud" }).map(([k, v]) => `${k}=${v}`).join("\n");
      throw missingFileError();
    } });
    expect(resolved).toMatchObject({ mode: "preview", cloudRoot: path.resolve("/workspace/cloud"),
      apiHealthUrl: "http://localhost:9090/health", webHealthUrl: "http://localhost:3000/api/health" });
  });
  it("keeps IPv6 URL brackets out of native bind addresses", () => {
    expect(config({ ...env, VITE_DESKTOP_CLOUD_API_URL: "http://[::1]:9090/api/v1", VITE_DESKTOP_CLOUD_WEB_URL: "http://[::1]:3000" })).toMatchObject({
      apiHost: "::1", webHost: "::1", webHealthUrl: "http://[::1]:3000/api/health",
    });
  });
  it("never manages a hosted API or hosted Web origin", () => {
    expect(() => config({ ...env, VITE_DESKTOP_CLOUD_API_URL: "https://api.example.test/api/v1" })).toThrow("loopback API");
    expect(() => config({ ...env, VITE_DESKTOP_CLOUD_WEB_URL: "https://web.example.test" })).toThrow("loopback hostname");
    expect(config({ ...env, PUPPYONE_LOCAL_CLOUD_MODE: "external", VITE_DESKTOP_CLOUD_API_URL: "https://api.example.test" })).toBeNull();
  });
  it("requires readiness and typed Web identity, not an arbitrary HTTP 200", async () => {
    const web = { healthUrl: "http://localhost:3000/api/health", kind: "web" };
    await expect(probeLocalCloudService(web, { fetchImpl: vi.fn().mockResolvedValue(response({ json: health })) })).resolves.toEqual({ ready: true });
    for (const json of [{ status: "ok" }, { ...health, service: "another-app" }, { ...health, schemaVersion: 2 }]) {
      await expect(probeLocalCloudService(web, { fetchImpl: vi.fn().mockResolvedValue(response({ json })) })).resolves.toMatchObject({ ready: false });
    }
    await expect(probeLocalCloudService({ healthUrl: "http://localhost:9090/health", kind: "api" }, {
      fetchImpl: vi.fn().mockResolvedValue(response({ json: { status: "starting" } })),
    })).resolves.toEqual({ ready: false, detail: "API status is starting" });
    await expect(probeLocalCloudService(web, { fetchImpl: vi.fn().mockResolvedValue(response({ ok: false, status: 503 })) })).resolves.toEqual({ ready: false, detail: "HTTP 503" });
  });
  it("uses built preview by default when explicitly managed; HMR requires dev mode", () => {
    const [api, web] = createServiceDefinitions(config(), { PUBLIC_URL: "https://production.example.test" });
    expect(api.environment.PUBLIC_URL).toBe("http://localhost:9090");
    expect(api.environment.PUPPYONE_PUBLIC_URL_OVERRIDE).toBe("http://localhost:9090");
    expect(web.command).toBe(process.execPath);
    expect(web.args[1]).toMatch(/standalone[/\\]server\.js$/);
    expect(web.args).not.toContain("dev");
    expect(web.args).toContain("--max-old-space-size=768");
    expect(web.environment.PUPPYONE_NEXT_DIST_DIR).toBe(".next-desktop-login");
    expect(web.requiredPath).toMatch(/\.next-desktop-login[/\\]standalone[/\\]server\.js$/);
    expect(web.environment.HOSTNAME).toBe("127.0.0.1");
    expect(web.environment.PORT).toBe("3000");
    const [, dev] = createServiceDefinitions(config({ ...env, PUPPYONE_LOCAL_CLOUD_MODE: "dev" }), {});
    expect(dev.args).toContain("dev");
    expect(dev.args).toContain("--max-old-space-size=1536");
    expect(dev.environment.PUPPYONE_NEXT_DIST_DIR).toBe(".next");
  });
  it("validates login once, then only probes lightweight health; does not stop reused services", async () => {
    const fetchImpl = vi.fn(fetchHealthy), spawn = vi.fn();
    const services = await prepareLocalCloudDevServices(config(), { fetchImpl, spawn, logger: { info: vi.fn() } });
    expect(spawn).not.toHaveBeenCalled();
    expect(services.ownedProcesses).toEqual([]);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes("/login"))).toHaveLength(1);
    fetchImpl.mockClear();
    await services.probeAll(); await services.probeAll();
    expect(fetchImpl.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(["/health", "/api/health", "/health", "/api/health"]);
    await services.stop(); await services.stop();
    expect(mocks.stop).not.toHaveBeenCalled();
  });
  it("never silently reuses HMR for a requested production preview", async () => {
    const spawn = vi.fn();
    await expect(prepareLocalCloudDevServices(config(), {
      fetchImpl: url => String(url).includes(":9090") ? fetchHealthy(url)
        : Promise.resolve(response({ json: { ...health, mode: "development" } })),
      spawn, logger: { info: vi.fn() },
    })).rejects.toThrow("not running production");
    expect(spawn).not.toHaveBeenCalled();
  });
  it("rejects a broken login page even if liveness is healthy", async () => {
    await expect(prepareLocalCloudDevServices(config(), {
      fetchImpl: url => String(url).includes("/login") ? Promise.resolve(response({ body: "wrong page" })) : fetchHealthy(url),
      logger: { info: vi.fn() }, spawn: vi.fn(),
    })).rejects.toThrow("startup validation");
  });
  it("does not implicitly build a missing preview or spawn a duplicate frontend", async () => {
    mocks.exists.mockImplementation(filename => !String(filename).endsWith("server.js"));
    const spawn = vi.fn();
    await expect(prepareLocalCloudDevServices(config(), {
      fetchImpl: url => String(url).includes(":9090") ? fetchHealthy(url) : Promise.resolve(response({ ok: false, status: 503 })),
      spawn, logger: { info: vi.fn() },
    })).rejects.toThrow("npm run build:local-login");
    expect(spawn).not.toHaveBeenCalled();
  });
  it("awaits owned cleanup on startup failure and never starts the next service", async () => {
    const owned = child(), spawn = vi.fn(() => owned);
    await expect(prepareLocalCloudDevServices(config(), {
      fetchImpl: vi.fn().mockResolvedValue(response({ ok: false, status: 503 })), spawn,
      startupTimeoutMs: 0, logger: { info: vi.fn() },
    })).rejects.toThrow("Timed out");
    expect(spawn).toHaveBeenCalledOnce();
    expect(mocks.stop).toHaveBeenCalledWith(owned);
  });
  it("cleans up when aborted after spawning and stops only its own children once", async () => {
    const abort = new AbortController(), owned = child();
    const spawn = vi.fn(() => { abort.abort(); return owned; });
    await expect(prepareLocalCloudDevServices(config(), {
      fetchImpl: vi.fn().mockResolvedValue(response({ ok: false })), spawn,
      signal: abort.signal, logger: { info: vi.fn() },
    })).rejects.toThrow();
    expect(mocks.stop).toHaveBeenCalledWith(owned);
    mocks.stop.mockClear();
    let firstWeb = true;
    const services = await prepareLocalCloudDevServices(config(), {
      fetchImpl: url => {
        if (String(url).includes("/api/health") && firstWeb) { firstWeb = false; return Promise.resolve(response({ ok: false })); }
        return fetchHealthy(url);
      }, spawn: vi.fn(() => child()), logger: { info: vi.fn() },
    });
    await Promise.all([services.stop(), services.stop()]);
    expect(mocks.stop).toHaveBeenCalledOnce();
  });
});
