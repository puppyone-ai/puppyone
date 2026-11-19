/**
 * How far the first send has got, read from Git's own progress output.
 *
 * `git push --progress` reports "Writing objects: 45% (555/1234), 12.34 MiB |
 * 1.02 MiB/s" on stderr, redrawn in place with carriage returns. That line is
 * the only honest measure there is: Git counts the share of objects written,
 * the bytes sent so far and the current rate. The total size is not known
 * until Git has finished, so nothing here claims one, and no time remaining is
 * derived from a total that does not exist.
 *
 * Git is run with LC_ALL=C (see `buildGitEnvironment`), so the English line
 * shape is stable.
 *
 * Reporting is observational: a malformed line is ignored, and a listener that
 * throws never reaches the push.
 */

const UNIT_BYTES = Object.freeze({ bytes: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3 });

const WRITING_LINE = /^Writing objects:\s+(\d{1,3})%\s+\((\d+)\/(\d+)\)(?:,\s+([\d.]+)\s+(bytes|KiB|MiB|GiB)(?:\s+\|\s+([\d.]+)\s+(bytes|KiB|MiB|GiB)\/s)?)?/;

/** Progress redraws from Git and from the receiving server, never diagnostics. */
const PROGRESS_LINE = /^(?:remote:\s+)?(?:Enumerating objects|Counting objects|Delta compression using|Compressing objects|Writing objects|Resolving deltas|Total \d+ \(delta)/;

/** At most this often, so a fast redraw does not flood the renderer. */
export const CLOUD_PUBLISH_TRANSFER_INTERVAL_MS = 250;

/**
 * @param {(transfer: { percent: number, sentBytes: number | null, bytesPerSecond: number | null }) => void} onTransfer
 */
export function createGitPushProgressReader(onTransfer, {
  now = Date.now,
  intervalMs = CLOUD_PUBLISH_TRANSFER_INTERVAL_MS,
} = {}) {
  let partial = "";
  let last = null;
  let lastReportedAt = Number.NEGATIVE_INFINITY;

  function report(transfer) {
    const at = now();
    const finished = transfer.percent >= 100;
    // The first reading and the last always go through; between them the
    // interval holds, and a reading identical to the last says nothing new.
    if (last && !finished && at - lastReportedAt < intervalMs) return;
    if (last && sameTransfer(last, transfer)) return;
    last = transfer;
    lastReportedAt = at;
    try {
      onTransfer(transfer);
    } catch {
      // Progress cannot participate in the push.
    }
  }

  function readSegment(segment) {
    const match = WRITING_LINE.exec(segment.trim());
    if (!match) return;
    // Git prints bytes and rate only once it has measured them; keep the last
    // known reading rather than letting the numbers blink out between redraws.
    report({
      percent: Math.max(0, Math.min(100, Number(match[1]))),
      sentBytes: toBytes(match[4], match[5]) ?? last?.sentBytes ?? null,
      bytesPerSecond: toBytes(match[6], match[7]) ?? last?.bytesPerSecond ?? null,
    });
  }

  return {
    /** Feed raw stderr text in whatever chunks the pipe delivers. */
    write(chunk) {
      partial += String(chunk);
      const segments = partial.split(/[\r\n]/);
      partial = segments.pop() ?? "";
      for (const segment of segments) readSegment(segment);
    },
  };
}

/**
 * Git's progress redraws removed from captured stderr, so a failure's
 * diagnostic is the error Git printed rather than the first few hundred
 * characters of "Counting objects".
 */
export function stripGitProgressOutput(text) {
  if (typeof text !== "string" && !Buffer.isBuffer(text)) return text;
  return String(text)
    .split(/[\r\n]+/)
    .filter((segment) => segment.trim() && !PROGRESS_LINE.test(segment.trim()))
    .join("\n");
}

function toBytes(value, unit) {
  if (value === undefined || unit === undefined) return null;
  const amount = Number(value);
  const scale = UNIT_BYTES[unit];
  if (!Number.isFinite(amount) || !scale) return null;
  return Math.round(amount * scale);
}

function sameTransfer(a, b) {
  return a.percent === b.percent && a.sentBytes === b.sentBytes && a.bytesPerSecond === b.bytesPerSecond;
}
