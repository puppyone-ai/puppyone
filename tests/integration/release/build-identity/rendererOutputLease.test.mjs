import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "vite";
import { acquireRendererOutputLease } from "../../../../electron/main/renderer-output-lease.mjs";
import { rendererOutputLeasePlugin } from "../../../../tooling/desktop/build/renderer-output-lease-plugin.mjs";

const roots = [];
const releases = [];
const children = [];

afterEach(async () => {
  releases.splice(0).forEach((release) => release());
  for (const child of children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const exited = once(child, "exit");
    child.kill();
    await exited;
  }
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-renderer-lease-")));
  roots.push(root);
  return { root, outputDirectory: path.join(root, "dist") };
}

function acquire(outputDirectory, mode) {
  const release = acquireRendererOutputLease({ outputDirectory, mode });
  releases.push(release);
  return release;
}

describe("renderer output lifetime", () => {
  it("allows multiple preview windows but excludes a build until every reader closes", async () => {
    const { outputDirectory } = await fixture();
    const first = acquire(outputDirectory, "preview");
    const second = acquire(outputDirectory, "preview");
    expect(() => acquire(outputDirectory, "build")).toThrow(/Close the preview normally/);
    first();
    expect(() => acquire(outputDirectory, "build")).toThrow(/Close the preview normally/);
    second();
    expect(() => acquire(outputDirectory, "build")).not.toThrow();
  });

  it("blocks preview startup and other builders while the output is being replaced", async () => {
    const { outputDirectory } = await fixture();
    const release = acquire(outputDirectory, "build");
    expect(() => acquire(outputDirectory, "preview")).toThrow(/Wait for the build to finish/);
    expect(() => acquire(outputDirectory, "build")).toThrow(/another build/);
    release();
    release();
    expect(() => acquire(outputDirectory, "preview")).not.toThrow();
  });

  it("isolates worktrees and resolves symlinks in the project path", async () => {
    const first = await fixture();
    const second = await fixture();
    const alias = path.join(second.root, "linked-project");
    await fs.symlink(first.root, alias, "dir");
    acquire(first.outputDirectory, "preview");
    expect(() => acquire(path.join(alias, "dist"), "build")).toThrow(/Close the preview normally/);
    expect(() => acquire(second.outputDirectory, "build")).not.toThrow();
  });

  it("reclaims a crashed process without deleting a living process's claim", async () => {
    const { outputDirectory } = await fixture();
    const moduleUrl = new URL("../../../../electron/main/renderer-output-lease.mjs", import.meta.url).href;
    const child = spawn(process.execPath, ["--input-type=module", "-e", `
      const { acquireRendererOutputLease } = await import(process.argv[1]);
      acquireRendererOutputLease({ outputDirectory: process.argv[2], mode: 'preview' });
      process.stdout.write('ready');
      setInterval(() => {}, 1000);
    `, moduleUrl, outputDirectory], { stdio: ["ignore", "pipe", "pipe"] });
    children.push(child);
    await once(child.stdout, "data");
    expect(() => acquire(outputDirectory, "build")).toThrow(/Close the preview normally/);
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    expect(() => acquire(outputDirectory, "build")).not.toThrow();
  });

  it("protects outputs reached through a direct directory symlink", async () => {
    const first = await fixture();
    const second = await fixture();
    await fs.mkdir(first.outputDirectory);
    await fs.symlink(first.outputDirectory, second.outputDirectory, "dir");
    acquire(first.outputDirectory, "preview");
    expect(() => acquire(second.outputDirectory, "build")).toThrow(/Close the preview normally/);
  });

  it("stops a real Vite rebuild before deleting a running window's lazy chunks", async () => {
    const { root, outputDirectory } = await fixture();
    await fs.writeFile(path.join(root, "index.html"), '<script type="module" src="/main.js"></script>');
    await fs.writeFile(path.join(root, "main.js"), "window.openChat = () => import('./chat.js');");
    await fs.writeFile(path.join(root, "chat.js"), "export const version = 'original-chat';");
    const rebuild = () => build({
      configFile: false,
      root,
      logLevel: "silent",
      base: "./",
      plugins: [rendererOutputLeasePlugin()],
    });
    await rebuild();
    const originalHtml = await fs.readFile(path.join(outputDirectory, "index.html"), "utf8");
    const originalFiles = await fs.readdir(path.join(outputDirectory, "assets"));
    const chatFile = originalFiles.find((name) => name.startsWith("chat-"));
    expect(chatFile).toBeTruthy();
    const preview = acquire(outputDirectory, "preview");
    await fs.writeFile(path.join(root, "chat.js"), "export const version = 'updated-chat';");
    await expect(rebuild()).rejects.toThrow(/Close the preview normally/);
    expect(await fs.readFile(path.join(outputDirectory, "index.html"), "utf8")).toBe(originalHtml);
    expect(await fs.readFile(path.join(outputDirectory, "assets", chatFile), "utf8")).toContain("original-chat");
    preview();
    await rebuild();
    expect(await fs.readFile(path.join(outputDirectory, "index.html"), "utf8")).not.toBe(originalHtml);
    expect((await fs.readdir(path.join(outputDirectory, "assets"))).includes(chatFile)).toBe(false);
    expect(() => acquire(outputDirectory, "preview")).not.toThrow();
  });

  it("releases the build lease after a compile failure", async () => {
    const { root, outputDirectory } = await fixture();
    await fs.writeFile(path.join(root, "index.html"), '<script type="module" src="/missing.js"></script>');
    await expect(build({
      configFile: false,
      root,
      logLevel: "silent",
      plugins: [rendererOutputLeasePlugin()],
    })).rejects.toThrow();
    expect(() => acquire(outputDirectory, "preview")).not.toThrow();
  });
});
