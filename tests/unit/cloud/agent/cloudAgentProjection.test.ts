import { expect, it } from "vitest";
import { projectCloudAgentRuns } from "../../../../src/features/cloud/agent/cloudAgentProjection";
import type { CloudAgentRun } from "../../../../src/features/cloud/agent/cloudAgentClient";

it.each(["running", "succeeded"] as const)("keeps tool errors separate from the %s Run", state => {
  const run: CloudAgentRun = { id: "run", project_id: "p", agent_id: "a", session_id: "s", request_id: "r",
    prompt: "Read files", state, sequence: 1, stop_requested: false, snapshot: { text: "Continuing" },
    publication: null, created_at: "2026-10-10T00:00:00Z", updated_at: "2026-10-10T00:00:00Z", tools: [
      { call_id: "denied", name: "write", input: { path: "/recovery/test" }, state: "completed",
        result: { isError: true, details: { code: "tool_permission_denied", recoverable: true },
          content: [{ type: "text", text: "Permission denied" }] } },
      { call_id: "failed", name: "bash", input: { command: "false" }, state: "completed",
        result: { isError: true, content: [{ type: "text", text: "Exit code 1" }] } },
      { call_id: "declined", name: "bash", input: { command: "touch nope" }, state: "rejected" },
      { call_id: "good", name: "read", input: { path: "file.md" }, state: "completed", result: { content: [] } },
    ] };
  const result = projectCloudAgentRuns([run]);
  expect(result.activities.map(a => a.status)).toEqual(["blocked", "failed", "cancelled", "completed"]);
  expect(result.activities[0]?.output).toBe("Permission denied");
  expect(result.activities[2]?.output).toContain("declined");
  expect(result.terminalState).toBe(state === "succeeded" ? "completed" : null);
  expect(result.runningTurnId).toBe(state === "running" ? "run" : null);
});
