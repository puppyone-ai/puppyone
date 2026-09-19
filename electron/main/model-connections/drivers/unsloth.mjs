import { openaiCompatibleDriver } from "./openai-compatible.mjs";

// No brand inference from a generic /v1 endpoint. Configured explicitly by the user.
export const unslothDriver = { ...openaiCompatibleDriver, id: "unsloth" };
