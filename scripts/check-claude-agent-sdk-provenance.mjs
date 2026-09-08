import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = readJson("package.json");
const lock = readJson("package-lock.json");
const version = manifest.dependencies?.["@anthropic-ai/claude-agent-sdk"];
const locked = lock.packages?.["node_modules/@anthropic-ai/claude-agent-sdk"];
const discovery = read("electron/main/agent/runtimes/claude/claude-discovery.mjs");
const adapter = read("electron/main/agent/runtimes/claude/claude-agent-sdk-adapter.mjs");
const nativeValues = read("electron/main/agent/runtimes/claude/claude-native-values.mjs");
const notices = read("THIRD_PARTY_NOTICES.md");
const license = read("vendor/claude-agent-sdk/LICENSE.md");

assert(version === "0.3.159", "Claude Agent SDK must be pinned exactly.");
assert(locked?.version === version, "Claude Agent SDK lockfile version drifted.");
for (const [name, dependencyVersion] of Object.entries(locked?.optionalDependencies ?? {})) {
  assert(name.startsWith("@anthropic-ai/claude-agent-sdk-"), `Unexpected Claude optional runtime ${name}.`);
  assert(dependencyVersion === version, `${name} must match the SDK version.`);
}
assert(discovery.includes(`CLAUDE_AGENT_SDK_VERSION = "${version}"`), "Claude discovery version pin drifted.");
assert(!manifest.build?.asarUnpack?.includes("node_modules/@anthropic-ai/claude-agent-sdk-*/**"), "Claude platform runtime must not inflate the base ASAR payload.");
assert(manifest.build?.files?.includes("!node_modules/@anthropic-ai/claude-agent-sdk-*/**"), "Claude platform runtime must be excluded from the base application.");
assert(adapter.includes('settingSources: ["user"]'), "Claude adapter must not load repository settings implicitly.");
assert(adapter.includes(`revision: "claude-agent-sdk:${version}"`), "Claude capability revision must track the pinned SDK version.");
assert(!adapter.includes("allowDangerouslySkipPermissions: true"), "Claude permission bypass is forbidden.");
assert(nativeValues.includes("subscription OAuth cannot be used by a third-party product"), "Claude OAuth product-policy gate is missing.");
assert(notices.includes(`@anthropic-ai/claude-agent-sdk@${version}`), "Claude SDK notice version drifted.");
assert(notices.includes("does not redistribute"), "Claude SDK distribution boundary is missing from notices.");
assert(notices.includes("does not permit third-party"), "Claude authentication-policy notice is missing.");
assert(license.includes("© Anthropic PBC. All rights reserved."), "Claude SDK license notice is incomplete.");

console.log("Claude Agent SDK provenance and product-policy check passed.");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
