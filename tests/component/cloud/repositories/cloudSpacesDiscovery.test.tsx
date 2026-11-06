/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCloudSpaces } from "../../../../src/features/cloud/spaces/useCloudSpaces";
import { ensurePersonalCloudSpace, listCloudOrganizations, type DesktopCloudSession } from "../../../../src/lib/cloudApi";
vi.mock("../../../../src/lib/cloudApi", () => ({ ensurePersonalCloudSpace: vi.fn(), listCloudOrganizations: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const session = { user_id: "a", session_generation: "1", status: "authenticated" } as DesktopCloudSession;
const personal = { id: "personal", name: "Alex", kind: "personal", can_create_projects: true };
const team = { id: "team", name: "Company", kind: "team", can_create_projects: true };
let root: Root;
let state: ReturnType<typeof useCloudSpaces>;
function Harness({ user = session }: { user?: DesktopCloudSession | null }) {
  state = useCloudSpaces({ enabled: true, visible: true, session: user, apiBaseUrl: "https://fixture.puppyone.ai/api/v1" });
  return null;
}
beforeEach(() => { vi.resetAllMocks(); root = createRoot(document.createElement("div")); });
afterEach(async () => { await act(async () => root.unmount()); });
it("ensures a separate personal space, then sorts personal before organizations", async () => {
  vi.mocked(listCloudOrganizations).mockResolvedValue([team] as never);
  vi.mocked(ensurePersonalCloudSpace).mockResolvedValue(personal as never);
  await act(async () => root.render(<Harness />));
  expect(state.status).toBe("ready");
  expect(state.spaces.map((space) => space.id)).toEqual(["personal", "team"]);
  expect(ensurePersonalCloudSpace).toHaveBeenCalledOnce();
});
it("does not repeat provisioning when the binding already exists", async () => {
  vi.mocked(listCloudOrganizations).mockResolvedValue([team, personal] as never);
  await act(async () => root.render(<Harness />));
  expect(ensurePersonalCloudSpace).not.toHaveBeenCalled();
});
it("old or failing servers provide no guessed writable destinations and can be retried", async () => {
  vi.mocked(listCloudOrganizations).mockResolvedValue([{ id: "old", name: "personal-alex" }] as never);
  vi.mocked(ensurePersonalCloudSpace).mockRejectedValue(new Error("unsupported"));
  await act(async () => root.render(<Harness />));
  expect(state.status).toBe("error"); expect(state.spaces).toEqual([]);
  vi.mocked(listCloudOrganizations).mockResolvedValue([personal] as never);
  await act(async () => state.refresh());
  expect(state.status).toBe("ready");
});
it("late discovery cannot leak spaces into another account or provision after sign-out", async () => {
  let finish!: (value: never) => void;
  vi.mocked(listCloudOrganizations).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  await act(async () => root.render(<Harness />));
  await act(async () => root.render(<Harness user={null} />));
  await act(async () => finish([team] as never));
  expect(state.spaces).toEqual([]); expect(state.status).toBe("signed-out");
  expect(ensurePersonalCloudSpace).not.toHaveBeenCalled();
});
