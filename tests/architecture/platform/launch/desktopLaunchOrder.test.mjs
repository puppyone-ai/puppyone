import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createDesktopLaunchIntent,
  findWorkspacePathArg,
  handleSecondInstanceLaunch,
  parseDesktopLaunchIntent,
} from "../../../../electron/main/desktop-launch-intent.mjs";

describe("Desktop launch intent", () => {
  it("keeps optional subsystem construction behind the single-instance boundary", () => {
    const mainSource = fs.readFileSync(
      new URL("../../../../electron/main.mjs", import.meta.url),
      "utf8",
    );
    const instanceBoundary = mainSource.indexOf(
      "app.requestSingleInstanceLock(initialLaunchIntent)",
    );

    expect(instanceBoundary).toBeGreaterThan(-1);
    expect(mainSource).not.toContain("isCloudAuthCallbackUrl");
    for (const optionalComposition of [
      "const terminalService = createTerminalProcessService({",
      "const agentRuntimeRegistry = createDefaultAgentRuntimeHost({",
      "const cloudAuthService = createCloudAuthService({",
    ]) {
      expect(mainSource.indexOf(optionalComposition)).toBeGreaterThan(instanceBoundary);
    }
  });
});
