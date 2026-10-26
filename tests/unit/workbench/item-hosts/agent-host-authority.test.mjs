import { expect, it, vi } from "vitest";
import { createAgentHostAuthority } from "../../../../electron/main/item-hosts/agent-host-authority.mjs";

it("revokes a late model lease from an old host without releasing or terminating its replacement", async () => {
  const record = { key: "old-host", runtimeId: "puppyone-agent", allowedModelRoute: "mc_00000000-0000-0000-0000-000000000001/model", host: { exited: false }, closing: false };
  const pending = Promise.withResolvers();
  const connections = { acquire: vi.fn(() => pending.promise), releaseScope: vi.fn() };
  const shutdown = vi.fn();
  const authority = createAgentHostAuthority({ record, records: new Set([record]), sender: { id: 1 }, root: "/fixture",
    modelConnections: connections, shutdown, attachmentStore: {}, conversationCatalog: {} });
  const acquire = authority("model-connections:acquire", ["mc_00000000-0000-0000-0000-000000000001/model"]);
  record.key = "replacement-host";
  connections.acquire.mock.calls[0][0].onRevoke();
  expect(shutdown).not.toHaveBeenCalled();
  pending.resolve({ leaseId: "late-lease" });
  await expect(acquire).rejects.toMatchObject({ code: "HOST_AUTHORITY" });
  expect(connections.releaseScope).toHaveBeenCalledExactlyOnceWith("old-host");
  await expect(authority("model-connections:read", [])).rejects.toMatchObject({ code: "HOST_AUTHORITY" });
});
