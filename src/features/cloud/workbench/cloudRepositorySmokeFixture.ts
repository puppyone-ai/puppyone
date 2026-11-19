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

/** A real protocol-shaped response for the hosted History sidebar acceptance. */
export function cloudHistorySmokeFixture(projectId: string) {
  const head = "a".repeat(40);
  return { project_id: projectId, topology_available: true, head_commit_id: head,
    refs: [{ ref_name: "refs/heads/main", ref_type: "branch", commit_id: head }], refs_included: true,
    snapshot_id: "b".repeat(64), next_cursor: null, has_more: false, total: 1,
    graph_health: "complete", unreadable_commit_ids: [], commits: [{ commit_id: head, parent_ids: [],
      who: "Researcher", message: "Update research notes", created_at: "2026-10-10T06:00:00Z",
      root_hash: "c".repeat(40), scope_hash: "c".repeat(40), scope_path: "", audit_detail: null,
      conflicts: [], changes: [{ path: "readme.txt", action: "update" }] }] };
}
