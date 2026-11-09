/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectAudience } from "../../../../src/components/project-audience";
import { useLocalProjectAudience } from "../../../../src/features/app-shell/project-place/useLocalProjectAudience";
import type { LocalFolderCloudNotice } from "../../../../src/features/cloud/project/localFolderCloudNoticeState";
import { withTestLocalization } from "../../../support/react/localization";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Input = Parameters<typeof useLocalProjectAudience>[0];
const handlers = () => ({
  onCopyToTeam: vi.fn(), onOpenCloudProject: vi.fn(), onSignIn: vi.fn(),
  onRetry: vi.fn(), onDisconnect: vi.fn(), onSend: vi.fn(),
});
const base = (overrides: Partial<Input> = {}): Input => ({
  cloudEnabled: true, notice: null, disconnectable: false, unhosted: true, publishPending: false,
  canCopyToTeam: true, unsent: 0, handlers: handlers(), ...overrides,
});

let root: Root;
let result: ProjectAudience | null = null;
function Probe({ input }: { input: Input }) {
  result = useLocalProjectAudience(input);
  return null;
}
async function audienceOf(input: Input) {
  await act(async () => root.render(withTestLocalization(<Probe input={input} />)));
  return result;
}
beforeEach(() => { const host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); result = null; });

describe("who can open the local folder in this window", () => {
  it("offers a folder with no copy to a team, only where some team can take it", async () => {
    const input = base();
    const audience = await audienceOf(input);
    expect(audience?.team).toEqual({ copy: null, onCopy: input.handlers.onCopyToTeam });
    expect(await audienceOf(base({ canCopyToTeam: false }))).toBeNull();
  });

  it("returns to a copy already being made, even without a team to offer", async () => {
    const input = base({ unhosted: false, publishPending: true, canCopyToTeam: false });
    expect((await audienceOf(input))?.team?.onCopy).toBe(input.handlers.onCopyToTeam);
  });

  it("offers nothing of the Cloud while the Cloud is off, and keeps my devices", async () => {
    const devices = { on: true };
    expect(await audienceOf(base({ cloudEnabled: false, notice: { kind: "linked", projectId: "p", projectName: "P", openable: true } })))
      .toBeNull();
    expect(await audienceOf(base({ cloudEnabled: false, devices }))).toEqual({ devices, devicesCopy: null, team: undefined });
  });

  it("opens a linked copy, and offers Send only while there are commits it has not had", async () => {
    const input = base({ unhosted: false, unsent: 3, notice: { kind: "linked", projectId: "p1", projectName: "Vault", openable: true } });
    const audience = await audienceOf(input);
    expect(audience?.team?.onCopy).toBeUndefined();
    audience?.team?.copy?.onOpen?.();
    expect(input.handlers.onOpenCloudProject).toHaveBeenCalledWith("p1");
    expect(audience?.team?.copy).toMatchObject({ unsent: 3, onSend: input.handlers.onSend });
    const synced = await audienceOf({ ...input, unsent: 0 });
    expect(synced?.team?.copy?.onSend).toBeUndefined();
    const closed = await audienceOf({ ...input, notice: { kind: "linked", projectId: "p1", projectName: "Vault", openable: false } });
    expect(closed?.team?.copy?.onOpen).toBeUndefined();
  });

  it("keeps hosted copies separate from device sharing", async () => {
    const audience = await audienceOf(base({ unhosted: false,
      notice: { kind: "linked", projectId: "p1", projectName: "Vault", openable: true } }));
    expect(audience?.devicesCopy).toBeNull();
    expect(audience?.team?.copy).toBeTruthy();
  });

  it.each([
    [{ kind: "sign-in" }, "Sign in to open", "Sign in", "onSignIn"],
    [{ kind: "unreachable", cause: null }, "Can’t be reached right now", "Retry", "onRetry"],
    [{ kind: "missing" }, "No longer in the Cloud", "Disconnect…", "onDisconnect"],
    [{ kind: "no-access" }, "This account can’t open it", "Disconnect…", "onDisconnect"],
    [{ kind: "other-environment", origin: "http://localhost:9090" }, "In another environment: localhost:9090", "Disconnect…", "onDisconnect"],
    [{ kind: "other-environment", origin: null }, "In another environment", "Disconnect…", "onDisconnect"],
  ] as [LocalFolderCloudNotice, string, string, keyof ReturnType<typeof handlers>][])(
    "says why a %o copy cannot be used, and offers its remedy",
    async (notice, problem, resolveLabel, remedy) => {
      const input = base({ unhosted: false, notice, disconnectable: true });
      const copy = (await audienceOf(input))?.team?.copy;
      expect(copy).toMatchObject({ problem, resolveLabel });
      copy?.onResolve?.();
      expect(input.handlers[remedy]).toHaveBeenCalledOnce();
    },
  );

  it("offers no remedy this app cannot carry out", async () => {
    const ambiguous = await audienceOf(base({ unhosted: false, notice: { kind: "ambiguous" }, disconnectable: true }));
    expect(ambiguous?.team?.copy).toEqual({ problem: "Points to more than one Cloud project" });
    const stuck = await audienceOf(base({ unhosted: false, notice: { kind: "missing" }, disconnectable: false }));
    expect(stuck?.team?.copy).toEqual({ problem: "No longer in the Cloud" });
  });
});
