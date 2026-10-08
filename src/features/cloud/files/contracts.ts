/** Wire contracts owned by the Cloud VersionEngine content API. */
export type RepositoryRevision = {
  repository_profile: "native";
  object_format: "sha1" | "sha256";
  generation: number;
  target_ref_b64: string;
  expected_oid: string | null;
  tree_oid: string;
  head_guard: { kind: "symbolic"; target_b64: string } | null;
};

export type CloudEntry = {
  path: string;
  name: string;
  type: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  children_count?: number | null;
  exists?: boolean;
};
export type CloudSnapshot = { head_commit_id: string; repository_revision: RepositoryRevision };
export type CloudDirectory = CloudSnapshot & { entries: CloudEntry[] };
export type CloudStat = CloudSnapshot & CloudEntry;
export type CloudContent = CloudSnapshot & {
  path: string;
  type: string;
  content_text?: string | null;
  content?: unknown;
};
export type CloudWrite = {
  path?: string;
  old_path?: string;
  new_path?: string;
  commit_id: string;
  repository_transaction: {
    project_id: string;
    generation: number;
    status: "committed";
    product: { commit_oid: string | null; tree_oid: string };
  };
};

/** Keep the branch/HEAD guard and generation in persisted editor baselines. */
export function revisionVersion(value: RepositoryRevision): string {
  return `cloud-git:${JSON.stringify(validateRevision(value))}`;
}

export function versionRevision(version: string): RepositoryRevision {
  if (!version.startsWith("cloud-git:")) throw new Error("Reload the Cloud file: its complete revision is unavailable.");
  return validateRevision(JSON.parse(version.slice("cloud-git:".length)));
}

export function snapshotVersion(snapshot: CloudSnapshot): string {
  const revision = validateRevision(snapshot.repository_revision);
  if (snapshot.head_commit_id !== (revision.expected_oid ?? "")) {
    throw new Error("Cloud response has an inconsistent storage revision.");
  }
  return revisionVersion(revision);
}

export function committedVersion(result: CloudWrite, base: RepositoryRevision, projectId: string): string {
  const receipt = result.repository_transaction;
  if (receipt?.status !== "committed" || receipt.project_id !== projectId
    || receipt.generation !== base.generation || typeof result.commit_id !== "string"
    || result.commit_id !== (receipt.product?.commit_oid ?? "") || !receipt.product?.tree_oid) {
    throw Object.assign(new Error("Cloud write returned an invalid transaction receipt."), { status: 502, invalidReceipt: true });
  }
  return revisionVersion({ ...base, expected_oid: receipt.product.commit_oid, tree_oid: receipt.product.tree_oid });
}

function validateRevision(value: RepositoryRevision): RepositoryRevision {
  if (!value || value.repository_profile !== "native" || !["sha1", "sha256"].includes(value.object_format)
    || !Number.isSafeInteger(value.generation) || value.generation < 1
    || typeof value.target_ref_b64 !== "string" || !value.target_ref_b64
    || !(value.expected_oid === null || (typeof value.expected_oid === "string" && value.expected_oid.length > 0))
    || typeof value.tree_oid !== "string" || !value.tree_oid
    || !(value.head_guard === null || (value.head_guard?.kind === "symbolic"
      && value.head_guard.target_b64 === value.target_ref_b64))) {
    throw new Error("Cloud response has no complete storage revision.");
  }
  // Canonical fields only: incidental response metadata must not change an editor version.
  return { repository_profile: "native", object_format: value.object_format, generation: value.generation,
    target_ref_b64: value.target_ref_b64, expected_oid: value.expected_oid, tree_oid: value.tree_oid,
    head_guard: value.head_guard && { kind: "symbolic", target_b64: value.head_guard.target_b64 } };
}

export function statusOf(error: unknown): number {
  return error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
}
