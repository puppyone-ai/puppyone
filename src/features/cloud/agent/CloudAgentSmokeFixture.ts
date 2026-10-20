import { EditorView } from "@codemirror/view";
import type { CloudAgentRun, CloudAgentSubmission } from "./cloudAgentClient";
type FixtureRequest = { path: string; method?: string; body?: string };

/** Local protocol fixture for Electron smoke surfaces; never contacts a model. */
export function createCloudAgentSmokeFixture(publish: (project: string) => void) {
  const runs: CloudAgentRun[] = [];
  const requests: string[] = [];
  async function request(input: FixtureRequest) {
    if (/^\/projects\/[^/]+\/workbench$/.test(input.path)) {
      const project = input.path.split("/")[2];
      return { workspace: { id: `workbench-${project}`, project_id: project,
        generation: "11111111-1111-4111-8111-111111111111", state: "running", target_ref: "refs/heads/workspace" } };
    }
    if (!input.path.startsWith("/agents/")) return undefined;
    requests.push(`${input.method ?? "GET"} ${input.path}`);
    const body = JSON.parse(input.body || "{}");
    if (input.path === "/agents/runs" && input.method === "POST") {
      const existing = runs.find(run => run.request_id === body.request_id);
      if (existing) return existing;
      const run = createRun(body);
      runs.push(run); return run;
    }
    if (input.path.startsWith("/agents/sessions?")) {
      const agent = new URL(input.path, "https://cloud-fixture.puppyone.ai").searchParams.get("agent_id");
      return [...new Map(runs.filter(run => run.agent_id === agent).map(run => [run.session_id, {
        id: run.session_id, agent_id: run.agent_id, title: run.prompt, mode: "cloud_pi", updated_at: run.updated_at,
      }])).values()];
    }
    if (input.path.startsWith("/agents/sessions/")) return runs.filter(run => input.path.includes(run.session_id)).reverse();
    const run = runs.find(run => input.path.includes(run.id) || input.path.includes(run.request_id));
    if (!run) throw new Error("Missing fixture run");
    if (input.path.includes("/events?")) {
      await new Promise(resolve => setTimeout(resolve, 200));
      if (run.prompt.startsWith("Connection test:") && run.state === "queued") {
        run.state = "succeeded"; run.sequence++;
        run.snapshot = { text: `Connected: ${run.prompt}` };
        return [{ id: run.sequence, event: "text", data: { delta: run.snapshot.text } }];
      }
      return [];
    }
    if (input.path.endsWith("/stop")) {
      run.state = "stopped"; run.stop_requested = true; run.sequence++;
    }
    if (input.path.includes("/approvals/")) {
      run.tools![0]!.state = body.allow ? "completed" : "rejected";
      run.state = "succeeded"; run.sequence++;
      run.snapshot = { text: body.allow ? "Cloud file updated." : "No changes made." };
      run.publication = { status: body.allow ? "committed" : "no_changes" };
      if (body.allow) publish(run.project_id);
    }
    return structuredClone(run);
  }
  const wrap = (fallback: (input: FixtureRequest) => Promise<unknown>) => async (input: FixtureRequest) => {
    const result = await request(input);
    return result === undefined ? fallback(input) : result;
  };
  return { request, wrap, state: () => ({ requests: [...requests], states: runs.map(run => run.state),
    runs: runs.map(({ id, session_id, request_id, prompt }) => ({ id, session_id, request_id, prompt })) }) };
}

function createRun(body: CloudAgentSubmission & { project_id: string; workbench_id: string }): CloudAgentRun {
  const chatOnly = body.prompt.startsWith("Connection test:");
  const approval = !body.prompt.includes("stop");
  let state: CloudAgentRun["state"] = approval ? "waiting_approval" : "running";
  if (chatOnly) state = "queued";
  return { id: crypto.randomUUID(), project_id: body.project_id, workbench_id: body.workbench_id,
    agent_id: `configured-${body.project_id}`, session_id: body.session_id || crypto.randomUUID(),
    request_id: body.request_id, prompt: body.prompt, state,
    sequence: 2, stop_requested: false, snapshot: { text: chatOnly ? "" : "I will update the cloud file." }, publication: null,
    tools: !chatOnly && approval ? [{ call_id: "write-notes", name: "write", input: { path: "readme.txt" }, state: "waiting" }] : [],
    created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
}

export function editCloudAgentPrompt(text: string) {
  const node = document.querySelector('.desktop-terminal-contribution-host[aria-hidden="false"] .desktop-cloud-agent-sidebar .cm-editor');
  const editor = node ? EditorView.findFromDOM(node as HTMLElement) : null;
  if (!editor) throw new Error("No cloud Agent composer");
  editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } });
}
