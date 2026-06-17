import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
const devUrl = "http://127.0.0.1:5173";
const electronBin = process.platform === "win32"
  ? path.join(desktopRoot, "node_modules", ".bin", "electron.cmd")
  : path.join(desktopRoot, "node_modules", ".bin", "electron");

const renderer = spawn("npm", ["run", "dev:renderer"], {
  cwd: desktopRoot,
  stdio: "inherit",
  env: process.env,
});

let electronStarted = false;
let healthCheckInFlight = false;
const healthCheck = setInterval(async () => {
  if (electronStarted || healthCheckInFlight) return;
  healthCheckInFlight = true;

  try {
    const response = await fetch(devUrl);
    if (!response.ok) return;
  } catch {
    return;
  } finally {
    healthCheckInFlight = false;
  }

  if (electronStarted) return;
  electronStarted = true;
  clearInterval(healthCheck);

  const electron = spawn(electronBin, ["."], {
    cwd: desktopRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      PUPPYONE_DESKTOP_DEV_URL: devUrl,
    },
  });

  electron.on("exit", (code) => {
    renderer.kill("SIGTERM");
    process.exit(code ?? 0);
  });
}, 250);

renderer.on("exit", (code) => {
  clearInterval(healthCheck);
  if (!electronStarted) process.exit(code ?? 0);
});
