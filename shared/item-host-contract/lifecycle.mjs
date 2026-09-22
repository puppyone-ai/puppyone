import { hostError } from "./rpc.mjs";

export function parseItemExecutionTarget(value) {
  if (!value || !["agent", "terminal"].includes(value.kind)) throw hostError("HOST_PAYLOAD", "Invalid execution kind.");
  for (const name of ["itemId", "creationId", "operationId"]) {
    if (typeof value[name] !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value[name])) {
      throw hostError("HOST_PAYLOAD", `Invalid ${name}.`);
    }
  }
  return { kind: value.kind, itemId: value.itemId, creationId: value.creationId, operationId: value.operationId };
}
