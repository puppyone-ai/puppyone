import { createServer } from "node:http";
import { developmentInstancePlugin } from "../../../../scripts/desktop/dev/instance-plugin.mjs";
import { describe, expect, it, vi } from "vitest";
import {
  findUnresolvedViteClientPlaceholders,
  probeViteDevServer,
} from "../../../../scripts/vite-client-health.mjs";

function response(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: vi.fn().mockResolvedValue(body),
  };
}

describe("Vite development client health", () => {
  it("finds runtime placeholders left behind by a stale Vite server", () => {
    const source = [
      "const isBundleMode = __BUNDLED_DEV__;",
      "const forwardConsole = __SERVER_FORWARD_CONSOLE__;",
    ].join("\n");

    expect(findUnresolvedViteClientPlaceholders(source)).toEqual([
      "__BUNDLED_DEV__",
      "__SERVER_FORWARD_CONSOLE__",
    ]);
  });

  it("does not confuse Vite pure annotations with runtime placeholders", () => {
    const source = [
      "const isBundleMode = false;",
      "const listeners = /* @__PURE__ */ new Set();",
    ].join("\n");

    expect(findUnresolvedViteClientPlaceholders(source)).toEqual([]);
  });

  it("blocks Electron startup when the served client is stale", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response("<!doctype html>"))
      .mockResolvedValueOnce(
        response("const isBundleMode = __BUNDLED_DEV__;"),
      );

    await expect(
      probeViteDevServer("http://127.0.0.1:5173", { fetchImpl }),
    ).resolves.toEqual({
      ready: false,
      reason: "unresolved-client-placeholders",
      placeholders: ["__BUNDLED_DEV__"],
    });
  });

  it("accepts a transformed client and disables HTTP caching", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response("<!doctype html>"))
      .mockResolvedValueOnce(response("const isBundleMode = false;"));

    await expect(
      probeViteDevServer("http://127.0.0.1:5173", { fetchImpl }),
    ).resolves.toEqual({ ready: true });

    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      new URL("http://127.0.0.1:5173/@vite/client"),
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("reports an unavailable development server without throwing", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("connection refused"));

    await expect(
      probeViteDevServer("http://127.0.0.1:5173", { fetchImpl }),
    ).resolves.toEqual({
      ready: false,
      reason: "unreachable",
      error: "connection refused",
    });
  });
  it("refuses a healthy renderer owned by a different development launch", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response("another-launch"));
    await expect(probeViteDevServer("http://127.0.0.1:5173", {
      fetchImpl, instanceToken: "this-launch",
    })).resolves.toEqual({ ready: false, reason: "different-instance" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("accepts its own renderer before probing the document and Vite client", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response("this-launch"))
      .mockResolvedValueOnce(response("<!doctype html>"))
      .mockResolvedValueOnce(response("const isBundleMode = false;"));
    await expect(probeViteDevServer("http://127.0.0.1:5173", {
      fetchImpl, instanceToken: "this-launch",
    })).resolves.toEqual({ ready: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("verifies ownership through the actual development middleware over HTTP", async () => {
    let middleware;
    developmentInstancePlugin({ token: "owned-launch" }).configureServer({
      middlewares: { use(handler) { middleware = handler; } },
    });
    const server = createServer((request, response) => middleware(request, response, () => {
      response.end(request.url === "/@vite/client" ? "const hmr = true;" : "<!doctype html>");
    }));
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const url = `http://127.0.0.1:${server.address().port}`;
      await expect(probeViteDevServer(url, { instanceToken: "owned-launch" })).resolves.toEqual({ ready: true });
      await expect(probeViteDevServer(url, { instanceToken: "other-launch" })).resolves.toEqual({ ready: false, reason: "different-instance" });
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });

});
