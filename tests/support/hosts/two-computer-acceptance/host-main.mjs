#!/usr/bin/env node
/**
 * One computer's PuppyOne Host service, as its own process (like
 * `PuppyOne --puppyone-host`), under plain Node on Linux. Real modules from the
 * Desktop repository mounted at /desktop. Replaced: Electron safeStorage (test
 * stand-in, NOT encryption) and utilityProcess (child_process.fork).
 */
import { fork } from "node:child_process";
import { runHostService } from "/desktop/electron/host-service/runtime.mjs";

const stateDir = process.env.ACCEPT_STATE;
const secureStorage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => "accept-test",
  encryptString: (value) => Buffer.from(value, "utf8"),
  decryptString: (value) => value.toString("utf8"),
};
const utilityProcess = {
  fork(modulePath, args = [], options = {}) {
    const child = fork("/accept/utility-bootstrap.mjs", [modulePath, ...args],
      { stdio: ["ignore", "ignore", "inherit", "ipc"], execArgv: options.execArgv ?? [] });
    const wrapper = {
      postMessage: (message) => { if (child.connected) child.send(message); },
      on: (event, listener) => { child.on(event, listener); return wrapper; },
      once: (event, listener) => { child.once(event, listener); return wrapper; },
      kill: () => child.kill(),
      get pid() { return child.pid; },
    };
    return wrapper;
  },
};
const log = (level) => (message, details) =>
  process.stderr.write(`[host ${level}] ${message}${details ? " " + JSON.stringify(details) : ""}\n`);

const host = await runHostService({
  stateDir, secureStorage, utilityProcess,
  hostExecModulePath: "/desktop/electron/utility/host-exec/main.mjs",
  appVersion: "0.0.0-accept", logger: { warn: log("warn"), error: log("error"), info() {} },
  onShutdown: () => process.exit(0),
});
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => { void host.close().finally(() => process.exit(0)); });
process.stderr.write("[host] started\n");
