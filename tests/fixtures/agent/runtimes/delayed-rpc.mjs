import { createInterface } from "node:readline";

// Deterministic native-process fixture. No network, filesystem, credentials, or model.
const input = createInterface({ input: process.stdin });
input.on("line", line => {
  const request = JSON.parse(line);
  const payload = request.params ?? request;
  setTimeout(() => {
    const value = { pid: process.pid, accepted: true };
    process.stdout.write(JSON.stringify(request.jsonrpc
      ? { id: request.id, result: value }
      : { type: "response", id: request.id, command: request.type, success: true, data: value }) + "\n");
  }, payload.delayMs ?? 0);
});
