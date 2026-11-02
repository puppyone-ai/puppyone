import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { load } from "js-yaml";
import { createPlan, loadManifest } from "../../../../scripts/release-checks/manifest.mjs";

const workflow = load(readFileSync(new URL("../../../../.github/workflows/ci.yml", import.meta.url), "utf8"));

describe("integration branch quality gates", () => {
  it("runs the required source and Desktop jobs on both canonical branches", () => {
    expect(workflow.on.push.branches).toEqual(expect.arrayContaining(["main", "qubits"]));
    expect(workflow.on).toHaveProperty("pull_request");
    expect(workflow.jobs.build.needs).toEqual(expect.arrayContaining([
      "source-checks",
      "app-checks",
      "platform-contracts",
      "windows-package",
      "cloud-email-sign-in",
    ]));
    expect(workflow.jobs["app-checks"].strategy.matrix.os).toEqual(expect.arrayContaining(["ubuntu-24.04", "macos-15"]));
    const linuxSetup = workflow.jobs["app-checks"].steps.find(step => step.name === "Prepare Linux display and multilingual fonts");
    expect(linuxSetup.if).toBe("runner.os == 'Linux'");
    expect(workflow.jobs["windows-package"]["runs-on"]).toBe("windows-2025");
  });

  it("signs in with email through the paired Cloud Web before Build can pass", () => {
    const signIn = workflow.jobs["cloud-email-sign-in"];
    const [reusable, reusableRef] = signIn.uses.split("@");
    expect(reusable).toBe("puppyone-ai/puppyone-cloud/.github/workflows/desktop-login-e2e.yml");
    // The check's own code must come from the same Cloud ref as the workflow.
    expect(signIn.with.harness_ref).toBe(reusableRef);
    // Test this commit, not the branch it targets.
    expect(signIn.with.desktop_ref).toBe("${{ github.event.pull_request.head.sha || github.sha }}");
    // Stable pairs with production (main), everything else with Qubits.
    expect(signIn.with.cloud_ref).toBe("${{ (github.base_ref || github.ref_name) == 'main' && 'main' || 'qubits' }}");
    expect(signIn.if).toBeUndefined();
    expect(signIn["continue-on-error"]).toBeUndefined();
    const gate = workflow.jobs.build.steps.find(step => step.name === "Require every pre-release check group");
    expect(gate.env.CLOUD_EMAIL_SIGN_IN_RESULT).toBe("${{ needs.cloud-email-sign-in.result }}");
    expect(gate.run).toContain('test "$CLOUD_EMAIL_SIGN_IN_RESULT" = success');
  });

  it("requires updater P0 checks on every native platform in the contracts matrix", () => {
    const platformJob = workflow.jobs["platform-contracts"];
    expect(platformJob.needs).toBe("resolve-desktop-targets");
    expect(platformJob.strategy.matrix).toBe("${{ fromJSON(needs.resolve-desktop-targets.outputs.matrix) }}");
    expect(platformJob["runs-on"]).toBe("${{ matrix.runner }}");
    expect(platformJob.if).toBeUndefined();
    expect(platformJob["continue-on-error"]).toBeUndefined();

    const updaterGate = platformJob.steps.find(step => step.run === "npm run test:updater-p0");
    expect(updaterGate).toBeDefined();
    expect(updaterGate.if).toBeUndefined();
    expect(updaterGate["continue-on-error"]).toBeUndefined();
    expect(platformJob.steps.indexOf(updaterGate)).toBeGreaterThan(
      platformJob.steps.findIndex(step => step.run === "npm ci"),
    );
  });

  it("makes every test typecheck and the complete core denominator part of the source gate", async () => {
    const source = createPlan(await loadManifest(), { group: "source" });
    expect(source.find(check => check.id === "test-types").command).toEqual(["npm", "run", "test:typecheck"]);
    expect(source.find(check => check.id === "tests").command).toEqual(["npm", "run", "test:core:coverage"]);
    expect(source.find(check => check.id === "tests").artifacts).toContain("{checkDir}/vitest/coverage/coverage-summary.json");
  });
});
