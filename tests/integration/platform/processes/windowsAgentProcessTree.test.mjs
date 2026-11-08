import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { JsonlRpcConnection } from "../../../../electron/main/agent/transports/jsonl-rpc-connection.mjs";
import { terminateWindowsProcessTree } from "../../../../electron/main/platform/common/native-process-handle.mjs";

// Real Windows coverage: taskkill must reach descendants behind an npm-style
// batch wrapper as well as children of a directly launched native executable.
it.runIf(process.platform === "win32").each(["native", "batch"])("closes a real Windows %s Agent tree", async (kind) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone tree "));
  const fixture = path.join(directory, "agent.cjs");
  const batch = path.join(directory, "agent.cmd");
  const ownedPids = [];
  try {
    await fs.writeFile(fixture, `const { spawn } = require('node:child_process');
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
child.once('spawn', () => console.log(JSON.stringify({ method: 'fixture/ready', params: [process.pid, child.pid] })));
process.stdin.resume();
process.stdin.once('end', () => process.exit(0));
setInterval(() => {}, 1000);
`);
    await fs.writeFile(batch, `@echo off\r\n"${process.execPath}" "${fixture}"\r\n`);
    const connection = new JsonlRpcConnection({
      executablePath: kind === "batch" ? batch : process.execPath,
      args: kind === "batch" ? [] : [fixture], cwd: directory, env: process.env });
    ownedPids.push(connection.child.pid);
    const descendants = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Agent fixture did not become ready")), 5000);
      connection.once("notification", message => {
        clearTimeout(timer);
        resolve(message.params);
      });
      connection.child.once("error", error => { clearTimeout(timer); reject(error); });
    });
    ownedPids.push(...descendants);
    expect(ownedPids.every(isAlive)).toBe(true);
    connection.dispose();
    await connection.waitForExit();
    // taskkill completion can precede the kernel's final PID disappearance.
    const deadline = Date.now() + 2000;
    while (ownedPids.some(isAlive) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    expect(ownedPids.filter(isAlive)).toEqual([]);
  } finally {
    await Promise.allSettled([...new Set(ownedPids)].filter(isAlive).map(pid => terminateWindowsProcessTree(pid)));
    await fs.rm(directory, { recursive: true, force: true });
  }
}, 15000);

function isAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === "ESRCH") return false; throw error; }
}
