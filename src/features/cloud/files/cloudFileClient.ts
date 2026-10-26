import { cloudApiRequest, type DesktopCloudSession } from "../../../lib/cloudApi";
import type { ProjectCloudContext } from "../project/context/projectCloudContext";
import { createCloudFileReads } from "./cloudFileReads";
import { committedVersion, snapshotVersion, statusOf, versionRevision,
  type CloudContent, type CloudDirectory, type CloudStat, type CloudWrite } from "./contracts";

/** One authenticated file protocol for every Cloud workbench consumer. Paths are repository-relative. */
export function createCloudFileClient(session: DesktopCloudSession,
  context: Extract<ProjectCloudContext, { status: "resolved" }>, apiBaseUrl: string,
  scopePath: string, assertCurrent: () => void) {
  const reads = createCloudFileReads(session, context, apiBaseUrl, scopePath);
  const apiPath = `/content/${encodeURIComponent(context.projectId)}`;
  const observed = new Map<string, string>();
  const unconfirmed = new Map<string, string>();
  let latestCommittedVersion: string | undefined;

  function observe(path: string, version: string) {
    observed.delete(path); observed.set(path, version);
    while (observed.size > 256) observed.delete(observed.keys().next().value!);
  }

  async function list(path: string) {
    assertCurrent();
    const result = await reads.load("directory", path,
      () => reads.fetch<CloudDirectory>(`ls?path=${encodeURIComponent(path)}`), 30_000);
    assertCurrent();
    const version = snapshotVersion(result);
    observe(path, version);
    for (const entry of result.entries) observe(entry.path, version);
    return result;
  }

  async function stat(path: string) {
    assertCurrent();
    const result = await reads.load("stat", path, () => reads.fetch<CloudStat>(`stat?path=${encodeURIComponent(path)}`));
    assertCurrent();
    if (result.path !== path) throw new Error("Cloud returned a different resource.");
    observe(path, snapshotVersion(result));
    return result;
  }

  async function readText(path: string) {
    assertCurrent();
    const result = await reads.load("text", path, () => reads.fetch<CloudContent>(`cat?path=${encodeURIComponent(path)}`));
    assertCurrent();
    if (result.path !== path || typeof result.type !== "string") throw new Error("Cloud returned a different resource.");
    const version = snapshotVersion(result);
    if (result.repository_revision.expected_oid === null) throw new Error("Cloud file has no committed revision.");
    let content = "";
    if (typeof result.content_text === "string") content = result.content_text;
    else if (typeof result.content === "string") content = result.content;
    else if (result.content != null) content = JSON.stringify(result.content, null, 2);
    observe(path, version);
    return { content, version, entry: { path, name: path.split("/").pop()!, type: result.type } };
  }

  async function baseline(path: string): Promise<string> {
    assertCurrent();
    const version = observed.get(path) ?? latestCommittedVersion;
    if (version) return version;
    return snapshotVersion(await stat(path));
  }

  async function mutate(operation: "write" | "mkdir" | "mv" | "rm", arguments_: object, version: string) {
    assertCurrent();
    const revision = versionRevision(version);
    const identity = JSON.stringify([operation, arguments_, version]);
    if (!unconfirmed.has(identity) && unconfirmed.size >= 64) {
      throw new Error("Retry the unconfirmed Cloud operations before starting more writes.");
    }
    const requestKey = unconfirmed.get(identity) ?? crypto.randomUUID();
    unconfirmed.set(identity, requestKey);
    const body = JSON.stringify({ ...arguments_, base_commit_id: revision.expected_oid ?? "",
      native: { input_version: 1, request_key: requestKey, repository_revision: revision } });
    for (let attempt = 0; ; attempt++) {
      assertCurrent();
      try {
        const result = await cloudApiRequest<CloudWrite>(`${apiPath}/${operation}`, session, undefined,
          { method: "POST", body }, apiBaseUrl);
        assertCurrent();
        const nextVersion = committedVersion(result, revision, context.projectId);
        observed.clear(); latestCommittedVersion = nextVersion;
        unconfirmed.delete(identity);
        return { ...result, version: nextVersion };
      } catch (error) {
        const status = statusOf(error);
        if (status === 401 || status === 403) { observed.clear(); latestCommittedVersion = undefined; reads.invalidate(); }
        if (status >= 400 && status < 500 && status !== 408 && status !== 429) unconfirmed.delete(identity);
        // Retry the identical operation, never manufacture a second publication.
        const invalidReceipt = error && typeof error === "object" && "invalidReceipt" in error;
        if (!invalidReceipt && attempt === 0 && (!status || status === 408 || status >= 500)) continue;
        throw error;
      }
    }
  }

  return { list, stat, readText, baseline, mutate,
    rememberVersion: (path: string, version: string) => { versionRevision(version); observe(path, version); },
    peekDirectory: (path: string) => reads.peek<CloudDirectory>("directory", path),
    invalidate: () => { observed.clear(); latestCommittedVersion = undefined; reads.invalidate(); },
    sign: async (path: string) => {
      assertCurrent();
      const result = await cloudApiRequest<{ url: string }>(`${apiPath}/inline/sign`, session, undefined,
        { method: "POST", body: JSON.stringify({ path }) }, apiBaseUrl);
      assertCurrent(); return result;
    },
  };
}
