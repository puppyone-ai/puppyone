export function errorCode(error) {
  return error?.code || (error?.status ? "API_ERROR" : "UNEXPECTED");
}

export function errorMessage(error) {
  return error?.message || String(error);
}

export function pathError(command, path, error) {
  return `${command}: ${path || "."}: ${errorMessage(error)}`;
}

export function errorPayload(path, error) {
  return {
    path: path || ".",
    code: errorCode(error),
    message: errorMessage(error),
  };
}

export function finishWithPartialFailure(errors) {
  if (errors.length) process.exitCode = 1;
}
