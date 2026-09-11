import { describe, expect, it, vi } from "vitest";
import { createItemRendererAuthority } from "./renderer-authority.mjs";

function fixture(kind = "terminal") {
  const authority = createItemRendererAuthority();
  const url = "file:///app/item-host.html#g1";
  const wc = { id: 2, mainFrame: { url }, isDestroyed: () => false, send: vi.fn() };
  const entry = { kind, itemId: "a", url, owner: { id: 1, isDestroyed: () => false }, view: { webContents: wc },
    projectContext: { rootPath: "/project", projectId: "p", generation: "g" }, operations: new Set(), referenceTokens: new Set() };
  authority.register(entry);
  return { authority, entry, event: { sender: wc, senderFrame: wc.mainFrame } };
}

describe("isolated display authority", () => {
  it("rejects child frames, stale URLs, retired displays and Shell-only operations", () => {
    const { authority, entry, event } = fixture();
    expect(() => authority.require({ ...event, senderFrame: { url: entry.url } })).toThrow(/authorized/);
    expect(() => authority.route(event, "item-host:create")).toThrow(/cannot access/);
    event.senderFrame.url = "file:///app/item-host.html#g2";
    expect(() => authority.require(event)).toThrow(/authorized/);
    authority.unregister(entry);
    expect(() => authority.route(event, "workspace:read-file")).toThrow(/authorized/);
  });

  it("forces stable project ownership and rejects cross-item commands", () => {
    const { authority, entry, event } = fixture();
    const routed = authority.route(event, "terminal:input");
    expect(routed.sender.id).toBe(1);
    expect(routed.sender.hostItemId).toBe("a");
    expect(authority.scopeRequest(routed, "terminal:input", [{ id: "a", projectContext: { generation: "forged" } }])[0].projectContext).toBe(entry.projectContext);
    expect(() => authority.scopeRequest(routed, "terminal:input", [{ id: "b" }])).toThrow(/Cross-terminal/);
    expect(() => authority.scopeRequest(routed, "terminal:input", [{ id: "a", rootPath: "/other" }])).toThrow(/Cross-project/);
    expect(() => authority.route(event, "agent:session-create")).toThrow(/cannot access/);
    entry.closeRequested = true;
    expect(() => authority.require(event)).toThrow(/authorized/);
  });

  it("bounds pending application calls per display, and tracks attachment capabilities", async () => {
    const { authority, entry, event } = fixture("agent");
    const routed = authority.route(event, "agent:reference-stage");
    let release;
    const waiting = new Promise((resolve) => { release = resolve; });
    const calls = Array.from({ length: 16 }, () => authority.invoke(routed, "agent:reference-stage", [{}], () => waiting));
    await expect(authority.invoke(routed, "agent:reference-stage", [{}], () => [])).rejects.toThrow(/queue is full/);
    release([{ token: "owned-token" }]);
    await Promise.all(calls);
    expect(entry.operations.size).toBe(0);
    expect(entry.referenceTokens.has("owned-token")).toBe(true);
  });
});
