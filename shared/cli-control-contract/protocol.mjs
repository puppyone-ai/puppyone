/**
 * The command-line protocol between `puppyone open` and Desktop. The CLI
 * repository implements the client side of this file, so every value here is
 * a cross-repository contract.
 */
export const CLI_CONTROL_PROTOCOL = 1;
export const CLI_CONTROL_MIN_PROTOCOL = 1;

/** Passed by the CLI when it starts Desktop to deliver one request. */
export const CLI_LAUNCH_ARGUMENT = "--puppyone-cli-launch";

export const CLI_CONTROL_LIMITS = Object.freeze({
  requestBytes: 64 * 1024,
  requestTimeoutMs: 5_000,
  maxPaths: 32,
  maxPathLength: 4_096,
  launchWaitMs: 10_000,
});

/** `Info.plist` keys the CLI reads before it starts Desktop. */
export const CLI_INFO_PLIST_KEYS = Object.freeze({
  protocol: "PuppyOneCliProtocol",
  userDataName: "PuppyOneCliUserDataName",
  openExtensions: "PuppyOneOpenExtensions",
  openMaxBytes: "PuppyOneOpenMaxBytes",
});

export const CLI_CONTROL_ERROR_CODES = Object.freeze([
  "BAD_REQUEST",
  "PROTOCOL_UNSUPPORTED",
  "PATH_NOT_FOUND",
  "NOT_A_FILE_OR_FOLDER",
  "UNSUPPORTED_TYPE",
  "FILE_TOO_LARGE",
  "OPEN_FAILED",
]);
