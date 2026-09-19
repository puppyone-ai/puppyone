import { describe, expect, it, vi } from "vitest";
import { createItemLifecycleManager } from "../../../../electron/main/item-hosts/item-lifecycle-menu.mjs";
import { createItemLifecycleSupervisor } from "../../../../electron/main/item-hosts/item-lifecycle-supervisor.mjs";

const identity = ownerId => ({ kind: "agent", ownerId, itemId: `item-${ownerId}`, creationId: `creation-${ownerId}`,
  root: "/project", projectContext: { projectId: "project", generation: "generation", rootPath: "/project" } });

describe("Main-owned execution management", () => {
  it("keeps failed cleanup discoverable without a tab and permits a scoped retry", async () => {
    const lifecycle = createItemLifecycleSupervisor();
    const record = lifecycle.reserve(identity(1));
    const other = lifecycle.reserve(identity(2));
    const close = vi.fn().mockRejectedValueOnce(new Error("still owned")).mockResolvedValue(undefined);
    lifecycle.attach(record, { host: { close } });
    lifecycle.terminate(identity(1), "fixed-operation");
    await lifecycle.close(record).catch(() => {});
    const dialogs = [];
    let step = 0;
    const dialog = { showMessageBox: vi.fn(async options => {
      dialogs.push(options);
      return { response: step++ < 2 ? 0 : options.cancelId };
    }) };
    await createItemLifecycleManager({ lifecycle, dialog, t: key => key })(1);
    await lifecycle.close(record);
    expect(dialogs[0].buttons).toContain("agent · item-1");
    expect(dialogs[0].buttons).not.toContain("agent · item-2");
    expect(dialogs[1].buttons[0]).toBe("native.execution.retry");
    expect(dialogs[1].detail).toContain("native.execution.state.unconfirmed");
    expect(close).toHaveBeenCalledTimes(2);
    expect(lifecycle.summary(record)).toMatchObject({ cleanup: "confirmed", operationId: "fixed-operation" });
    expect(lifecycle.summary(other).desiredLifecycle).toBe("active");
  });

  it("coalesces repeat opens per owner without blocking another window", async () => {
    const pending = Promise.withResolvers();
    const dialog = { showMessageBox: vi.fn(() => pending.promise) };
    const manage = createItemLifecycleManager({ lifecycle: createItemLifecycleSupervisor(), dialog, t: key => key });
    const first = manage(1);
    expect(manage(1)).toBe(first);
    const second = manage(2);
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(2);
    pending.resolve({ response: 0 });
    await Promise.all([first, second]);
  });
});
