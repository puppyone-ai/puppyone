import { canonicalizeDocumentResourcePath } from "../document-session/documentIdentity";
import { editorTaskScheduler, type EditorTaskOwner } from "./EditorTaskScheduler";
import { retireEditorHostLeases } from "./EditorHostLeases";

export async function retireEditorTasks(storageIdentity?: string, resource?: string): Promise<void> {
  const path = resource && storageIdentity ? canonicalizeDocumentResourcePath(resource) : null;
  const owners = new Map<string, EditorTaskOwner>();
  for (const task of editorTaskScheduler.snapshot()) {
    if (storageIdentity && task.owner.scope !== storageIdentity) continue;
    if (path && task.owner.instance !== path && !task.owner.instance.startsWith(`${path}/`)) continue;
    owners.set(JSON.stringify(task.owner), task.owner);
  }
  const results = await Promise.allSettled([
    retireEditorHostLeases(storageIdentity, path ?? undefined),
    ...[...owners.values()].map((owner) => editorTaskScheduler.retire(owner)),
  ]);
  const failures = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
  if (failures.length) throw new AggregateError(failures, "Editor tasks are still exiting. Try closing again.");
}
