import type { ModelConnectionClientPort } from "../../application/ModelConnectionClientPort";
import type { ModelConnectionResult } from "../../../../../shared/model-connections/types";
import { assertConnectionSnapshot } from "../../../../../shared/model-connections/schema.mjs";

async function unwrap<T>(operation: Promise<ModelConnectionResult<T>> | undefined): Promise<T> {
  if (!operation) throw new Error("NATIVE_BRIDGE_UNAVAILABLE");
  const response = await operation;
  if (!response.ok) throw new Error(response.code);
  return response.value;
}

export const modelConnectionClient: ModelConnectionClientPort = {
  read: async () => assertConnectionSnapshot(await unwrap(window.puppyoneDesktop?.modelConnections?.read())),
  save: async (request) => assertConnectionSnapshot(await unwrap(window.puppyoneDesktop?.modelConnections?.save(request))),
  remove: async (request) => assertConnectionSnapshot(await unwrap(window.puppyoneDesktop?.modelConnections?.remove(request))),
  refresh: async (request) => assertConnectionSnapshot(await unwrap(window.puppyoneDesktop?.modelConnections?.refresh(request))),
  verify: async (request) => assertConnectionSnapshot(await unwrap(window.puppyoneDesktop?.modelConnections?.verify(request))),
  discover: () => unwrap(window.puppyoneDesktop?.modelConnections?.discover()),
  subscribe: (listener) => window.puppyoneDesktop?.modelConnections?.subscribe((snapshot) => {
    listener(assertConnectionSnapshot(snapshot));
  }) ?? (() => {}),
};
