import type { ItemCloseResult, ItemExecutionRequest, ItemLifecyclePort } from "../../../shared/item-host-contract/lifecycle";
import { unwrapProjectSessionResult } from "../../../shared/project-session-contract/schema.mjs";

/** A receipt timeout is uncertainty, not cancellation or a fabricated success. */
export async function handOffItemExecution(port: Pick<ItemLifecyclePort, "terminateItemExecution">, request: ItemExecutionRequest): Promise<ItemCloseResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const receipt = unwrapProjectSessionResult(await Promise.race([
      port.terminateItemExecution(request),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Termination acceptance is unconfirmed. Retry the same operation or open Execution Manager.")), 5000); }),
    ]));
    if (receipt.desiredLifecycle !== "terminated" || receipt.kind !== request.kind
      || receipt.itemId !== request.itemId || receipt.creationId !== request.creationId
      || receipt.projectContext?.generation !== request.projectContext.generation
      || receipt.projectContext.projectId !== request.projectContext.projectId
      || receipt.projectContext.rootPath !== request.projectContext.rootPath
      || typeof receipt.executionId !== "string" || typeof receipt.operationId !== "string"
      || !["pending", "running", "confirmed", "unconfirmed"].includes(receipt.cleanup)) {
      throw new Error("The termination receipt does not match this execution.");
    }
    return receipt.cleanup === "confirmed" ? { kind: "released" } : { kind: "handed-off", receipt };
  } finally { clearTimeout(timer); }
}
