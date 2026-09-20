// Explicit opt-in: validate official archives supplied by the caller. Installation
// stays in a temporary HOME, only --version executes, no login or account read.
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createManagedArtifactInstaller } from "../../../../electron/main/local-agent-activation/managed-artifact-installer.mjs";
import { runActivationProcess } from "../../../../electron/main/local-agent-activation/activation-process.mjs";
import { codexActivationRecipe } from "../../../../electron/main/local-agent-activation/recipes/codex.mjs";
import { cursorActivationRecipe } from "../../../../electron/main/local-agent-activation/recipes/cursor.mjs";
const directory = process.argv[2];
assert(directory && path.isAbsolute(directory), "Pass an absolute directory containing codex/cursor-{arm64,x64}.tgz.");
const results = [];
for (const [id, recipeFor] of [["codex", codexActivationRecipe], ["cursor", cursorActivationRecipe]]) {
  for (const arch of ["arm64", "x64"]) {
    const archive = path.join(directory, `${id}-${arch}.tgz`); const stat = await fs.stat(archive);
    const homedir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-artifact-verify-")));
    try {
      const recipe = recipeFor("darwin", arch); let versionOutput = null;
      const installer = createManagedArtifactInstaller({ homedir, fetch: async url => {
        assert.equal(url, recipe.artifact.url);
        return new Response(Readable.toWeb(createReadStream(archive)), { headers: { "content-length": String(stat.size) } });
      } });
      const entry = await installer.install(recipe, { signal: new AbortController().signal, verify: async executable => {
        assert((await fs.stat(executable)).isFile());
        if (arch === process.arch && process.platform === "darwin") {
          const result = await runActivationProcess(executable, ["--version"], {
            cwd: homedir, env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", HOME: homedir,
              XDG_CONFIG_HOME: path.join(homedir, ".config"), AGENT_CLI_CREDENTIAL_STORE: "file" }, timeoutMs: 30_000,
          });
          assert.equal(result.code, 0, result.stderr); assert(result.stdout.includes(recipe.version)); versionOutput = result.stdout.trim();
        }
      } });
      assert((await fs.stat(entry)).isFile()); results.push({ id, arch, integrity: true, layout: true, versionOutput });
    } finally { await fs.rm(homedir, { recursive: true, force: true }); }
  }
}
console.log(JSON.stringify({ passed: true, results }, null, 2));
