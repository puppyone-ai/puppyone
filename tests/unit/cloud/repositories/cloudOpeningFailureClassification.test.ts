import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { describeCloudOpeningFailure } from "../../../../src/features/cloud/cloudOpeningFailure";
import { formatCloudDiagnostic } from "../../../../src/features/cloud/cloudPresentation";

// What "Couldn't open Cloud Computer" says, decided by what the user can do
// next. Before this table nearly every workspace failure read as the same
// "Cloud Computer couldn't be opened. Try again." (puppy-issues ISSUE-129).

type Row = readonly [string, { status?: number; code?: string }, string, "retry" | "account" | "none", boolean];

const WORKSPACE_FAILURES: Row[] = [
  // Wait and try again.
  ["server start deadline", { status: 503, code: "workbench_start_timeout" }, "workspace-start-timeout", "retry", false],
  ["client start deadline", { status: 504, code: "workbench_start_timeout" }, "workspace-start-timeout", "retry", false],
  ["readiness timeout", { status: 503, code: "workbench_connection_timeout" }, "workspace-start-timeout", "retry", false],
  ["still starting", { status: 503, code: "workbench_preparing" }, "workspace-preparing", "retry", false],
  ["connection lost", { status: 503, code: "workbench_connection_unavailable" }, "workspace-connection-unavailable", "retry", false],
  ["unclassified server error", { status: 500 }, "workspace-open-failed", "retry", false],
  ["gateway error", { status: 502 }, "workspace-open-failed", "retry", false],
  ["observer capacity", { status: 503, code: "workbench_observer_capacity" }, "workspace-open-failed", "retry", false],
  // The workspace moved: open it again (once by itself first).
  ["generation replaced", { status: 409, code: "workbench_generation_changed" }, "workspace-changed", "retry", true],
  ["paused during handoff", { status: 409, code: "workbench_not_running" }, "workspace-changed", "retry", true],
  ["not ready", { status: 409, code: "workbench_not_ready" }, "workspace-changed", "retry", true],
  ["operation fenced", { status: 409, code: "workbench_operation_replaced" }, "workspace-changed", "retry", true],
  ["authorization revision moved", { status: 409, code: "workbench_context_changed" }, "workspace-changed", "retry", true],
  // Recovery or a new workspace.
  ["disk lost", { status: 503, code: "workbench_disk_lost" }, "workspace-disk-lost", "retry", false],
  ["needs recovery", { status: 409, code: "workbench_requires_recovery" }, "workspace-recovery-required", "none", false],
  // Account, access, configuration.
  ["plan required", { status: 402 }, "workspace-plan-required", "account", false],
  ["access denied", { status: 403, code: "workbench_access_denied" }, "workspace-access-denied", "none", false],
  ["project not ready", { status: 409, code: "workbench_unavailable" }, "project-unavailable", "none", false],
  ["provider not configured", { status: 503, code: "workbench_provider_not_configured" }, "workspace-not-configured", "none", false],
];

const repository = (relative: string) => fileURLToPath(new URL(`../../../../${relative}`, import.meta.url));
const locales = (JSON.parse(readFileSync(repository("locales/manifest.json"), "utf8")) as {
  locales: Array<{ locale: string }>;
}).locales.map((entry) => entry.locale);
const catalog = (locale: string) => JSON.parse(readFileSync(repository(`locales/renderer/${locale}/cloud.json`), "utf8")) as Record<string, string>;

describe("Cloud Computer opening failures by the user's next step", () => {
  it.each(WORKSPACE_FAILURES)("%s", (_label, error, message, action, reopen) => {
    const failure = describeCloudOpeningFailure(Object.assign(new Error("private detail"), error), "workspace");
    expect(failure.message.code).toBe(message);
    expect(failure.action).toBe(action);
    expect(Boolean(failure.reopen)).toBe(reopen);
  });

  it("carries the server's code and request id beside the message", () => {
    const failure = describeCloudOpeningFailure(
      { status: 503, code: "workbench_start_timeout", requestId: "req-7f3a" }, "workspace");
    expect(failure.message.diagnostic).toEqual({ status: 503, code: "workbench_start_timeout", requestId: "req-7f3a" });
    const formatted = formatCloudDiagnostic(failure.message, (id, values) => `${id}${JSON.stringify(values)}`);
    expect(formatted).toContain("cloud.opening.diagnosticCode");
    expect(formatted).toContain("workbench_start_timeout");
    expect(formatted).toContain("req-7f3a");
  });

  it("shows the HTTP status when the server named no code", () => {
    const failure = describeCloudOpeningFailure({ status: 500 }, "workspace");
    expect(formatCloudDiagnostic(failure.message, (id, values) => `${id}${JSON.stringify(values)}`)).toContain("HTTP 500");
  });

  it("never shows a server string outside the workspace namespace or a malformed request id", () => {
    const failure = describeCloudOpeningFailure(
      { status: 503, code: "private_customer_key", requestId: "id with spaces" }, "workspace");
    expect(failure.message.diagnostic).toEqual({ status: 503 });
  });

  it("has nothing to report for a failure without a server answer", () => {
    expect(formatCloudDiagnostic(describeCloudOpeningFailure(new Error("offline"), "workspace").message,
      (id) => id)).toBeNull();
  });

  it.each(locales)("every message in the table exists in %s", (locale) => {
    const messages = catalog(locale);
    const needed = [
      ...new Set(WORKSPACE_FAILURES.map(([, , message]) => `message.${message}`)),
      "opening.failedTitle", "opening.diagnosticCode", "opening.diagnosticRequest",
      "opening.copyDiagnostic", "opening.diagnosticCopied",
    ];
    expect(needed.filter((key) => typeof messages[key] !== "string")).toEqual([]);
  });
});
