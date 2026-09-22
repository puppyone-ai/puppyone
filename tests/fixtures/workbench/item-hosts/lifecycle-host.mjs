import { spawn } from "node:child_process";
import { runItemHost } from "../../../../electron/utility/item-host-runtime.mjs";
import { reportNativeProcess } from "../../../../electron/native-process-ownership.mjs";

runItemHost({
  methods: new Set(["create", "ping"]),
  createService({ identity, emit }) {
    process.on("SIGTERM", () => {});
    if (identity.mode === "blocked-initialize") {
      emit({ type: "blocking-initialize" });
      for (;;) { /* Deliberately block only this test utility's event loop. */ }
    }
    if (identity.mode === "native-tree") {
      const child = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, detached: process.platform !== "win32", stdio: "ignore",
      });
      reportNativeProcess(child, { grouped: process.platform !== "win32" });
      emit({ type: "native-child", pid: child.pid });
    }
    return {
      create() { return { created: true }; },
      ping() { return { alive: true }; },
      closeAll() { return identity.mode === "blocked-dispose" ? new Promise(() => {}) : Promise.resolve(); },
    };
  },
});
