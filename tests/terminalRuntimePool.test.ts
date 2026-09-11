/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectWorkbenchStore } from "../src/features/app-shell/auxiliary-workbench/ProjectWorkbenchStore";
import { TerminalRuntimePool } from "../src/features/desktop-terminal/runtime/TerminalRuntimePool";

const { factory } = vi.hoisted(() => ({ factory: vi.fn() }));
vi.mock("../src/features/desktop-terminal/runtime/terminalRuntime", () => ({ TerminalRuntime: class { constructor(options: unknown) { return factory(options); } } }));
const context = (id: string) => ({ projectId: id, rootPath: `/projects/${id}`, generation: id });
const appearance = { theme: { background: "rgb(235, 235, 235)" }, fontFamily: "monospace", fontSize: 14, defaultColors: { foreground: [47, 42, 35] as [number, number, number], background: [235, 235, 235] as [number, number, number] } };
const runtime = () => ({ mount: vi.fn(), unmount: vi.fn(), close: vi.fn(async () => {}), dispose: vi.fn() });
afterEach(() => factory.mockReset());

describe("project-owned Terminal runtime pool", () => {
  it("keeps each screen and captured root through view unmounts", () => {
    const screen = runtime(); factory.mockReturnValue(screen);
    const project = new ProjectWorkbenchStore(context("a"));
    const pool = new TerminalRuntimePool(project, (key) => key);
    const entry = pool.ensure("terminal-a", "shell", appearance);
    screen.unmount(document.createElement("div"));
    expect(pool.ensure("terminal-a", "shell", appearance)).toBe(entry);
    expect(factory).toHaveBeenCalledOnce();
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ appearance, workspacePath: "/projects/a", projectContext: context("a") }));
    expect(screen.dispose).not.toHaveBeenCalled();
    expect(screen.close).not.toHaveBeenCalled();
    pool.dispose();
    expect(screen.dispose).toHaveBeenCalledOnce();
    expect(screen.close).not.toHaveBeenCalled();
  });

  it("retains its runtime until native close succeeds and supports retry", async () => {
    const screen = runtime(); factory.mockReturnValue(screen);
    const pool = new TerminalRuntimePool(new ProjectWorkbenchStore(context("a")), (key) => key);
    const entry = pool.ensure("terminal-a", "shell", appearance);
    screen.close.mockRejectedValueOnce(new Error("still alive"));
    await expect(pool.close("terminal-a")).rejects.toThrow("still alive");
    expect(pool.get("terminal-a")).toBe(entry);
    await pool.close("terminal-a");
    expect(pool.get("terminal-a")).toBeUndefined();
  });

  it("refuses runtime allocation after the project closes", () => {
    const project = new ProjectWorkbenchStore(context("a"));
    const pool = new TerminalRuntimePool(project, (key) => key);
    project.setClosing(true);
    expect(() => pool.ensure("terminal-a", "shell", appearance)).toThrow();
    expect(factory).not.toHaveBeenCalled();
  });
});
