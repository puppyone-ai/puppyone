import path from "node:path";
import { createConnectionStore } from "./connection-store.mjs";
import { createModelCredentialStore } from "./credential-store.mjs";
import { createModelConnectionService } from "./connection-service.mjs";
import { createModelMetadataClient } from "./http-client.mjs";
import { ollamaDriver } from "./drivers/ollama.mjs";
import { lmStudioDriver } from "./drivers/lm-studio.mjs";
import { unslothDriver } from "./drivers/unsloth.mjs";
import { openaiCompatibleDriver } from "./drivers/openai-compatible.mjs";

export function createModelConnections({ userDataPath, secureStorage, verifyModel }) {
  const directory = path.join(userDataPath, "model-connections");
  return createModelConnectionService({
    store: createConnectionStore({ filePath: path.join(directory, "connections.json") }),
    credentials: createModelCredentialStore({ directory: path.join(directory, "credentials"), secureStorage }),
    drivers: [ollamaDriver, lmStudioDriver, unslothDriver, openaiCompatibleDriver],
    request: createModelMetadataClient(), verifyModel,
  });
}
