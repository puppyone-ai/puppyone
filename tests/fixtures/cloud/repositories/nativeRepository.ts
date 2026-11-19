/** Fixture protocol shared by Cloud client and mounted-workbench acceptance. */
export function nativeSnapshot(head: string, generation = 1) {
  return { head_commit_id: head, repository_revision: {
    repository_profile: "native" as const, object_format: "sha1" as const, generation,
    target_ref_b64: "cmVmcy9oZWFkcy9tYWlu", expected_oid: head || null, tree_oid: `tree-${head}`,
    head_guard: { kind: "symbolic" as const, target_b64: "cmVmcy9oZWFkcy9tYWlu" },
  } };
}

export function nativeVersion(head: string, generation = 1) {
  return `cloud-git:${JSON.stringify(nativeSnapshot(head, generation).repository_revision)}`;
}

export function nativeReceipt(head: string, projectId = "project", generation = 1) {
  return { commit_id: head, repository_transaction: { project_id: projectId, generation,
    status: "committed", product: { commit_oid: head || null, tree_oid: `tree-${head}` } } };
}
