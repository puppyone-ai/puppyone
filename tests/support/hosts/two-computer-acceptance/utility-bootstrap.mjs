// Test-only stand-in for Electron's utility process: gives the module a
// `process.parentPort` over Node IPC, then loads it.
process.parentPort = {
  on(event, listener) {
    if (event === "message") process.on("message", (message) => listener({ data: message }));
  },
  postMessage(message) { process.send(message); },
};
process.on("disconnect", () => process.exit(0));
await import(process.argv[2]);
