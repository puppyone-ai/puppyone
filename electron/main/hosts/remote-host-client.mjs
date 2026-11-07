import { setTimeout as delay } from "node:timers/promises";
import { createHostSshClient, normalize } from "./ssh/host-ssh-client.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const READ_ACTIONS = new Set(["list", "read"]);
const ACTIONS = new Set(["list", "read", "write", "mkdir", "move", "remove", "git"]);
const GIT_READS = new Set(["status", "graph", "commit_detail", "file_diff"]);
const FIELDS = ["action", "path", "content_base64", "expected_revision", "destination", "op", "paths", "scope", "commit", "message"];

/** Structured failure that survives Electron IPC (custom Error fields do not). */
function failure(error) {
  const known = normalize(error);
  return { ok: false, status: known.status, code: known.code, outcomeUnknown: known.outcomeUnknown === true };
}

function shape(input) {
  return Object.fromEntries(FIELDS.filter((key) => input[key] !== undefined).map((key) => [key, input[key]]));
}

/**
 * Access-side client for another computer's folder: file protocol v1 inside an
 * SSH session that ends on that computer (see ./ssh/host-ssh-client.mjs), so
 * the Cloud relays bytes it cannot read. Credentials stay in Main. Reads may
 * retry a lost connection; a mutation is sent once and an uncertain result is
 * reported, never replayed.
 */
export function createRemoteHostClient({ auth, apiBase, ssh = createHostSshClient({ auth, apiBase }),
  retryDelays = [250, 1000], wait = delay }) {
  async function request(folderId, input, expectedSession) {
    if (!UUID.test(folderId) || !ACTIONS.has(input?.action)) return { ok: false, status: 400, code: "invalid_request" };
    const reading = READ_ACTIONS.has(input.action) || (input.action === "git" && GIT_READS.has(input.op));
    const attempts = reading ? retryDelays.length + 1 : 1;
    let last;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const connection = await ssh.get(folderId, expectedSession);
        const files = await connection.files();
        return { ok: true, result: await files.request(shape(input), { mutating: !reading }) };
      } catch (error) {
        last = failure(error);
        // Only a lost connection or a slow host is worth a second read.
        if (![0, 502, 504].includes(last.status) || attempt === attempts - 1) break;
        ssh.close(folderId);
        await wait(retryDelays[attempt]);
      }
    }
    return last;
  }

  /** Streams folder changes until `signal` aborts; reconnects a retryable outage, then asks for a rescan. */
  async function watch(folderId, expectedSession, emit, signal) {
    if (!UUID.test(folderId)) throw new Error("Invalid folder.");
    const delays = [500, 1000, 3000, 10_000];
    let missed = false;
    for (let attempt = 0; !signal.aborted;) {
      let outcome;
      try {
        const connection = await ssh.get(folderId, expectedSession);
        const files = await connection.files();
        outcome = await new Promise((resolve, reject) => {
          let stop = null;
          const onAbort = () => { stop?.(); resolve({ aborted: true }); };
          signal.addEventListener("abort", onAbort, { once: true });
          files.watch((event) => {
            attempt = 0;
            void emit({ type: "change", paths: event.paths, reset: event.reset === true });
          }, () => {
            signal.removeEventListener("abort", onAbort);
            resolve({ type: "unavailable", retryable: true });
          }).then((unwatch) => {
            stop = unwatch;
            if (signal.aborted) unwatch();
            // Changes made while this computer could not see the folder: rescan.
            else if (missed) { missed = false; void emit({ type: "change", paths: [], reset: true }); }
          }, (error) => { signal.removeEventListener("abort", onAbort); reject(error); });
        });
      } catch (error) {
        if (signal.aborted) return;
        const result = failure(error);
        if ([401, 403, 404].includes(result.status)) {
          await emit({ type: "unavailable", retryable: false, code: result.code });
          return;
        }
        outcome = { type: "unavailable", retryable: true, code: result.code };
      }
      if (signal.aborted || outcome?.aborted) return;
      missed = true;
      await emit({ type: "offline", code: outcome.code ?? "device_offline" });
      await wait(delays[Math.min(attempt++, delays.length - 1)], undefined, { signal }).catch(() => {});
    }
  }

  return Object.freeze({ request, watch });
}
