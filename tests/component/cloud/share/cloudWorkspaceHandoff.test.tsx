/** @vitest-environment happy-dom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudWorkspaceHandoff } from "../../../../src/features/cloud/agent-review/CloudWorkspaceHandoff";
import { useWorkspaceHandoff } from "../../../../src/features/cloud/agent-review/useWorkspaceHandoff";
import { cloudApiRequest, type DesktopCloudSession } from "../../../../src/lib/cloudApi";
import { withTestLocalization } from "../../../support/react/localization";

vi.mock("../../../../src/lib/cloudApi", () => ({ cloudApiRequest: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const session = { user_id: "alice" } as DesktopCloudSession;
const API = "https://cloud-fixture.puppyone.ai/api/v1";
let root: Root;

function Harness({ agentBranch }: { agentBranch?: string }) {
  const handoff = useWorkspaceHandoff({ session, projectId: "project-1", apiBaseUrl: API });
  return <>
    {agentBranch && <button type="button" onClick={() => void handoff.bringIn(agentBranch)}>from agent</button>}
    <CloudWorkspaceHandoff handoff={handoff} />
  </>;
}

function serve(replies: Record<string, unknown>) {
  vi.mocked(cloudApiRequest).mockImplementation(async (path: string) => {
    if (path === "/projects/project-1/workbench") return { workspace: { generation: "g-1", state: "running" } } as never;
    const reply = replies[path.replace("/projects/project-1/workbench/", "")];
    if (reply instanceof Error) throw reply;
    return reply as never;
  });
}

const posts = () => vi.mocked(cloudApiRequest).mock.calls
  .filter(([, , , init]) => (init as RequestInit | undefined)?.method === "POST")
  .map(([path, , , init]) => [path, JSON.parse(String((init as RequestInit).body))]);
const button = (name: string) => [...document.querySelectorAll("button")].find(node => node.textContent === name);
const notice = () => document.querySelector('[role="status"]')?.textContent ?? "";
const press = async (name: string) => { await act(async () => { button(name)!.click(); }); };
const show = async (agentBranch?: string) => {
  await act(async () => root.render(withTestLocalization(<Harness agentBranch={agentBranch} />)));
};

beforeEach(() => {
  vi.mocked(cloudApiRequest).mockReset();
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); });

describe("handing work between a workspace and the project", () => {
  it("brings in an Agent's branch by name, bound to the running generation", async () => {
    serve({ sync: { status: "merged" } });
    await show("refs/heads/agents/one");
    await press("from agent");
    expect(notice()).toContain("The changes are in your workspace");
    expect(posts()).toEqual([["/projects/project-1/workbench/sync",
      { generation: "g-1", source_ref: "refs/heads/agents/one" }]]);
  });

  it("brings in the project's own branch without naming one", async () => {
    serve({ sync: { status: "up_to_date" } });
    await show();
    await press("Bring in the latest");
    expect(notice()).toContain("Already up to date");
    expect(posts()[0][1]).toEqual({ generation: "g-1" });
  });

  it("holds files changed on both sides until the person finishes", async () => {
    serve({ sync: { status: "conflict", paths: ["note.md"] }, "sync/finish": { status: "merged" } });
    await show();
    await press("Bring in the latest");
    expect(document.body.textContent).toContain("note.md");
    expect(button("Update the project")).toBeUndefined();
    await press("Finish");
    expect(document.body.textContent).not.toContain("note.md");
    expect(button("Update the project")).toBeDefined();
  });

  it("keeps listing the files that are still unfinished", async () => {
    serve({
      sync: { status: "conflict", paths: ["a.md", "b.md"] },
      "sync/finish": { status: "conflict", paths: ["b.md"] },
    });
    await show();
    await press("Bring in the latest");
    await press("Finish");
    expect(notice()).toContain("still need your edits");
    expect(document.body.textContent).not.toContain("a.md");
    expect(document.body.textContent).toContain("b.md");
  });

  it("can undo a waiting change", async () => {
    serve({ sync: { status: "conflict", paths: ["note.md"] }, "sync/abort": { status: "aborted" } });
    await show();
    await press("Bring in the latest");
    await press("Undo");
    expect(notice()).toContain("back as it was");
    expect(button("Bring in the latest")).toBeDefined();
  });

  it.each([
    [{ status: "published" }, "now matches your workspace"],
    [{ status: "no_changes" }, "Nothing new"],
    [{ status: "rejected" }, "Bring in the latest first"],
    [{ status: "merging" }, "still need your edits"],
  ])("reports %j when updating the project", async (reply, text) => {
    serve({ publish: reply });
    await show();
    await press("Update the project");
    expect(notice()).toContain(text);
  });

  it("says why when an Agent is still working", async () => {
    // The Electron client surfaces the API's business code as `error.code`.
    serve({ sync: Object.assign(new Error("Request failed (409)"), { status: 409, code: "workspace_busy" }) });
    await show();
    await press("Bring in the latest");
    expect(notice()).toContain("still working");
  });

  it("asks for the workspace to be opened rather than failing silently", async () => {
    vi.mocked(cloudApiRequest).mockResolvedValue({ workspace: { generation: "g-1", state: "paused" } } as never);
    await show();
    await press("Update the project");
    expect(notice()).toContain("Open this workspace first");
  });
});
