import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { createLocalComputerStore } from "./local-computer-store.mjs";
import { createLocalVncWsBridge } from "./local-vnc-ws-bridge.mjs";

const execFileAsync = promisify(execFile);

const LIMACTL_CANDIDATES = [
  "/opt/homebrew/bin/limactl",
  "/usr/local/bin/limactl",
];

async function detectLimactlPath(customPath) {
  if (typeof customPath === "string" && customPath.trim()) {
    return customPath.trim();
  }
  for (const candidate of LIMACTL_CANDIDATES) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try next path.
    }
  }
  try {
    const { stdout } = await execFileAsync("which", ["limactl"], { timeout: 2500 });
    const found = stdout.trim();
    return found || null;
  } catch {
    return null;
  }
}

async function allocateFreeTcpPort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      probe.removeListener("error", reject);
      resolve();
    });
  });
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 5900;
  await new Promise((resolve) => probe.close(() => resolve()));
  return port;
}

function escapeYamlString(value) {
  return JSON.stringify(String(value));
}

function buildLimaConfigYaml({ workspacePath, vncPort, platform }) {
  const useVz = platform === "darwin";
  const vmTypeLine = useVz ? 'vmType: "vz"' : 'vmType: "qemu"';
  const mountTypeLine = useVz ? 'mountType: "virtiofs"' : 'mountType: "reverse-sshfs"';
  return [
    vmTypeLine,
    mountTypeLine,
    "cpus: 2",
    'memory: "2GiB"',
    'disk: "16GiB"',
    "mounts:",
    `  - location: ${escapeYamlString(workspacePath)}`,
    '    mountPoint: "/workspace"',
    "    writable: true",
    "portForwards:",
    "  - guestPort: 5900",
    `    hostPort: ${vncPort}`,
    '    hostIP: "127.0.0.1"',
    "provision:",
    "  - mode: system",
    "    script: |",
    "      #!/bin/bash",
    "      set -eux -o pipefail",
    "      export DEBIAN_FRONTEND=noninteractive",
    "      if ! command -v x11vnc >/dev/null 2>&1; then",
    "        apt-get update && apt-get install -y xvfb fluxbox x11vnc xterm",
    "      fi",
    "      cat >/etc/systemd/system/p1-desktop.service <<'EOF'",
    "      [Unit]",
    "      Description=PuppyOne Computer Desktop",
    "      After=network.target",
    "      [Service]",
    "      Type=simple",
    "      ExecStart=/bin/bash -lc 'Xvfb :99 -screen 0 1280x800x24 & sleep 1; DISPLAY=:99 fluxbox & exec x11vnc -display :99 -forever -shared -nopw -rfbport 5900'",
    "      Restart=always",
    "      [Install]",
    "      WantedBy=multi-user.target",
    "      EOF",
    "      systemctl daemon-reload && systemctl enable --now p1-desktop.service",
    "",
  ].join("\n");
}

export function createLocalComputerService({
  stateDirectory,
  canonicalizeWorkspacePath = async (targetPath) => fs.realpath(targetPath),
  limactlPathOverride = null,
  execCommand = execFileAsync,
  platform = process.platform,
  architecture = process.arch,
  publishSnapshot = () => {},
}) {
  const store = createLocalComputerStore({
    filePath: path.join(stateDirectory, "registry.v1.json"),
  });
  const vncBridge = createLocalVncWsBridge();
  const provisioningIds = new Set();
  let runtimeCache = null;

  async function resolveRuntime() {
    if (runtimeCache) return runtimeCache;
    const limactlPath = await detectLimactlPath(limactlPathOverride);
    const engine = limactlPath ? "lima" : "managed";
    runtimeCache = Object.freeze({
      available: Boolean(limactlPath),
      engine,
      limactlPath,
      architecture,
      platform,
    });
    return runtimeCache;
  }

  async function getSnapshot() {
    const [persisted, runtime] = await Promise.all([store.read(), resolveRuntime()]);
    return Object.freeze({
      experimentalEnabled: persisted.experimentalEnabled,
      runtime,
      computers: persisted.computers,
    });
  }

  async function emitSnapshot() {
    const snapshot = await getSnapshot();
    publishSnapshot(snapshot);
    return snapshot;
  }

  async function stopLimaInstanceIfNeeded(record, runtime) {
    if (!runtime.limactlPath || record.engine !== "lima" || !record.desktopReady) {
      return;
    }
    try {
      await execCommand(runtime.limactlPath, ["stop", "-f", record.instanceName], {
        timeout: 15000,
      });
    } catch {
      // Instance may not exist or may already be stopped.
    }
  }

  async function suspendAllRunning() {
    const [persisted, runtime] = await Promise.all([store.read(), resolveRuntime()]);
    for (const record of persisted.computers) {
      if (record.status === "running" || record.status === "provisioning") {
        await stopLimaInstanceIfNeeded(record, runtime);
        await store.update(record.id, {
          status: "asleep",
          statusDetail: null,
        });
      }
    }
    await vncBridge.closeAll();
  }

  async function runDesktopProvisioning(record, runtime) {
    if (provisioningIds.has(record.id)) return;
    provisioningIds.add(record.id);
    try {
      const vncPort = record.vncPort ?? (await allocateFreeTcpPort());
      const configDir = path.join(stateDirectory, "instances", record.id);
      await fs.mkdir(configDir, { recursive: true });
      const yamlPath = path.join(configDir, "lima.yaml");
      await fs.writeFile(
        yamlPath,
        buildLimaConfigYaml({ workspacePath: record.workspacePath, vncPort, platform }),
        "utf8",
      );
      await store.update(record.id, {
        engine: "lima",
        status: "provisioning",
        vncPort,
        statusDetail: null,
      });
      await emitSnapshot();

      await execCommand(
        runtime.limactlPath,
        ["start", "--tty=false", `--name=${record.instanceName}`, yamlPath],
        { timeout: 10 * 60 * 1000 },
      );
      await store.update(record.id, {
        engine: "lima",
        status: "running",
        desktopReady: true,
        vncPort,
        statusDetail: null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await store.update(record.id, {
        status: "running",
        desktopReady: false,
        statusDetail: message.slice(0, 240),
      });
    } finally {
      provisioningIds.delete(record.id);
      await emitSnapshot();
    }
  }

  return Object.freeze({
    getSnapshot,

    async setExperimentalOptIn({ enabled }) {
      const nextEnabled = enabled === true;
      await store.setExperimentalEnabled(nextEnabled);
      if (!nextEnabled) {
        await suspendAllRunning();
      }
      return emitSnapshot();
    },

    async register({ workspacePath, name, startNow = true }) {
      const canonicalPath = await canonicalizeWorkspacePath(workspacePath);
      const [persisted, runtime] = await Promise.all([store.read(), resolveRuntime()]);
      const existing = persisted.computers.find((item) => item.workspacePath === canonicalPath);
      const id = existing?.id ?? crypto.randomUUID();
      const resolvedName = typeof name === "string" && name.trim()
        ? name.trim()
        : (existing?.name ?? path.basename(canonicalPath));
      const now = new Date().toISOString();
      await store.upsert({
        id,
        name: resolvedName,
        workspacePath: canonicalPath,
        instanceName: existing?.instanceName ?? `p1-${id.replace(/-/g, "").slice(0, 10)}`,
        engine: existing?.engine ?? runtime.engine,
        status: startNow ? "running" : "asleep",
        desktopReady: existing?.desktopReady ?? false,
        vncPort: existing?.vncPort ?? null,
        statusDetail: null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      return emitSnapshot();
    },

    async wake({ id }) {
      const [persisted, runtime] = await Promise.all([store.read(), resolveRuntime()]);
      const record = persisted.computers.find((item) => item.id === id);
      if (!record) throw new Error("Computer not found.");
      if (record.desktopReady && runtime.limactlPath) {
        await store.update(id, { status: "provisioning", statusDetail: null });
        await emitSnapshot();
        try {
          await execCommand(runtime.limactlPath, ["start", "--tty=false", record.instanceName], {
            timeout: 120000,
          });
        } catch {
          // Fallback to running workspace state if instance needs reprovisioning.
        }
      }
      await store.update(id, { status: "running", statusDetail: null });
      return emitSnapshot();
    },

    async sleep({ id }) {
      const [persisted, runtime] = await Promise.all([store.read(), resolveRuntime()]);
      const record = persisted.computers.find((item) => item.id === id);
      if (!record) throw new Error("Computer not found.");
      await stopLimaInstanceIfNeeded(record, runtime);
      await store.update(id, { status: "asleep", statusDetail: null });
      return emitSnapshot();
    },

    async provisionDesktop({ id }) {
      const [persisted, runtime] = await Promise.all([store.read(), resolveRuntime()]);
      const record = persisted.computers.find((item) => item.id === id);
      if (!record) throw new Error("Computer not found.");
      if (!runtime.limactlPath) {
        await store.update(id, {
          status: "running",
          desktopReady: false,
          statusDetail: "limactl-unavailable",
        });
        return emitSnapshot();
      }
      void runDesktopProvisioning(record, runtime);
      await store.update(id, { status: "provisioning", statusDetail: null });
      return emitSnapshot();
    },

    async remove({ id }) {
      const [persisted, runtime] = await Promise.all([store.read(), resolveRuntime()]);
      const record = persisted.computers.find((item) => item.id === id);
      if (record) {
        await stopLimaInstanceIfNeeded(record, runtime);
        await store.remove(id);
      }
      return emitSnapshot();
    },

    async connectScreen({ id }) {
      const persisted = await store.read();
      const record = persisted.computers.find((item) => item.id === id);
      if (!record) throw new Error("Computer not found.");
      if (record.status === "asleep" || record.status === "stopped") {
        const error = new Error("Computer is asleep.");
        error.status = 409;
        throw error;
      }
      if (record.desktopReady && record.vncPort) {
        const ws = await vncBridge.issueSession({ vncPort: record.vncPort });
        return {
          transport: "vnc-ws",
          url: ws.url,
          protocols: ws.protocols,
          width: 1280,
          height: 800,
        };
      }
      return {
        transport: "managed-preview",
        url: "",
        width: 1280,
        height: 800,
      };
    },

    async closeAll() {
      await suspendAllRunning();
    },
  });
}
