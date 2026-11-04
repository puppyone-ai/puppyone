import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLI_CONTROL_LIMITS, CLI_CONTROL_PROTOCOL } from "../../../../shared/cli-control-contract/protocol.mjs";
import { createCliControlRequests } from "../../../../electron/main/cli-control/cli-control-requests.mjs";
import { createCliControlServer } from "../../../../electron/main/cli-control/cli-control-server.mjs";
import { resolveCliControlEndpoint } from "../../../../electron/main/cli-control/endpoint.mjs";
import { OpenPathRejection } from "../../../../electron/main/system-open-route.mjs";

const app = { name: "PuppyOne", version: "0.4.1", channel: "stable" };

function requests(openPath = vi.fn(async (target) => ({ path: target, status: "opened", kind: "file", window: "file" })), extra = {}) {
  return createCliControlRequests({
    app,
    openExtensions: [".md", ".csv"],
    openMaxBytes: 1024,
    openPath,
    logger: { error: vi.fn() },
    ...extra,
  });
}

describe("command-line requests", () => {
  it("says hello with what this app opens", async () => {
    await expect(requests()({ protocol: 1, type: "hello" })).resolves.toEqual({
      ok: true,
      protocol: CLI_CONTROL_PROTOCOL,
      minProtocol: 1,
      app,
      open: { extensions: [".md", ".csv"], maxBytes: 1024 },
    });
  });

  it("opens each path in order and reports each result", async () => {
    const openPath = vi.fn(async (target) => {
      if (target === "/a/main.py") throw new OpenPathRejection("UNSUPPORTED_TYPE", "nope");
      if (target === "/a/broken.md") throw new Error("window failed");
      return { path: `/real${target}`, status: "opened", kind: "file", window: "file" };
    });
    const response = await requests(openPath)({
      protocol: 1, type: "open", paths: ["/a/plan.md", "/a/main.py", "/a/broken.md"], activate: false,
    });

    expect(openPath.mock.calls).toEqual([
      ["/a/plan.md", { activate: false, enforceSizeLimit: true }],
      ["/a/main.py", { activate: false, enforceSizeLimit: true }],
      ["/a/broken.md", { activate: false, enforceSizeLimit: true }],
    ]);
    expect(response.ok).toBe(true);
    expect(response.results).toEqual([
      { path: "/a/plan.md", status: "opened", kind: "file", window: "file" },
      { path: "/a/main.py", status: "rejected", error: { code: "UNSUPPORTED_TYPE", message: "nope" } },
      { path: "/a/broken.md", status: "rejected", error: { code: "OPEN_FAILED", message: "/a/broken.md could not be opened." } },
    ]);
  });

  it("brings windows forward unless asked not to", async () => {
    const openPath = vi.fn(async () => ({ status: "opened", kind: "file", window: "file" }));
    await requests(openPath)({ protocol: 1, type: "open", paths: ["/a.md"] });
    expect(openPath).toHaveBeenCalledWith("/a.md", { activate: true, enforceSizeLimit: true });
  });

  it("opens nothing before windows may open", async () => {
    let allow;
    const allowed = new Promise((resolve) => { allow = resolve; });
    const openPath = vi.fn(async () => ({ status: "opened", kind: "file", window: "file" }));
    const response = requests(openPath, { whenWindowsAllowed: () => allowed })({ protocol: 1, type: "open", paths: ["/a.md"] });
    await Promise.resolve();
    expect(openPath).not.toHaveBeenCalled();
    allow();
    await expect(response).resolves.toMatchObject({ ok: true });
    expect(openPath).toHaveBeenCalledOnce();
  });

  it.each([
    ["not an object", "open"],
    ["no protocol", { type: "open", paths: ["/a.md"] }],
    ["an unknown type", { protocol: 1, type: "read" }],
    ["no paths", { protocol: 1, type: "open", paths: [] }],
    ["a relative path", { protocol: 1, type: "open", paths: ["a.md"] }],
    ["a NUL byte", { protocol: 1, type: "open", paths: ["/a\0.md"] }],
    ["too many paths", { protocol: 1, type: "open", paths: Array.from({ length: CLI_CONTROL_LIMITS.maxPaths + 1 }, (_, index) => `/${index}.md`) }],
    ["a non-boolean activate", { protocol: 1, type: "open", paths: ["/a.md"], activate: "no" }],
  ])("refuses %s", async (_label, request) => {
    const openPath = vi.fn();
    await expect(requests(openPath)(request)).resolves.toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
    expect(openPath).not.toHaveBeenCalled();
  });

  it("tells a client outside the supported range which versions work", async () => {
    await expect(requests()({ protocol: 2, type: "open", paths: ["/a.md"] })).resolves.toEqual({
      ok: false,
      error: { code: "PROTOCOL_UNSUPPORTED", message: expect.any(String) },
      protocol: 1,
      minProtocol: 1,
      app,
    });
  });
});

describe("command-line endpoint", () => {
  it("lives in the channel's user data", () => {
    expect(resolveCliControlEndpoint({ userDataPath: "/Users/example/Library/Application Support/puppyone", platform: "darwin", uid: 501 }))
      .toBe("/Users/example/Library/Application Support/puppyone/cli/control.sock");
  });

  it("falls back to a per-user /tmp directory when the path is too long for a socket", () => {
    const userDataPath = `/Users/example/${"nested/".repeat(12)}Library/Application Support/puppyone`;
    const endpoint = resolveCliControlEndpoint({ userDataPath, platform: "darwin", uid: 501 });
    expect(endpoint).toMatch(/^\/tmp\/puppyone-cli-501\/[0-9a-f]{16}\.sock$/);
    expect(resolveCliControlEndpoint({ userDataPath, platform: "darwin", uid: 501 })).toBe(endpoint);
  });

  it("is not offered on Windows yet", () => {
    expect(resolveCliControlEndpoint({ userDataPath: "C:\\Users\\example\\AppData\\Roaming\\puppyone", platform: "win32", uid: null })).toBeNull();
  });
});

describe("command-line control server", () => {
  const cleanup = [];
  afterEach(async () => {
    for (const task of cleanup.splice(0).reverse()) await task();
  });

  async function startServer(handle, limits, onResponseSent) {
    const root = await fs.mkdtemp(path.join("/tmp", "po-cli-"));
    cleanup.push(() => fs.rm(root, { recursive: true, force: true }));
    const endpoint = path.join(root, "cli", "control.sock");
    const server = createCliControlServer({ endpoint, handle, onResponseSent, logger: { warn: vi.fn(), error: vi.fn() }, limits });
    await server.start();
    cleanup.push(() => server.close());
    return { endpoint, root };
  }

  function exchange(endpoint, payload) {
    return new Promise((resolve, reject) => {
      const socket = net.connect(endpoint);
      let data = "";
      socket.setEncoding("utf8");
      socket.on("connect", () => socket.write(payload));
      socket.on("data", (chunk) => { data += chunk; });
      socket.on("end", () => resolve(data));
      socket.on("close", () => resolve(data));
      socket.on("error", reject);
    });
  }

  it("answers one JSON line with one JSON line, reachable only by this user", async () => {
    const handle = vi.fn(async (request) => ({ ok: true, echo: request.type }));
    const sent = vi.fn();
    const { endpoint } = await startServer(handle, undefined, sent);
    const reply = await exchange(endpoint, `${JSON.stringify({ protocol: 1, type: "hello" })}\n`);
    expect(JSON.parse(reply)).toEqual({ ok: true, echo: "hello" });
    await vi.waitFor(() => expect(sent).toHaveBeenCalledWith({ ok: true, echo: "hello" }));
    expect((await fs.stat(endpoint)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(path.dirname(endpoint))).mode & 0o777).toBe(0o700);
  });

  it("hands invalid JSON to the request handler as nothing", async () => {
    const handle = vi.fn(async () => ({ ok: false, error: { code: "BAD_REQUEST" } }));
    const { endpoint } = await startServer(handle);
    expect(JSON.parse(await exchange(endpoint, "{not json\n"))).toMatchObject({ ok: false });
    expect(handle).toHaveBeenCalledWith(undefined);
  });

  it("drops a client that sends too much or never finishes", async () => {
    const handle = vi.fn();
    const { endpoint } = await startServer(handle, { ...CLI_CONTROL_LIMITS, requestBytes: 64, requestTimeoutMs: 100 });
    expect(await exchange(endpoint, "x".repeat(200))).toBe("");
    expect(await exchange(endpoint, '{"protocol":1')).toBe("");
    expect(handle).not.toHaveBeenCalled();
  });

  it("replaces a stale socket left by a crashed run", async () => {
    const root = await fs.mkdtemp(path.join("/tmp", "po-cli-"));
    cleanup.push(() => fs.rm(root, { recursive: true, force: true }));
    const endpoint = path.join(root, "cli", "control.sock");
    await fs.mkdir(path.dirname(endpoint), { recursive: true });
    await fs.writeFile(endpoint, "stale");
    const server = createCliControlServer({ endpoint, handle: async () => ({ ok: true }), logger: { warn: vi.fn() } });
    await server.start();
    cleanup.push(() => server.close());
    expect(JSON.parse(await exchange(endpoint, '{"protocol":1,"type":"hello"}\n'))).toEqual({ ok: true });
  });

  it("refuses to listen in a directory another user owns", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "po-cli-"));
    cleanup.push(() => fs.rm(root, { recursive: true, force: true }));
    const server = createCliControlServer({ endpoint: path.join(root, "control.sock"), handle: vi.fn(), uid: 0 });
    await expect(server.start()).rejects.toThrow(/not owned by this user/);
  });
});
