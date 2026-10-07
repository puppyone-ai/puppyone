import { fileURLToPath } from "node:url";
import path from "node:path";
import { repairNodePtyPermissions } from "./node-pty-permissions.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, "..");
repairNodePtyPermissions(desktopRoot);
