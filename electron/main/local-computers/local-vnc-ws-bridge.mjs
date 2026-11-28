import crypto from "node:crypto";
import http from "node:http";
import net from "node:net";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function encodeWebSocketFrame(opcode, payload) {
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

function tryReadClientFrame(buffer) {
  if (buffer.length < 2) return null;
  const firstByte = buffer[0];
  const secondByte = buffer[1];
  const opcode = firstByte & 0x0f;
  const masked = (secondByte & 0x80) !== 0;
  let payloadLength = secondByte & 0x7f;
  let offset = 2;

  if (payloadLength === 126) {
    if (buffer.length < 4) return null;
    payloadLength = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLength === 127) {
    if (buffer.length < 10) return null;
    const bigLen = buffer.readBigUInt64BE(2);
    if (bigLen > 16n * 1024n * 1024n) {
      return { error: "Frame exceeds maximum size." };
    }
    payloadLength = Number(bigLen);
    offset = 10;
  }

  const maskBytes = masked ? 4 : 0;
  const frameTotal = offset + maskBytes + payloadLength;
  if (buffer.length < frameTotal) return null;

  const payload = Buffer.from(buffer.subarray(offset + maskBytes, frameTotal));
  if (masked) {
    const mask = buffer.subarray(offset, offset + 4);
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index & 3];
    }
  }
  return {
    opcode,
    payload,
    rest: buffer.subarray(frameTotal),
  };
}

function wireWebSocketToTcp(wsSocket, head, tcpPort, tcpHost) {
  const tcp = net.connect({ host: tcpHost, port: tcpPort });
  let inbound = head && head.length > 0 ? Buffer.from(head) : Buffer.alloc(0);
  let closed = false;

  const closeBoth = () => {
    if (closed) return;
    closed = true;
    wsSocket.destroy();
    tcp.destroy();
  };

  const drainClientFrames = () => {
    while (inbound.length > 0 && !closed) {
      const parsed = tryReadClientFrame(inbound);
      if (!parsed) break;
      if (parsed.error) {
        closeBoth();
        return;
      }
      inbound = parsed.rest;
      if (parsed.opcode === 0x08) {
        wsSocket.end(encodeWebSocketFrame(0x08, Buffer.alloc(0)));
        closeBoth();
        return;
      }
      if (parsed.opcode === 0x09) {
        wsSocket.write(encodeWebSocketFrame(0x0a, parsed.payload));
      } else if (parsed.opcode === 0x01 || parsed.opcode === 0x02 || parsed.opcode === 0x00) {
        tcp.write(parsed.payload);
      }
    }
  };

  tcp.on("connect", () => {
    drainClientFrames();
  });
  tcp.on("data", (chunk) => {
    if (!closed) {
      wsSocket.write(encodeWebSocketFrame(0x02, chunk));
    }
  });
  wsSocket.on("data", (chunk) => {
    inbound = inbound.length === 0 ? Buffer.from(chunk) : Buffer.concat([inbound, chunk]);
    if (tcp.connecting) return;
    drainClientFrames();
  });

  tcp.on("error", closeBoth);
  tcp.on("close", closeBoth);
  wsSocket.on("error", closeBoth);
  wsSocket.on("close", closeBoth);
}

/**
 * Ephemeral loopback RFC6455 WebSocket-to-TCP proxy for local VNC streams.
 * Bound strictly to 127.0.0.1 and guarded by random path tickets.
 */
export function createLocalVncWsBridge({ targetHost = "127.0.0.1" } = {}) {
  const tickets = new Map();
  const sockets = new Set();
  let server = null;
  let listeningPort = null;

  async function ensureServer() {
    if (server && listeningPort) return listeningPort;
    const nextServer = http.createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    nextServer.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    nextServer.on("upgrade", (req, socket, head) => {
      const urlPath = typeof req.url === "string" ? req.url.split("?")[0] : "";
      const key = req.headers["sec-websocket-key"];
      const ticket = tickets.get(urlPath);
      if (!ticket || typeof key !== "string" || ticket.expiresAt < Date.now()) {
        tickets.delete(urlPath);
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
      const requestedProtocol = req.headers["sec-websocket-protocol"];
      const protocolHeader = typeof requestedProtocol === "string" && requestedProtocol.includes("binary")
        ? "Sec-WebSocket-Protocol: binary\r\n"
        : "";
      const accept = crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\n"
        + "Upgrade: websocket\r\n"
        + "Connection: Upgrade\r\n"
        + `Sec-WebSocket-Accept: ${accept}\r\n`
        + protocolHeader
        + "\r\n",
      );
      wireWebSocketToTcp(socket, head, ticket.vncPort, targetHost);
    });

    await new Promise((resolve, reject) => {
      nextServer.once("error", reject);
      nextServer.listen(0, "127.0.0.1", () => {
        nextServer.removeListener("error", reject);
        resolve();
      });
    });
    const address = nextServer.address();
    listeningPort = typeof address === "object" && address ? address.port : null;
    server = nextServer;
    return listeningPort;
  }

  return Object.freeze({
    async issueSession({ vncPort, ttlMs = 10 * 60 * 1000 }) {
      const port = await ensureServer();
      const token = crypto.randomBytes(24).toString("hex");
      const route = `/vnc/${token}`;
      tickets.set(route, { vncPort, expiresAt: Date.now() + ttlMs });
      return {
        url: `ws://127.0.0.1:${port}${route}`,
        protocols: ["binary"],
      };
    },

    async closeAll() {
      tickets.clear();
      for (const socket of sockets) {
        socket.destroy();
      }
      sockets.clear();
      if (!server) return;
      const closing = server;
      server = null;
      listeningPort = null;
      await new Promise((resolve) => closing.close(() => resolve()));
    },
  });
}
