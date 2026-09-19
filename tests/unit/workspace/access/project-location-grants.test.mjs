import { describe, expect, it, vi } from "vitest";
import { createProjectLocationGrantStore } from "../../../../electron/main/project-location-grants.mjs";

describe("project location grants", () => {
  it("retains a committed grant only for that operation and sender", () => {
    const store = createProjectLocationGrantStore();
    const sender = { id: 1 };
    const grant = store.issue(sender, "/projects");
    store.bindCommittedOperation(sender, grant.grantId, "operation-1");
    expect(store.resolve(sender, grant.grantId, "operation-1")).toBe("/projects");
    expect(() => store.resolve(sender, grant.grantId, "operation-2")).toThrow(/different creation/i);
    expect(() => store.resolve(sender, grant.grantId)).toThrow(/different creation/i);
    expect(() => store.resolve({ id: 1 }, grant.grantId, "operation-1")).toThrow(/choose a project location/i);
    expect(() => store.bindCommittedOperation(sender, grant.grantId, "operation-2")).toThrow(/different operation/i);
  });

  it("requires a new grant for a new creation after commitment", () => {
    const store = createProjectLocationGrantStore();
    const sender = { id: 1 };
    const old = store.issue(sender, "/projects");
    store.bindCommittedOperation(sender, old.grantId, "operation-1");
    const next = store.issue(sender, "/projects");
    expect(store.resolve(sender, next.grantId, "operation-2")).toBe("/projects");
    expect(() => store.resolve(sender, old.grantId, "operation-1")).toThrow(/choose a project location/i);
  });

  it("binds a selected location to the issuing sender", () => {
    const createId = vi.fn(() => "location-1");
    const store = createProjectLocationGrantStore({ createId });
    const owner = { id: 1 };
    const otherWindow = { id: 2 };

    expect(store.issue(owner, "/Users/example/Desktop")).toEqual({
      grantId: "location-1",
      path: "/Users/example/Desktop",
    });
    expect(store.resolve(owner, "location-1")).toBe("/Users/example/Desktop");
    expect(() => store.resolve(otherWindow, "location-1")).toThrow(/choose a project location/i);
  });

  it("replaces old Browse selections and revokes only the matching grant", () => {
    const ids = ["location-1", "location-2"];
    const store = createProjectLocationGrantStore({ createId: () => ids.shift() });
    const sender = { id: 1 };

    store.issue(sender, "/Users/example/Desktop");
    store.issue(sender, "/Users/example/Documents");
    expect(() => store.resolve(sender, "location-1")).toThrow(/choose a project location/i);
    expect(store.revoke(sender, "location-1")).toBe(false);
    expect(store.resolve(sender, "location-2")).toBe("/Users/example/Documents");
    expect(store.revoke(sender, "location-2")).toBe(true);
    expect(() => store.resolve(sender, "location-2")).toThrow(/choose a project location/i);
  });
});
