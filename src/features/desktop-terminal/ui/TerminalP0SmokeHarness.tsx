import type { Workspace } from "@puppyone/shared-ui";
import { RightTerminalPanel } from "./RightTerminalPanel";

/** Production Terminal surface used only by the real Electron P0 smoke. */
export function TerminalP0SmokeHarness() {
  const search = new URLSearchParams(window.location.search);
  const workspacePath = search.get("workspacePath");
  const dark = search.get("theme") === "dark";
  if (!workspacePath) throw new Error("Terminal P0 smoke requires workspacePath.");
  const workspace: Workspace = {
    id: workspacePath,
    name: "Terminal P0 Smoke",
    path: workspacePath,
    status: "recording",
  };

  return (
    <main
      className={`desktop-terminal-split-smoke${dark ? " dark" : ""}`}
      data-po-appearance-root="true"
      data-sub-theme-id="default.neutral"
      data-terminal-p0-smoke-ready="true"
    >
      <section className="desktop-terminal-split-smoke-panel">
        <RightTerminalPanel
          active
          hiddenAgentIds={[]}
          workspace={workspace}
        />
      </section>
    </main>
  );
}
