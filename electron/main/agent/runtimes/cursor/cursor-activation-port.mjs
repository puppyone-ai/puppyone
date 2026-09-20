import { parseCursorAuthentication, parseCursorLocalVersion } from "../../connections/probes/cursor-local-probe.mjs";
import { JsonlRpcConnection } from "../../transports/jsonl-rpc-connection.mjs";

export function createCursorActivationPort({ connect = options => new JsonlRpcConnection(options) } = {}) {
  return {
    async verifyInstallation(context) {
      const result = await context.run(["--version"]);
      if (result.code !== 0 || !parseCursorLocalVersion(`${result.stdout}\n${result.stderr}`)) throw new Error("Invalid Cursor installation.");
    },
    async authentication(context) {
      const result = await context.run(["status"]);
      const status = parseCursorAuthentication(`${result.stdout}\n${result.stderr}`);
      if (status === "signed-in" && result.code === 0) return "signed-in";
      if (["signed-out", "expired"].includes(status)) return "signed-out";
      return "unknown";
    },
    async login(context) {
      const result = await context.run(["login"], { timeoutMs: 10 * 60_000 });
      if (result.code !== 0) throw new Error("Cursor login did not complete.");
    },
    async verifyReady(context) {
      await context.assertIdentity();
      const connection = connect({ executablePath: context.candidate.executablePath,
        args: [...(context.candidate.argsPrefix ?? []), "acp"], cwd: context.cwd, env: context.env,
        maxLineBytes: 256 * 1024, maxStderrBytes: 16 * 1024, maxPending: 2, forceKillTimeoutMs: 250 });
      const abort = () => connection.dispose("Activation cancelled.");
      context.signal.addEventListener("abort", abort, { once: true });
      connection.on("request", request => connection.respondError(request.id, -32601, "No workspace operations during activation."));
      try {
        context.signal.throwIfAborted();
        const result = await connection.request("initialize", { protocolVersion: 1, clientCapabilities: {},
          clientInfo: { name: "puppyone-activation", version: context.appVersion } }, { timeoutMs: 15_000, signal: context.signal });
        if (result?.protocolVersion !== 1) throw new Error("Unsupported Cursor ACP protocol.");
      } finally { context.signal.removeEventListener("abort", abort); connection.dispose("Activation verification complete."); }
    },
  };
}
