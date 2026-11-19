import type { DataPort } from "../../core/types";
const identities = new WeakMap<DataPort, string>();
let sequence = 0;
export function getEditorStorageIdentity(port: DataPort): string {
  if (port.documentPersistence) return port.documentPersistence.storageIdentity;
  let identity = identities.get(port);
  if (!identity) { identity = `read-only-port:${++sequence}`; identities.set(port, identity); }
  return identity;
}
export function shareEditorStorageIdentity(port: DataPort, source: DataPort): void {
  identities.set(port, getEditorStorageIdentity(source));
}
