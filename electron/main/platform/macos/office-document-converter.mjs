import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveExistingWorkspacePath } from "../../../../local-api/files/path-policy.mjs";

const MAX_OFFICE_CONVERSION_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_OFFICE_CONVERSION_OUTPUT_BYTES = 8 * 1024 * 1024;
const OFFICE_CONVERSION_TIMEOUT_MS = 8000;

export async function convertMacosOfficeDocumentToDocx(rootPath, relativePath, options = undefined) {
  if (options?.signal?.aborted) {
    throw new Error("Office conversion was cancelled.");
  }

  const filePath = await resolveExistingWorkspacePath(rootPath, relativePath);
  const metadata = await fs.stat(filePath).catch((error) => {
    throw new Error(`Unable to read file metadata: ${error.message}`);
  });
  if (metadata.isDirectory()) throw new Error("Selected path is a folder.");
  if (metadata.size > MAX_OFFICE_CONVERSION_INPUT_BYTES) {
    throw new Error(`File is larger than the ${formatFileSize(MAX_OFFICE_CONVERSION_INPUT_BYTES)} Office preview limit.`);
  }

  const extension = path.extname(filePath).toLowerCase();
  if (extension !== ".doc" && extension !== ".rtf") {
    throw new Error("Only .doc and .rtf files can be converted by this preview bridge.");
  }

  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-office-"));
  const outputPath = path.join(temporaryDirectory, `${path.basename(filePath, extension)}.docx`);
  try {
    const result = await execFileUntilClosed("textutil", ["-convert", "docx", filePath, "-output", outputPath], {
      encoding: "utf8",
      maxBuffer: MAX_OFFICE_CONVERSION_OUTPUT_BYTES,
      timeout: OFFICE_CONVERSION_TIMEOUT_MS,
      windowsHide: true,
      signal: options?.signal,
    }).catch((error) => {
      if (options?.signal?.aborted || error?.name === "AbortError" || error?.code === "ABORT_ERR") {
        throw new Error("Office conversion was cancelled.");
      }
      if (error?.killed || error?.signal === "SIGTERM") {
        throw new Error("Office conversion timed out.");
      }
      if (error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
        throw new Error(`Office conversion output exceeded the ${formatFileSize(MAX_OFFICE_CONVERSION_OUTPUT_BYTES)} process output limit.`);
      }
      throw new Error(`Office conversion failed: ${error.message}`);
    });

    const outputMetadata = await fs.stat(outputPath).catch((error) => {
      throw new Error(`Office conversion did not produce a DOCX file: ${error.message}`);
    });
    if (!outputMetadata.isFile()) throw new Error("Office conversion did not produce a DOCX file.");
    if (outputMetadata.size > MAX_OFFICE_CONVERSION_INPUT_BYTES) {
      throw new Error(`Converted DOCX is larger than the ${formatFileSize(MAX_OFFICE_CONVERSION_INPUT_BYTES)} Office preview limit.`);
    }

    return {
      bytes: await fs.readFile(outputPath),
      warnings: String(result.stderr ?? "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    };
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

// Abort can deliver execFile's callback before its child emits close. Keep the
// conversion registered and its temporary files alive until the actual exit.
async function execFileUntilClosed(file, args, options) {
  let child;
  let confirmExit;
  const exited = new Promise((resolve) => { confirmExit = resolve; });
  const outcome = new Promise((resolve, reject) => {
    child = execFile(file, args, options, (error, stdout, stderr) => {
      if (error) reject(error);
      else resolve({ stdout, stderr });
    });
    child.once("close", confirmExit);
  });
  // A synchronous spawn failure never allocated a child.
  if (!child) return outcome;
  const forceExit = () => {
    try { child.kill("SIGKILL"); } catch { /* Exit remains unconfirmed until close. */ }
  };
  let cancelDeadline;
  const cancel = () => { cancelDeadline ??= setTimeout(forceExit, 2_000); };
  const executionDeadline = setTimeout(forceExit, OFFICE_CONVERSION_TIMEOUT_MS + 2_000);
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) cancel();
  try { return await outcome; }
  finally {
    await exited;
    clearTimeout(executionDeadline);
    clearTimeout(cancelDeadline);
    options.signal?.removeEventListener("abort", cancel);
  }
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}
