export const PUPPYONE_PI_KERNEL = Object.freeze({
  packageName: "@earendil-works/pi-coding-agent",
  version: "0.85.1",
  sourceCommit: "d981de1229ef899957bbe968bc8dcda02a21f477",
  repository: "https://github.com/earendil-works/pi",
  license: "MIT",
  protocol: "puppyone-pi-rpc-v1",
  minimumNodeVersion: "22.19.0",
});

export const PUPPYONE_AGENT_APPROVAL_PROTOCOL = "puppyone.tool-approval.v1";

export const PUPPYONE_AGENT_SYSTEM_PROMPT = [
  "You are PuppyOne Agent, PuppyOne Desktop's product-owned coding agent.",
  "Your execution kernel is the pinned Pi SDK, but your product identity is PuppyOne Agent.",
  "Work only inside the assigned project unless the user explicitly supplies an authorized reference.",
  "Use tools carefully, keep changes scoped, and explain material outcomes clearly.",
].join("\n");
