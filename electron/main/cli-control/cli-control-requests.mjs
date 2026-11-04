import path from "node:path";
import {
  CLI_CONTROL_LIMITS,
  CLI_CONTROL_MIN_PROTOCOL,
  CLI_CONTROL_PROTOCOL,
} from "../../../shared/cli-control-contract/protocol.mjs";
import { OpenPathRejection } from "../system-open-route.mjs";

/**
 * Answers `hello` and `open`. Requests are untrusted input from another
 * process of the same user; nothing here reads or lists files for the caller.
 */
export function createCliControlRequests({
  app,
  openExtensions,
  openMaxBytes,
  openPath,
  whenWindowsAllowed = () => Promise.resolve(),
  logger = console,
  limits = CLI_CONTROL_LIMITS,
}) {
  const envelope = (fields) => ({
    ok: true,
    protocol: CLI_CONTROL_PROTOCOL,
    minProtocol: CLI_CONTROL_MIN_PROTOCOL,
    app,
    ...fields,
  });
  const failure = (code, message, fields = {}) => ({ ok: false, error: { code, message }, ...fields });

  async function open(request) {
    const { paths } = request;
    if (!Array.isArray(paths) || paths.length === 0 || paths.length > limits.maxPaths || !paths.every(isRequestPath)) {
      return failure("BAD_REQUEST", `Send 1 to ${limits.maxPaths} absolute paths.`);
    }
    if (request.activate !== undefined && typeof request.activate !== "boolean") {
      return failure("BAD_REQUEST", "activate must be true or false.");
    }
    const activate = request.activate !== false;
    await whenWindowsAllowed();
    const results = [];
    for (const requestedPath of paths) {
      try {
        const result = await openPath(requestedPath, { activate, enforceSizeLimit: true });
        results.push({ ...result, path: requestedPath });
      } catch (error) {
        if (!(error instanceof OpenPathRejection)) logger.error("Unable to open a path from the command line:", error);
        results.push({
          path: requestedPath,
          status: "rejected",
          error: error instanceof OpenPathRejection
            ? { code: error.code, message: error.message }
            : { code: "OPEN_FAILED", message: `${requestedPath} could not be opened.` },
        });
      }
    }
    return envelope({ results });
  }

  function isRequestPath(value) {
    return typeof value === "string"
      && value.length > 0
      && value.length <= limits.maxPathLength
      && !value.includes("\0")
      && path.isAbsolute(value);
  }

  return async function handle(request) {
    if (!request || typeof request !== "object" || Array.isArray(request) || !Number.isInteger(request.protocol)) {
      return failure("BAD_REQUEST", "The request is not a command-line request.");
    }
    if (request.protocol < CLI_CONTROL_MIN_PROTOCOL || request.protocol > CLI_CONTROL_PROTOCOL) {
      return failure("PROTOCOL_UNSUPPORTED", `PuppyOne speaks protocol ${CLI_CONTROL_MIN_PROTOCOL} to ${CLI_CONTROL_PROTOCOL}.`, {
        protocol: CLI_CONTROL_PROTOCOL,
        minProtocol: CLI_CONTROL_MIN_PROTOCOL,
        app,
      });
    }
    if (request.type === "hello") {
      return envelope({ open: { extensions: [...openExtensions], maxBytes: openMaxBytes } });
    }
    if (request.type === "open") return open(request);
    return failure("BAD_REQUEST", "Unknown request type.");
  };
}
