export const PROJECT_SESSION_CHANGED = "project-sessions:changed";

export function projectSessionError(code, message, retryable = false) {
  return Object.assign(new Error(message), { code, retryable });
}

export function projectSessionFailure(error) {
  return { projectFailure: {
    code: typeof error?.code === "string" ? error.code : "PROJECT_OPERATION_FAILED",
    message: String(error?.message ?? error).slice(0, 4000),
    retryable: error?.retryable === true,
  } };
}

export function unwrapProjectSessionResult(value) {
  if (!value || typeof value !== "object" || !Object.hasOwn(value, "projectFailure")) return value;
  const failure = value.projectFailure;
  if (!failure || typeof failure.code !== "string" || typeof failure.message !== "string" || typeof failure.retryable !== "boolean") throw new TypeError("Invalid project operation result.");
  throw projectSessionError(failure.code, failure.message, failure.retryable);
}

export function parseProjectSessionContext(value) {
  if (!value || typeof value !== "object") throw projectSessionError("PROJECT_CONTEXT_REQUIRED", "The project context is required.");
  for (const key of ["projectId", "generation", "rootPath"]) {
    if (typeof value[key] !== "string" || !value[key].trim() || value[key].length > 4096 || value[key].includes("\0")) {
      throw projectSessionError("PROJECT_CONTEXT_INVALID", "The project context is invalid.");
    }
  }
  return Object.freeze({ projectId: value.projectId, generation: value.generation, rootPath: value.rootPath });
}

export function assertProjectSessionSnapshot(value) {
  if (!value || typeof value.streamId !== "string" || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.projects)) {
    throw new TypeError("Invalid project session snapshot.");
  }
  for (const project of value.projects) {
    parseProjectSessionContext(project);
    if (!["open", "closing"].includes(project.state) || !Array.isArray(project.failures) || project.failures.some((failure) => typeof failure !== "string")) {
      throw new TypeError("Invalid project session state.");
    }
  }
  return value;
}
