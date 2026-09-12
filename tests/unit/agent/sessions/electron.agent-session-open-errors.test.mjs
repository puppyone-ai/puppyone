import { describe, expect, it } from "vitest";
import {
  classifySessionOpenFailure,
  sessionOpenFailure,
} from "../../../../electron/main/agent/application/session/agent-session-open-errors.mjs";

describe("Agent exact-open error contract", () => {
  it.each([
    [Object.assign(new Error("expired"), { code: "AUTHENTICATION_EXPIRED" }), "AUTH_EXPIRED", true],
    [Object.assign(new Error("required"), { code: "AUTHENTICATION_REQUIRED" }), "AUTH_REQUIRED", true],
    [new Error("resume request timed out"), "RESUME_TIMED_OUT", true],
    [new Error("session/resume method not found"), "RESUME_UNSUPPORTED", false],
    [new Error("workspace reference is outside the assigned root"), "WORKSPACE_MISMATCH", false],
    [new Error("runtime executable is missing"), "RUNTIME_UNAVAILABLE", true],
    [new Error("unexpected protocol response"), "PROTOCOL_ERROR", true],
  ])("maps provider failures into a closed code vocabulary", (error, code, retryable) => {
    expect(classifySessionOpenFailure(error)).toMatchObject({
      status: "failed",
      error: { code, retryable },
    });
  });

  it("constructs the public failure envelope in one place", () => {
    expect(sessionOpenFailure("SESSION_NOT_FOUND", "Gone", false)).toEqual({
      status: "failed",
      error: {
        code: "SESSION_NOT_FOUND",
        message: "Gone",
        retryable: false,
      },
    });
  });
});
