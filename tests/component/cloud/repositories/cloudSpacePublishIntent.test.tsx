/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCloudSpacePublishIntent } from "../../../../src/features/cloud/spaces/useCloudSpacePublishIntent";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let request: ReturnType<typeof useCloudSpacePublishIntent>;
let finish: () => void;
const ready = vi.fn();
function Harness({ path = null, authority = "account:deployment:1" }: { path?: string | null; authority?: string | null }) {
  request = useCloudSpacePublishIntent({ authority, workspacePath: path,
    openProject: () => new Promise<void>((resolve) => { finish = resolve; }), onReady: ready });
  return null;
}
beforeEach(() => { ready.mockReset(); root = createRoot(document.createElement("div")); });
afterEach(async () => { await act(async () => root.unmount()); });
it("opens confirmation only after the exact source has opened", async () => {
  await act(async () => root.render(<Harness />));
  let pending!: Promise<void>;
  await act(async () => { pending = request("/project", "team"); });
  expect(ready).not.toHaveBeenCalled();
  await act(async () => root.render(<Harness path="/project" />));
  await act(async () => { finish(); await pending; });
  expect(ready).toHaveBeenCalledExactlyOnceWith({ path: "/project", organizationId: "team", authority: "account:deployment:1" });
});
it("a failed or superseded navigation cannot leave an intent for a later visit", async () => {
  await act(async () => root.render(<Harness />));
  let pending!: Promise<void>;
  await act(async () => { pending = request("/project", "team"); });
  await act(async () => { finish(); await pending; });
  await act(async () => root.render(<Harness path="/project" />));
  expect(ready).not.toHaveBeenCalled();
});
it("account/deployment generation changes cancel the pending target", async () => {
  await act(async () => root.render(<Harness />));
  let pending!: Promise<void>;
  await act(async () => { pending = request("/project", "team"); });
  await act(async () => root.render(<Harness path="/project" authority="other" />));
  await act(async () => { finish(); await pending; });
  expect(ready).not.toHaveBeenCalled();
});
