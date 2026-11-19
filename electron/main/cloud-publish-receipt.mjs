import { createPublishError } from "./cloud-publish-contract.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAIN = Buffer.from("refs/heads/main").toString("base64");

export function initialAttemptArgs(record) {
  const id = record.attempt?.attempt_id;
  if (!UUID.test(id ?? "")) throw createPublishError("IDENTITY_MISMATCH", "Invalid push attempt.", false);
  return ["-c", `http.${record.canonical_remote_url}.extraHeader=X-PuppyOne-Initial-Attempt: ${id}`];
}

function receiptUrl(record, id) {
  // The canonical URL was validated and journaled by the coordinator. Never
  // redirect a credential-bearing request or follow a URL from a response.
  const url = new URL(record.canonical_remote_url);
  if (url.username || url.password || url.search || url.hash
      || url.pathname !== `/git/${record.project_id}.git`
      || (url.protocol !== "https:" && !(url.protocol === "http:"
        && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))) return null;
  url.pathname += `/operations/${id}`;
  return url.toString();
}

function boundResult(value, record, id) {
  if (value?.project_id !== record.project_id || value?.request_key !== id.toLowerCase()) return null;
  const result = value.result;
  if (result?.project_id !== record.project_id || result.status !== value.status) return null;
  return result;
}

function initialMainRef(result, record) {
  const refs = result?.refs;
  if (!Array.isArray(refs) || refs.length !== 1 || refs[0].name_b64 !== MAIN
      || refs[0].new?.kind !== "oid" || refs[0].new?.oid !== record.attempt.commit_oid) return null;
  return refs[0];
}

export async function readInitialPushReceipt(record, secret, fetchImpl = globalThis.fetch) {
  const id = record.attempt?.attempt_id;
  if (!UUID.test(id ?? "")) return null;
  const url = receiptUrl(record, id);
  if (!url) return null;
  const response = await fetchImpl(url, {
    method: "GET", redirect: "error", cache: "no-store",
    signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Basic ${Buffer.from(`${record.credential_username}:${secret}`).toString("base64")}` },
  });
  if (!response.ok) return null; // Missing, denied, unavailable: never infer failure/success.
  const envelope = await response.json();
  const value = envelope?.data;
  const result = boundResult(value, record, id);
  const ref = initialMainRef(result, record);
  if (!ref) return null;
  if (value.status === "committed" && ref.observed?.kind === "absent") return record.attempt.commit_oid;
  if (value.status === "rejected") {
    throw createPublishError("PUSH_FAILED", "Cloud rejected this push attempt.", true);
  }
  return null;
}
