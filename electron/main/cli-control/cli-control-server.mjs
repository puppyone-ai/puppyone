import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { CLI_CONTROL_LIMITS } from "../../../shared/cli-control-contract/protocol.mjs";

/**
 * The per-user socket `puppyone open` talks to. Each connection carries one
 * JSON line in each direction. Only the current user can reach it: the
 * directory is 0700 and the socket 0600.
 */
export function createCliControlServer({
  endpoint,
  handle,
  // Runs once the response has left this process, so the caller already has it.
  onResponseSent = () => undefined,
  logger = console,
  uid = typeof process.getuid === "function" ? process.getuid() : null,
  limits = CLI_CONTROL_LIMITS,
}) {
  let server = null;
  const sockets = new Set();

  async function start() {
    if (server) return endpoint;
    await prepareDirectory(path.dirname(endpoint));
    await fs.unlink(endpoint).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
    const nextServer = net.createServer(accept);
    nextServer.on("error", (error) => logger.warn("Command-line control server error:", error));
    await new Promise((resolve, reject) => {
      nextServer.once("error", reject);
      nextServer.listen(endpoint, () => {
        nextServer.off("error", reject);
        resolve();
      });
    });
    await fs.chmod(endpoint, 0o600);
    server = nextServer;
    return endpoint;
  }

  async function prepareDirectory(directory) {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const stats = await fs.lstat(directory);
    // The /tmp fallback is shared ground: never listen inside someone else's directory.
    if (!stats.isDirectory() || (uid !== null && stats.uid !== uid)) {
      throw new Error(`The command-line control directory is not owned by this user: ${directory}`);
    }
    if ((stats.mode & 0o077) !== 0) await fs.chmod(directory, 0o700);
  }

  function accept(socket) {
    sockets.add(socket);
    socket.setEncoding("utf8");
    socket.setTimeout(limits.requestTimeoutMs, () => socket.destroy());
    let buffer = "";
    let received = false;
    socket.on("data", (chunk) => {
      if (received) return;
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline === -1) {
        if (Buffer.byteLength(buffer, "utf8") > limits.requestBytes) socket.destroy();
        return;
      }
      received = true;
      socket.setTimeout(0);
      const line = buffer.slice(0, newline);
      buffer = "";
      void respond(socket, line);
    });
    socket.on("error", () => undefined);
    socket.on("close", () => sockets.delete(socket));
  }

  async function respond(socket, line) {
    let response;
    if (Buffer.byteLength(line, "utf8") > limits.requestBytes) {
      response = { ok: false, error: { code: "BAD_REQUEST", message: "The request is too large." } };
    } else {
      let request;
      try {
        request = JSON.parse(line);
      } catch {
        request = undefined;
      }
      try {
        response = await handle(request);
      } catch (error) {
        logger.error("Unable to handle a command-line request:", error);
        response = { ok: false, error: { code: "OPEN_FAILED", message: "PuppyOne could not handle the request." } };
      }
    }
    if (socket.destroyed) return;
    socket.end(`${JSON.stringify(response)}\n`, () => {
      try {
        onResponseSent(response);
      } catch (error) {
        logger.error("Unable to finish a command-line request:", error);
      }
    });
  }

  async function close() {
    const closing = server;
    server = null;
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    if (closing) await new Promise((resolve) => closing.close(() => resolve()));
    await fs.unlink(endpoint).catch(() => undefined);
  }

  return Object.freeze({ endpoint, start, close });
}
