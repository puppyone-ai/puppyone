import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = readJson("package.json");
const lock = readJson("package-lock.json");
const adoption = readJson("vendor/pi-kernel/SOURCE_ADOPTION.json");
const version = manifest.dependencies?.[adoption.package];
const locked = lock.packages?.[`node_modules/${adoption.package}`];
const kernel = read("electron/main/agent/runtimes/puppyone-agent/puppyone-agent-kernel.mjs");
const worker = read("electron/main/agent/runtimes/puppyone-agent/worker/runtime.mjs");
const policy = read("electron/main/agent/runtimes/puppyone-agent/worker/policy.mjs");
const environment = read("electron/main/agent/runtimes/puppyone-agent/puppyone-agent-environment.mjs");
const discovery = read("electron/main/agent/runtimes/puppyone-agent/puppyone-agent-discovery.mjs");
const notices = read("THIRD_PARTY_NOTICES.md");
const license = read("vendor/pi-kernel/LICENSE");

assert(version === adoption.version, "Pi SDK production dependency must be pinned exactly.");
assert(locked?.version === adoption.version, "Pi SDK lockfile version drifted.");
assert(locked?.integrity === adoption.npmIntegrity, "Pi SDK package integrity drifted.");
assert(kernel.includes(`version: "${adoption.version}"`), "Managed kernel version pin drifted.");
assert(kernel.includes(`sourceCommit: "${adoption.sourceCommit}"`), "Managed kernel source commit drifted.");
assert(worker.includes("createAgentSessionRuntime") && worker.includes("runRpcMode"), "PuppyOne Agent must embed the official Pi SDK runtime API.");
for (const gate of ["noExtensions: true", "noSkills: true", "noPromptTemplates: true", "noContextFiles: true"]) {
  assert(worker.includes(gate), `Managed Pi worker isolation gate is missing: ${gate}`);
}
assert(policy.includes("puppyone.tool-approval.v1") || policy.includes("PUPPYONE_AGENT_APPROVAL_PROTOCOL"), "Managed tool approval bridge is missing.");
assert(environment.includes("PUPPYONE_PROVIDER_ENVIRONMENT_KEYS"), "Managed provider credentials need an explicit allowlist.");
assert(!environment.includes("_API_KEY|_ACCESS_TOKEN|_AUTH_TOKEN|_CREDENTIALS|_PROFILE"), "Managed provider credentials must not use a suffix wildcard.");
assert(worker.includes("stripPuppyOneProviderCredentials") && worker.includes("customTools"), "Model-callable shell tools must not inherit provider credentials.");
assert(discovery.includes("There is deliberately no PATH fallback"), "Managed discovery must not fall back to user-installed Pi.");
assert(!JSON.stringify(manifest.build?.extraResources ?? []).includes("opencode"), "The retired managed OpenCode binary must not be packaged.");
assert((manifest.build?.files ?? []).includes("vendor/pi-kernel/**"), "The packaged app must include Pi SDK provenance and license files.");
assert(notices.includes(`${adoption.package}@${adoption.version}`), "Pi SDK third-party notice is incomplete.");
assert(license.includes("Copyright (c) 2025 Mario Zechner"), "Pi SDK MIT license notice is incomplete.");

console.log("PuppyOne Pi SDK kernel provenance and isolation check passed.");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
