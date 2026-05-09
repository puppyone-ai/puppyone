import { ApiError } from "../../../api.js";

export function parseIntegerOption(value, optionName) {
  const raw = String(value ?? "").trim();
  if (!/^-?\d+$/.test(raw)) {
    throw new ApiError(0, "INVALID_OPTION", `${optionName} must be an integer.`);
  }
  return Number.parseInt(raw, 10);
}

export function parseTreeLevel(value) {
  const level = parseIntegerOption(value, "-L/--level");
  if (level < -1 || level === 0) {
    throw new ApiError(0, "INVALID_LEVEL", "Tree level must be -1 or a positive integer.");
  }
  return level < 0 ? -1 : level - 1;
}

export function parseBackendDepth(value) {
  const depth = parseIntegerOption(value, "--depth");
  if (depth < -1) {
    throw new ApiError(0, "INVALID_DEPTH", "Tree depth must be -1 or greater.");
  }
  return depth;
}

export function parseNonNegativeOption(value, optionName) {
  const parsed = parseIntegerOption(value, optionName);
  if (parsed < 0) {
    throw new ApiError(0, "INVALID_OPTION", `${optionName} must be zero or greater.`);
  }
  return parsed;
}

export function parsePositiveOption(value, optionName) {
  const parsed = parseIntegerOption(value, optionName);
  if (parsed < 1) {
    throw new ApiError(0, "INVALID_OPTION", `${optionName} must be greater than zero.`);
  }
  return parsed;
}
