import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export function loadMacosResourceDrag() {
  // electron-builder unpacks .node files; no runtime compiler or private API.
  const modulePath = fileURLToPath(new URL("./native/resource-drag.node", import.meta.url));
  return createRequire(import.meta.url)(modulePath);
}
