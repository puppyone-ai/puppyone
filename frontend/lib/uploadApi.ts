/**
 * Upload API — backend-proxied multipart uploads.
 *
 * Pipeline (all four steps go through the same-origin Next.js proxy
 * at ``/api/ingest`` to keep CORS out of the picture):
 *
 *   1. ``initMultipartUpload`` (POST /upload/init)
 *      Backend creates the S3 multipart session and a pending task.
 *      Returns ``upload_id`` + ``s3_key`` + ``total_parts``. NO
 *      presigned URLs — parts are PUT through the proxy.
 *
 *   2. ``uploadParts`` (PUT /upload/part?task_id=...&part_number=...)
 *      Browser slices the file and PUTs each part body to the
 *      backend, which forwards to S3 server-side via boto3
 *      ``upload_part`` and returns the ``ETag``. Concurrent up to
 *      ``CONCURRENT_PARTS`` parts per file. Progress is reported
 *      from ``XHR.upload.progress``.
 *
 *   3. ``completeMultipartUploadBatch`` (POST /upload/complete-batch)
 *      Backend runs ``CompleteMultipartUpload`` per file then a
 *      single version bulk_write commit. One commit per drag, no matter
 *      how many files were in the drop.
 *
 *   4. ``abortMultipartUpload`` (POST /upload/abort)
 *      Cancel-path: drops the in-flight multipart on S3 and marks
 *      the task cancelled. Idempotent.
 *
 * Why proxy instead of direct-to-S3?
 *   See ``backend/src/ingest/router.py`` protocol comment. TL;DR:
 *   Supabase Storage's S3 endpoint can't be CORS-configured, so
 *   direct browser PUTs would fail there no matter what. Proxying
 *   through FastAPI works on every backend (Supabase / AWS / R2 /
 *   LocalStack) at the cost of ~15-30% extra latency. For
 *   reliability-critical large uploads, point users to the local
 *   sync daemon instead.
 */

import { getAccessToken } from './apiClient';

// ----- Tunables --------------------------------------------------

/**
 * Max parallel part uploads per file. 4 is the AWS SDK default and
 * a good sweet spot — too high saturates the user's connection and
 * confuses progress reporting; too low leaves bandwidth on the table.
 */
const CONCURRENT_PARTS = 4;

/**
 * Default chunk size when the caller doesn't specify. 8 MiB matches
 * the backend default and stays well above AWS's 5 MiB minimum
 * (every part except the last must be >= 5 MiB).
 */
const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024;

/**
 * Number of times to attempt each part PUT before giving up.
 * Generous because:
 *   - Mobile / hotel wifi flakes regularly. Failing on the 4th
 *     attempt forces a full file re-upload, wasting bandwidth the
 *     user already paid for.
 *   - We deliberately fail fast (in milliseconds) on errors that
 *     are clearly non-transient — auth failures, 4xx from S3,
 *     etc. — so retries are reserved for the network blips that
 *     actually benefit from one.
 *   - Network-offline events suspend retries entirely; they don't
 *     count against the budget.
 */
const PUT_MAX_ATTEMPTS = 10;

/**
 * Cap for exponential-backoff sleep between part-PUT attempts.
 * Without this cap a 10th retry would sleep for ~17 minutes
 * (1024s) before trying — long enough that the user is convinced
 * the upload is broken. 60s lets us retry an in-flight outage
 * without making the UI feel hung.
 */
const RETRY_BACKOFF_CAP_MS = 60 * 1000;

// ----- Wire types (mirror backend schemas) -----------------------

export interface UploadInitFileRequest {
  filename: string;
  size: number;
  content_type: string | null;
  parent_path: string | null;
}

export interface UploadInitFileResponse {
  task_id: string;
  filename: string;
  s3_key: string;
  upload_id: string;
  chunk_size: number;
  total_parts: number;
}

export interface UploadInitResponse {
  files: UploadInitFileResponse[];
}

interface UploadPartResponse {
  part_number: number;
  etag: string;
}

export interface UploadCompleteResponse {
  task_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  path: string | null;
}

export interface UploadCompleteItemResult {
  task_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  path: string | null;
  error: string | null;
}

export interface UploadCompleteBatchResponse {
  items: UploadCompleteItemResult[];
}

// ----- Folder-aware path derivation ------------------------------

/**
 * Derive the per-file version ``parent_path`` from a base drop target
 * and the file's ``webkitRelativePath``.
 *
 * The whole point: when a user drops a folder, we want the folder
 * structure to land in Version Engine EXACTLY as it sits on disk. Concretely:
 *
 *   drop ``general/`` containing ``general/sub/foo.pdf``
 *   into the project at base = ``"docs"``
 *   → upload as ``docs/general/sub/foo.pdf`` (preserving hierarchy)
 *
 * The backend's init endpoint joins ``parent_path/<basename>`` and
 * intentionally strips any directory components from ``filename``
 * (``Path(f.filename).name``). So all the folder-structure
 * information has to ride on ``parent_path``.
 *
 * Three input shapes we handle:
 *   1. ``webkitRelativePath = ""`` (single dropped/picked file) →
 *      use the base path as-is. No folder context to preserve.
 *   2. ``webkitRelativePath = "foo.pdf"`` (top-level file in a
 *      dropped folder, but the folder itself was the drop unit) →
 *      no slash, treat like a flat file.
 *   3. ``webkitRelativePath = "general/sub/foo.pdf"`` → strip the
 *      basename, append the directory part to the base path.
 *
 * Backend joining rules (see ``backend/src/ingest/router.py``):
 *   - empty/None parent_path → mount at root
 *   - non-empty → ``f"{parent_path}/{basename}"`` (after stripping
 *     leading/trailing slashes)
 * We mirror those rules here so we never produce a doubled or
 * missing slash.
 */
function deriveFileParentPath(
  basePath: string | null,
  webkitRelativePath: string | undefined,
): string | null {
  const rel = (webkitRelativePath ?? '').trim();
  // Strip leading "./" or "/" so callers (or browsers) that include
  // them don't poison the join. ``webkitRelativePath`` is supposed
  // to be a forward-slash relative path with no leading slash, but
  // some sources we synthesize via ``Object.defineProperty`` could
  // drift; defending here is cheap.
  const cleanRel = rel.replace(/^\.?\/+/, '');

  // Cases 1 & 2: no directory portion in the relative path → just
  // use the base path verbatim.
  const lastSlash = cleanRel.lastIndexOf('/');
  if (lastSlash < 0) {
    return basePath && basePath.length > 0 ? basePath : null;
  }

  const relativeDir = cleanRel.slice(0, lastSlash);
  if (relativeDir.length === 0) {
    return basePath && basePath.length > 0 ? basePath : null;
  }

  if (!basePath || basePath.length === 0) {
    return relativeDir;
  }
  // Normalize: drop any trailing slash from the base + leading
  // slash from the relative dir (defensive — shouldn't happen but
  // bugs in callers / browsers that double-normalize cost us
  // surprisingly little to absorb).
  const base = basePath.replace(/\/+$/, '');
  const dir = relativeDir.replace(/^\/+/, '');
  return `${base}/${dir}`;
}

// ----- Online/offline gating -------------------------------------

/**
 * Suspend a retry backoff sleep while the browser is offline.
 *
 * Critically, this is ONLY consulted between attempts — never on
 * the first attempt of a part. ``navigator.onLine`` is unreliable
 * on macOS / certain VPN setups (it can read ``false`` while the
 * network is actually fine), and an upfront block-and-wait based on
 * it would hang the upload at "0%" forever. Doing the check post-
 * failure means even if ``navigator.onLine`` is wrong, we still
 * burn at most one retry per attempt rather than hanging.
 */
function sleepWithOnlineGate(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    let onOnline: (() => void) | null = null;
    let onAbort: (() => void) | null = null;

    const cleanup = () => {
      if (timer !== null) clearTimeout(timer);
      if (onOnline)
        window.removeEventListener('online', onOnline);
      if (onAbort) signal?.removeEventListener('abort', onAbort);
    };

    onAbort = () => {
      cleanup();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort);

    timer = setTimeout(() => {
      // After the planned sleep, only KEEP waiting if the browser
      // currently reports offline. If ``navigator.onLine`` is
      // unreliable (macOS quirk), we still resolve here on the next
      // ``online`` event — but in the worst case we resolve after a
      // single timer fires regardless.
      if (
        typeof navigator !== 'undefined' &&
        navigator.onLine === false
      ) {
        onOnline = () => {
          cleanup();
          resolve();
        };
        window.addEventListener('online', onOnline);
      } else {
        cleanup();
        resolve();
      }
    }, ms);
  });
}

// ----- Step 1: init ----------------------------------------------

export async function initMultipartUpload(
  params: {
    projectId: string;
    files: Array<{
      filename: string;
      size: number;
      contentType: string | null;
      parentPath: string | null;
    }>;
    chunkSize?: number;
  },
  accessToken: string,
): Promise<UploadInitResponse> {
  const body = {
    project_id: params.projectId,
    chunk_size: params.chunkSize ?? DEFAULT_CHUNK_SIZE,
    files: params.files.map(
      (f): UploadInitFileRequest => ({
        filename: f.filename,
        size: f.size,
        content_type: f.contentType,
        parent_path: f.parentPath,
      }),
    ),
  };

  const response = await fetch('/api/ingest?path=upload/init', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(
      `upload/init failed (${response.status}): ${await response.text()}`,
    );
  }
  return (await response.json()) as UploadInitResponse;
}

// ----- Step 2: PUT parts to backend proxy ------------------------

interface UploadedPart {
  part_number: number;
  etag: string;
}

/**
 * PUT each part to the backend ``/upload/part`` endpoint with a
 * small worker pool.
 *
 * - Progress: tracked per-part via ``XHR.upload.progress``; the
 *   public callback receives aggregate ``loaded/total/percent``
 *   summed across all parts of THIS file.
 * - Cancellation: pass an ``AbortSignal``; aborting fires
 *   ``xhr.abort()`` on every in-flight request. The returned promise
 *   rejects with a DOMException of name ``AbortError`` so callers
 *   can branch on cancel vs failure.
 * - Retry: per-part exponential backoff up to ``PUT_MAX_ATTEMPTS``,
 *   with the sleep capped at ``RETRY_BACKOFF_CAP_MS``. Network-
 *   offline events suspend the retry loop until back online.
 */
export async function uploadParts(
  file: File,
  init: UploadInitFileResponse,
  accessToken: string,
  options: {
    signal?: AbortSignal;
    onProgress?: (loaded: number, total: number, percent: number) => void;
  } = {},
): Promise<UploadedPart[]> {
  const { signal, onProgress } = options;
  const { task_id, chunk_size, total_parts } = init;
  const total = file.size;

  // One-line confirmation that the proxy-based upload path is the one
  // running in this tab. If this DOESN'T print when an upload starts,
  // the browser is serving a stale bundle and a hard-refresh is
  // required for HMR to pick up the new module.
  // eslint-disable-next-line no-console
  console.info(
    `[upload] Starting ${file.name} via /api/ingest proxy: ` +
      `${total_parts} part(s), chunk_size=${chunk_size}, total=${total}`,
  );

  // Defensive: if the backend's response shape drifts and
  // ``total_parts`` isn't a positive integer, every worker's
  // ``while (1 <= total_parts)`` would short-circuit and we'd
  // silently produce zero uploaded parts — a state that explodes
  // later at the finalize step with a confusing 422. Crash early
  // with an actionable message instead.
  if (
    typeof total_parts !== 'number' ||
    !Number.isFinite(total_parts) ||
    total_parts < 1
  ) {
    throw new Error(
      `upload/init returned invalid total_parts=${String(total_parts)} ` +
        `for ${file.name} — backend may be running pre-proxy code`,
    );
  }

  // Aggregate progress: each part reports its own ``loaded`` to this
  // map; sum across the map gives total uploaded bytes for the file.
  const partProgress = new Map<number, number>();

  const reportProgress = () => {
    if (!onProgress) return;
    let loaded = 0;
    for (const v of partProgress.values()) loaded += v;
    const percent =
      total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 100;
    onProgress(loaded, total, percent);
  };

  const uploadOnePartOnce = (partNumber: number): Promise<UploadedPart> => {
    const start = (partNumber - 1) * chunk_size;
    const end = Math.min(start + chunk_size, total);
    const blob = file.slice(start, end);
    const partSize = blob.size;

    return new Promise<UploadedPart>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const url =
        `/api/ingest?path=upload/part&task_id=${encodeURIComponent(task_id)}` +
        `&part_number=${partNumber}`;
      xhr.open('PUT', url, true);
      xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
      // octet-stream is the safe default for binary slice bodies;
      // the backend ignores Content-Type on /upload/part anyway —
      // the body bytes go straight to S3 ``upload_part``.
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          partProgress.set(partNumber, e.loaded);
          reportProgress();
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          let parsed: UploadPartResponse | undefined;
          try {
            parsed = JSON.parse(xhr.responseText) as UploadPartResponse;
          } catch {
            // Backend always returns JSON on 2xx — a parse failure
            // here usually means a misconfigured proxy injected an
            // HTML error page. Fall back to the raw response so the
            // surfaced error is at least debuggable.
            reject(
              new Error(
                `Part ${partNumber}: backend returned non-JSON 2xx — ` +
                  `${xhr.responseText.slice(0, 200)}`,
              ),
            );
            return;
          }
          if (!parsed?.etag) {
            reject(
              new Error(
                `Part ${partNumber}: backend response missing etag`,
              ),
            );
            return;
          }
          partProgress.set(partNumber, partSize);
          reportProgress();
          resolve({ part_number: partNumber, etag: parsed.etag });
        } else {
          // 4xx is mostly auth / state errors that won't get better
          // on retry; 5xx is mostly transient. We mark 4xx as
          // non-retryable so the user sees the actionable failure
          // immediately instead of waiting for the retry budget to
          // drain.
          const body = (xhr.responseText || '').slice(0, 400);
          const err = new Error(
            `Part ${partNumber} PUT failed: ${xhr.status} ${xhr.statusText}` +
              (body ? ` — ${body}` : ''),
          );
          if (xhr.status >= 400 && xhr.status < 500 && xhr.status !== 408) {
            (err as Error & { nonRetryable?: boolean }).nonRetryable = true;
          }
          reject(err);
        }
      };
      xhr.onerror = () => {
        // ``onerror`` fires for failures the browser refuses to
        // surface details for (TLS handshake, DNS, transient network
        // drop, network offline). All of these are retryable — we
        // expect the retry loop to clear them once the network
        // comes back. Same-origin so CORS isn't a possibility.
        reject(
          new Error(
            `Part ${partNumber} PUT failed at network layer ` +
              `(status=${xhr.status}). Likely a transient network ` +
              `drop — retrying...`,
          ),
        );
      };
      xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));

      if (signal) {
        if (signal.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        signal.addEventListener('abort', () => xhr.abort(), { once: true });
      }

      xhr.send(blob);
    });
  };

  const uploadOnePart = async (partNumber: number): Promise<UploadedPart> => {
    let lastError: unknown;
    for (let attempt = 0; attempt < PUT_MAX_ATTEMPTS; attempt++) {
      // Always attempt immediately — DO NOT pre-gate on
      // ``navigator.onLine``. That signal is unreliable on macOS /
      // certain VPN setups and gating upfront would hang the upload
      // at "0%" forever. Let XHR fail naturally if the network
      // really is down; the retry loop's backoff sleep handles the
      // outage gracefully.
      try {
        return await uploadOnePartOnce(partNumber);
      } catch (err) {
        // Caller-driven aborts must propagate immediately; retrying
        // an aborted part would silently re-upload past a cancel.
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw err;
        }
        // Auth / state-mismatch errors will fail identically on
        // every retry — fail fast so the user sees the actionable
        // message immediately instead of waiting for the budget to
        // drain.
        if (
          typeof err === 'object' &&
          err !== null &&
          (err as { nonRetryable?: boolean }).nonRetryable === true
        ) {
          throw err;
        }
        lastError = err;
        if (attempt < PUT_MAX_ATTEMPTS - 1) {
          // Exponential backoff with jitter, capped. 250ms, 750ms,
          // ..., capped at ``RETRY_BACKOFF_CAP_MS``. The jitter
          // (max 25% of base) prevents thundering-herd retries when
          // multiple concurrent parts fail together.
          const base = Math.min(
            250 * Math.pow(2, attempt),
            RETRY_BACKOFF_CAP_MS,
          );
          const delay = base + Math.random() * Math.min(base * 0.25, 1000);
          // Reset the part's progress: a partial upload from the
          // failed attempt would otherwise leave the aggregate
          // progress percentage looking wrong (e.g. >100%).
          partProgress.set(partNumber, 0);
          reportProgress();
          // Sleep with an online gate: if the browser STARTS the
          // sleep online but the network drops mid-sleep, we'll
          // still resolve at the timer's expiry; if it's offline at
          // expiry we wait for the next ``online`` event. Either
          // way no upfront hang.
          await sleepWithOnlineGate(delay, signal);
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`Part ${partNumber} PUT exhausted retries`);
  };

  // Bounded-concurrency worker pool. Each worker picks the next
  // unclaimed part number off ``cursor`` until everything is done.
  const uploaded: UploadedPart[] = [];
  let cursor = 1;
  const worker = async () => {
    while (cursor <= total_parts) {
      const partNumber = cursor++;
      const result = await uploadOnePart(partNumber);
      uploaded.push(result);
    }
  };
  const workers = Array.from(
    { length: Math.min(CONCURRENT_PARTS, total_parts) },
    () => worker(),
  );
  await Promise.all(workers);

  // Sort by part_number so the final ``CompleteMultipartUpload``
  // call ships parts in the order S3 expects.
  uploaded.sort((a, b) => a.part_number - b.part_number);
  return uploaded;
}

// ----- Step 3: complete ------------------------------------------

export async function completeMultipartUpload(
  params: {
    taskId: string;
    s3Key: string;
    uploadId: string;
    parts: UploadedPart[];
  },
  accessToken: string,
): Promise<UploadCompleteResponse> {
  const response = await fetch('/api/ingest?path=upload/complete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      task_id: params.taskId,
      s3_key: params.s3Key,
      upload_id: params.uploadId,
      parts: params.parts,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `upload/complete failed (${response.status}): ${await response.text()}`,
    );
  }
  return (await response.json()) as UploadCompleteResponse;
}

/**
 * Batch finalize: ship N completed multipart uploads to the backend
 * in a single round-trip. The backend collapses them into ONE
 * project-root version-control commit (instead of N), which:
 *   * cuts wall-clock for an N-file folder upload from ``N × ~2s``
 *     to ``~2s + a few ms per file``
 *   * collapses N near-identical "Upload foo.pdf" entries in the
 *     audit log into a single "Upload N files" entry
 *
 * Partial-success contract: the response always contains one entry
 * per input item, including failures. Callers MUST walk
 * ``response.items`` and surface successes/failures per-file rather
 * than treating the whole call as one transaction.
 */
export async function completeMultipartUploadBatch(
  items: Array<{
    taskId: string;
    s3Key: string;
    uploadId: string;
    parts: UploadedPart[];
  }>,
  accessToken: string,
): Promise<UploadCompleteBatchResponse> {
  const response = await fetch('/api/ingest?path=upload/complete-batch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      items: items.map((it) => ({
        task_id: it.taskId,
        s3_key: it.s3Key,
        upload_id: it.uploadId,
        parts: it.parts,
      })),
    }),
  });

  if (!response.ok) {
    throw new Error(
      `upload/complete-batch failed (${response.status}): ${await response.text()}`,
    );
  }
  return (await response.json()) as UploadCompleteBatchResponse;
}

// ----- Step 4: abort ---------------------------------------------

export async function abortMultipartUpload(
  params: { taskId: string; s3Key: string; uploadId: string },
  accessToken: string,
): Promise<void> {
  // Best-effort: we don't surface failures to the caller because
  // there's nothing useful they can do with that info. The backend
  // logs the failure and the task transitions to CANCELLED anyway.
  try {
    await fetch('/api/ingest?path=upload/abort', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        task_id: params.taskId,
        s3_key: params.s3Key,
        upload_id: params.uploadId,
      }),
    });
  } catch (e) {
    console.warn('[uploadApi] abort failed:', e);
  }
}

// ----- High-level orchestration ----------------------------------

export interface UploadFileResult {
  taskId: string;
  filename: string;
  status: 'completed' | 'failed' | 'aborted';
  error?: string;
}

export interface UploadFilesCallbacks {
  /**
   * Fired SYNCHRONOUSLY before ``/upload/init`` is even called. Use
   * this to spawn placeholder rows in the task widget so the user
   * sees instant feedback — without it, init can take 2–5s on a
   * cold backend and the UI feels frozen.
   *
   * Each entry's ``fileIndex`` matches the index in ``params.files``
   * and will be passed back through ``onTaskCreated`` once the real
   * ``task_id`` is known, so callers can swap their placeholder ID
   * for the real one.
   */
  onUploadStart?: (
    files: Array<{ fileIndex: number; filename: string; size: number }>,
  ) => void;
  /**
   * Fired once per file as soon as the backend assigns a real
   * ``task_id``. Use this to upgrade your placeholder row (spawned
   * in ``onUploadStart``) to the real ID — later progress / poll
   * events all flow against the real ID. ``fileIndex`` matches
   * ``onUploadStart`` so callers can correlate.
   */
  onTaskCreated?: (info: {
    fileIndex: number;
    taskId: string;
    filename: string;
    size: number;
  }) => void;
  /**
   * Per-tick progress (debounced by browser to ~1/100ms). Use to
   * drive a per-file progress bar.
   */
  onProgress?: (
    taskId: string,
    loaded: number,
    total: number,
    percent: number,
  ) => void;
  /**
   * Every part is up in S3, but ``/upload/complete`` hasn't returned
   * yet — the backend is now downloading the assembled object from
   * S3 and writing it into Version Engine. For non-trivial files this can take
   * several seconds; without a distinct UI state the row reads as
   * "Uploading 100%" while nothing visibly changes, which users
   * (rightfully) interpret as "stuck".
   *
   * Use this to flip your task row to a ``finalizing`` state with a
   * "Finalizing…" label so the user knows the work is in flight on
   * the server, just not on their uplink anymore.
   */
  onAllPartsUploaded?: (taskId: string) => void;
  /**
   * ``/upload/complete`` returned 200 — the file is in Version Engine and the
   * task row is COMPLETED in the database. Safe to mark the local
   * task ``completed`` directly without polling.
   */
  onTaskCompleted?: (taskId: string) => void;
  /** Either the part upload itself or /upload/complete failed. */
  onTaskFailed?: (taskId: string, error: string) => void;
  /**
   * Optional global abort signal. Cancels every in-flight PUT and
   * stops processing remaining files in the batch.
   */
  signal?: AbortSignal;
}

/**
 * Drive a full browser → backend → S3 → Version Engine upload pipeline for a
 * batch of files.
 *
 * Files are processed sequentially per-batch; per-file we use
 * ``CONCURRENT_PARTS`` parallel PUTs. Running multiple files in
 * parallel on top of part-level concurrency would multiply
 * connection pressure without much speedup since the user's
 * uplink is usually the bottleneck.
 */
export async function uploadFiles(
  params: {
    projectId: string;
    files: File[];
    parentPath: string | null;
    chunkSize?: number;
  },
  accessToken: string,
  callbacks: UploadFilesCallbacks = {},
): Promise<UploadFileResult[]> {
  // Pre-init: tell the caller the upload has *started* so they can
  // render placeholder rows synchronously. Without this the user
  // sees nothing for the multi-second init round-trip.
  callbacks.onUploadStart?.(
    params.files.map((f, i) => ({
      fileIndex: i,
      filename: f.name,
      size: f.size,
    })),
  );

  // Refresh the access token before talking to the backend.
  //
  // The caller hands us ``accessToken`` from a React state snapshot
  // (``session?.access_token``), which goes stale the moment Supabase
  // rotates it — by default that's every 1h. A tab the user left
  // open over lunch will hand us a long-expired JWT, the backend
  // returns 401, and the upload fails before any PUT goes out.
  //
  // ``getAccessToken`` is implemented on top of
  // ``supabase.auth.getSession()`` which auto-refreshes when the
  // current token is past its half-life, so this is effectively a
  // no-op for fresh sessions and a silent recovery for stale ones.
  // We still fall back to the passed token if Supabase is somehow
  // unreachable — better to send something and fail with a clean
  // 401 than swallow the upload entirely.
  let effectiveToken = accessToken;
  try {
    const fresh = await getAccessToken();
    if (fresh) effectiveToken = fresh;
  } catch {
    // keep effectiveToken as-is
  }

  // Step 1 — init for the whole batch. One round-trip allocates all
  // task_ids upfront. Per-file ``parentPath`` is derived from each
  // file's ``webkitRelativePath`` so dropping a folder preserves
  // its internal hierarchy in Version Engine (instead of flattening every
  // file to the same destination directory).
  const init = await initMultipartUpload(
    {
      projectId: params.projectId,
      files: params.files.map((f) => ({
        filename: f.name,
        size: f.size,
        contentType: f.type || null,
        parentPath: deriveFileParentPath(
          params.parentPath,
          f.webkitRelativePath,
        ),
      })),
      chunkSize: params.chunkSize,
    },
    effectiveToken,
  );

  // Hand real task_ids back to the caller so they can swap their
  // placeholder rows over before any PUT progress starts firing
  // against the real IDs.
  for (let i = 0; i < init.files.length; i++) {
    callbacks.onTaskCreated?.({
      fileIndex: i,
      taskId: init.files[i].task_id,
      filename: init.files[i].filename,
      size: params.files[i].size,
    });
  }

  const results: UploadFileResult[] = [];

  // Phase A — PUT every file's parts. We process files sequentially
  // (per-file we still use ``CONCURRENT_PARTS`` parallel PUTs)
  // because parallelizing across files just multiplies connection
  // pressure on the user's uplink with no real speedup.
  // Successful files are gathered for one batch finalize at the end.
  const finalizeQueue: Array<{
    initFile: UploadInitFileResponse;
    parts: UploadedPart[];
  }> = [];
  let userAborted = false;

  for (let i = 0; i < init.files.length; i++) {
    const initFile = init.files[i];
    const file = params.files[i];

    try {
      const uploadedParts = await uploadParts(file, initFile, effectiveToken, {
        signal: callbacks.signal,
        onProgress: (loaded, total, percent) => {
          callbacks.onProgress?.(initFile.task_id, loaded, total, percent);
        },
      });

      // The user's bytes are all in S3 now — flip to a "Finalizing"
      // state so the row doesn't sit visibly stuck at "Uploading
      // 100%" while we wait for the rest of the batch + the
      // server-side commit.
      callbacks.onAllPartsUploaded?.(initFile.task_id);

      finalizeQueue.push({ initFile, parts: uploadedParts });
    } catch (err: unknown) {
      const isAbort =
        err instanceof DOMException && err.name === 'AbortError';
      const error = err instanceof Error ? err.message : String(err);

      // Best-effort cleanup so we don't leave a half-finished
      // multipart upload on the bucket. AWS keeps these forever
      // unless the bucket has a lifecycle rule.
      await abortMultipartUpload(
        {
          taskId: initFile.task_id,
          s3Key: initFile.s3_key,
          uploadId: initFile.upload_id,
        },
        effectiveToken,
      );

      const status: UploadFileResult['status'] = isAbort
        ? 'aborted'
        : 'failed';
      if (status === 'failed') {
        callbacks.onTaskFailed?.(initFile.task_id, error);
      }
      results.push({
        taskId: initFile.task_id,
        filename: initFile.filename,
        status,
        error,
      });

      // If the user aborted, stop the loop — they almost certainly
      // want everything cancelled, not just this one file. But we
      // still finalize anything that already finished its PUTs;
      // they paid the bandwidth, no reason to discard the work.
      if (isAbort) {
        userAborted = true;
        break;
      }
    }
  }

  // Phase B — ONE batch finalize for every file whose PUTs landed.
  // The backend collapses N files into one version commit (one entry in
  // the audit log saying "Upload N files" rather than N near-
  // identical entries). Wall-clock cost is roughly fixed at "one
  // commit" rather than "N commits".
  if (finalizeQueue.length > 0) {
    try {
      const batchResp = await completeMultipartUploadBatch(
        finalizeQueue.map(({ initFile, parts }) => ({
          taskId: initFile.task_id,
          s3Key: initFile.s3_key,
          uploadId: initFile.upload_id,
          parts,
        })),
        effectiveToken,
      );

      // Walk per-item results — partial success is normal: one bad
      // file (mount path collision, ETag mismatch) doesn't poison
      // the rest of the batch.
      const resultByTaskId = new Map(
        batchResp.items.map((r) => [r.task_id, r] as const),
      );
      for (const { initFile } of finalizeQueue) {
        const r = resultByTaskId.get(initFile.task_id);
        if (r && r.status === 'completed') {
          callbacks.onTaskCompleted?.(initFile.task_id);
          results.push({
            taskId: initFile.task_id,
            filename: initFile.filename,
            status: 'completed',
          });
        } else {
          const error =
            r?.error || `Finalize failed (status=${r?.status ?? 'unknown'})`;
          callbacks.onTaskFailed?.(initFile.task_id, error);
          results.push({
            taskId: initFile.task_id,
            filename: initFile.filename,
            status: 'failed',
            error,
          });
        }
      }
    } catch (err: unknown) {
      // Whole batch finalize failed (e.g. backend down, 5xx, network
      // drop). Mark every queued file as failed so the UI doesn't
      // sit at "Finalizing…" forever — the user can retry the
      // upload. The bytes are still in S3 staging; a future "resume"
      // path could hand them back to the backend without re-PUTing.
      const error = err instanceof Error ? err.message : String(err);
      for (const { initFile } of finalizeQueue) {
        callbacks.onTaskFailed?.(initFile.task_id, error);
        results.push({
          taskId: initFile.task_id,
          filename: initFile.filename,
          status: 'failed',
          error,
        });
      }
    }
  }

  // Mark any files we never even started PUTing (because the user
  // aborted mid-batch) as aborted so the caller knows they're done.
  if (userAborted) {
    for (let i = 0; i < init.files.length; i++) {
      const initFile = init.files[i];
      if (results.some((r) => r.taskId === initFile.task_id)) continue;
      results.push({
        taskId: initFile.task_id,
        filename: initFile.filename,
        status: 'aborted',
      });
      // Best-effort cleanup of the unstarted multipart on S3.
      await abortMultipartUpload(
        {
          taskId: initFile.task_id,
          s3Key: initFile.s3_key,
          uploadId: initFile.upload_id,
        },
        effectiveToken,
      );
    }
  }

  return results;
}

/**
 * Convenience wrapper that pulls the access token from the auth
 * provider. Use when you don't already have a token in scope.
 */
export async function uploadFilesWithAuth(
  params: Parameters<typeof uploadFiles>[0],
  callbacks: UploadFilesCallbacks = {},
): Promise<UploadFileResult[]> {
  const token = await getAccessToken();
  if (!token) {
    throw new Error('Not authenticated');
  }
  return uploadFiles(params, token, callbacks);
}
