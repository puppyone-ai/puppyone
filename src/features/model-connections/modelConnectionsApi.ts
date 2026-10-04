import type { ModelConnectionResult, ModelConnectionSnapshot, ManagedConnectionAction, SaveModelConnectionRequest } from "../../../shared/model-connections/types";
import { assertConnectionSnapshot } from "../../../shared/model-connections/schema.mjs";

async function unwrap<T>(operation: Promise<ModelConnectionResult<T>> | undefined): Promise<T> {
  if (!operation) throw new Error("NATIVE_BRIDGE_UNAVAILABLE");
  const response = await operation;
  if (!response.ok) throw new Error(response.code);
  return response.value;
}

export type ConnectionRevisionRequest = { id: string; expectedGeneration: number };

export const modelConnectionsApi = {
  managed: async (request: ManagedConnectionAction) => assertConnectionSnapshot(await unwrap(window.puppyoneDesktop?.modelConnections?.managed(request))),
  read: async () => assertConnectionSnapshot(await unwrap(window.puppyoneDesktop?.modelConnections?.read())),
  save: async (request: SaveModelConnectionRequest) => assertConnectionSnapshot(await unwrap(window.puppyoneDesktop?.modelConnections?.save(request))),
  remove: async (request: ConnectionRevisionRequest) => assertConnectionSnapshot(await unwrap(window.puppyoneDesktop?.modelConnections?.remove(request))),
  refresh: async (request: { id: string }) => assertConnectionSnapshot(await unwrap(window.puppyoneDesktop?.modelConnections?.refresh(request))),
  verify: async (request: ConnectionRevisionRequest & { modelId: string }) => assertConnectionSnapshot(await unwrap(window.puppyoneDesktop?.modelConnections?.verify(request))),
  discover: () => unwrap(window.puppyoneDesktop?.modelConnections?.discover()),
  subscribe: (listener: (snapshot: ModelConnectionSnapshot) => void) => window.puppyoneDesktop?.modelConnections?.subscribe((snapshot) => {
    listener(assertConnectionSnapshot(snapshot));
  }) ?? (() => {}),
};
