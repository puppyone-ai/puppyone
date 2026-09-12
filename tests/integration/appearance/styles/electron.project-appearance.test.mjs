import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectAppearanceStore } from "../../../../electron/main/project-appearance/project-appearance-store.mjs";
import { normalizeProjectIcon } from "../../../../electron/main/project-appearance/project-appearance-service.mjs";
import {
  buildProjectIconAssetUrl,
  parseProjectIconAssetUrl,
  registerProjectIconProtocol,
} from "../../../../electron/main/project-appearance/project-icon-protocol.mjs";
import { registerProjectAppearanceIpcHandlers } from "../../../../electron/main/ipc/project-appearance-ipc.mjs";

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("normalized-project-icon"),
]);
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    fs.rm(directory, { recursive: true, force: true })
  )));
});

describe("local-first Project appearance store", () => {
  it("persists content-addressed icons outside the Project and removes unreferenced assets", async () => {
    const userDataPath = await createTemporaryDirectory();
    const store = createProjectAppearanceStore({
      userDataPath,
      now: sequenceClock(),
    });
    const first = await store.setIcon("wsi_alpha1234", PNG);
    const second = await store.setIcon("wsi_beta12345", PNG);
    const assetId = createHash("sha256").update(PNG).digest("hex");

    expect(first.icon).toMatchObject({ kind: "asset", assetId });
    expect(second.icon).toMatchObject({ kind: "asset", assetId });
    expect(await fs.readFile(path.join(store.paths.assets, `${assetId}.png`))).toEqual(PNG);
    expect((await fs.readdir(store.paths.assets))).toEqual([`${assetId}.png`]);

    await store.resetIcon("wsi_alpha1234");
    expect(await fs.stat(path.join(store.paths.assets, `${assetId}.png`))).toBeTruthy();
    await store.resetIcon("wsi_beta12345");
    await expect(fs.stat(path.join(store.paths.assets, `${assetId}.png`))).rejects.toMatchObject({
      code: "ENOENT",
    });

    const persisted = JSON.parse(await fs.readFile(store.paths.index, "utf8"));
    expect(persisted).toMatchObject({ schemaVersion: 2, revision: 4, projects: {} });
    expect(JSON.stringify(persisted)).not.toContain(userDataPath);
  });

  it("rejects traversal-shaped identities and non-PNG bytes", async () => {
    const store = createProjectAppearanceStore({ userDataPath: await createTemporaryDirectory() });
    await expect(store.setIcon("../outside", PNG)).rejects.toThrow("identity is invalid");
    await expect(store.setIcon("wsi_alpha1234", Buffer.from("not png"))).rejects.toThrow(
      "valid bounded PNG",
    );
    await expect(store.setEmoji("wsi_alpha1234", "AA")).rejects.toThrow("emoji is invalid");
  });

  it("stores a single emoji as structured metadata and migrates legacy image records", async () => {
    const userDataPath = await createTemporaryDirectory();
    const store = createProjectAppearanceStore({ userDataPath, now: sequenceClock() });
    const assetId = createHash("sha256").update(PNG).digest("hex");
    await fs.mkdir(store.paths.assets, { recursive: true });
    await fs.writeFile(path.join(store.paths.assets, `${assetId}.png`), PNG);
    await fs.writeFile(store.paths.legacyIndex, JSON.stringify({
      schemaVersion: 1,
      revision: 1,
      projects: {
        wsi_legacy1234: {
          icon: { kind: "asset", assetId, mediaType: "image/png" },
          updatedAt: "2026-09-04T00:00:00.000Z",
        },
      },
      updatedAt: "2026-09-04T00:00:00.000Z",
    }));

    await store.ensureLayout();
    const [legacy] = await store.list(["wsi_legacy1234"]);
    expect(legacy.icon).toMatchObject({ kind: "asset", assetId });
    const emoji = await store.setEmoji("wsi_legacy1234", "🧠");
    expect(emoji.icon).toMatchObject({ kind: "emoji", value: "🧠" });
    expect(JSON.parse(await fs.readFile(store.paths.index, "utf8"))).toMatchObject({
      schemaVersion: 2,
      revision: 2,
      projects: {
        wsi_legacy1234: { icon: { kind: "emoji", value: "🧠" } },
      },
    });
    expect(await fs.readdir(store.paths.assets)).toEqual([]);
  });

  it("detects an asset whose bytes no longer match its content-addressed filename", async () => {
    const store = createProjectAppearanceStore({ userDataPath: await createTemporaryDirectory() });
    const appearance = await store.setIcon("wsi_alpha1234", PNG);
    expect(appearance.icon?.kind).toBe("asset");
    const assetPath = path.join(store.paths.assets, `${appearance.icon.assetId}.png`);
    await fs.writeFile(assetPath, Buffer.concat([PNG, Buffer.from("tampered")]));

    await expect(store.readAsset(appearance.icon.assetId)).rejects.toThrow(
      "Stored Project icon is invalid",
    );
  });
});

describe("Project icon normalization", () => {
  it("center-crops, bounds, and re-encodes the selected image as a square PNG", async () => {
    const sourcePath = path.join(await createTemporaryDirectory(), "source.jpg");
    await fs.writeFile(sourcePath, Buffer.from("image-source"));
    const resize = vi.fn(() => ({ toPNG: () => PNG }));
    const crop = vi.fn(() => ({ resize }));
    const nativeImage = {
      createFromPath: vi.fn(() => ({
        isEmpty: () => false,
        getSize: () => ({ width: 640, height: 480 }),
        crop,
      })),
    };

    await expect(normalizeProjectIcon({ sourcePath, nativeImage })).resolves.toEqual(PNG);
    expect(crop).toHaveBeenCalledWith({ x: 80, y: 0, width: 480, height: 480 });
    expect(resize).toHaveBeenCalledWith({ width: 256, height: 256, quality: "best" });
  });
});

describe("Project icon asset protocol", () => {
  it("serves only exact content-hash URLs with immutable image headers", async () => {
    const assetId = "a".repeat(64);
    const handlers = new Map();
    registerProjectIconProtocol({
      protocol: { handle: (scheme, handler) => handlers.set(scheme, handler) },
      store: { readAsset: vi.fn(async (requestedId) => {
        expect(requestedId).toBe(assetId);
        return PNG;
      }) },
      applicationUrl: "file:///Applications/PuppyOne/index.html",
    });
    const handler = handlers.get("puppyone-asset");
    const response = await handler(new Request(buildProjectIconAssetUrl(assetId)));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=31536000, immutable");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(PNG);
    expect(parseProjectIconAssetUrl(buildProjectIconAssetUrl(assetId))).toBe(assetId);
    expect(() => parseProjectIconAssetUrl(
      `puppyone-asset://project-icon/${assetId}.png?path=/etc/passwd`,
    )).toThrow();
  });
});

describe("Project appearance IPC", () => {
  it("broadcasts committed local changes to every live window", async () => {
    const handlers = new Map();
    const appearance = { projectIdentity: "wsi_alpha1234", icon: null };
    const service = {
      list: vi.fn(async () => [appearance]),
      chooseIcon: vi.fn(async () => ({ status: "updated", appearance })),
      resetIcon: vi.fn(async () => appearance),
      setEmoji: vi.fn(async () => appearance),
    };
    const send = vi.fn();
    registerProjectAppearanceIpcHandlers({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      service,
      getWindows: () => [
        { isDestroyed: () => false, webContents: { isDestroyed: () => false, send } },
        { isDestroyed: () => true, webContents: { isDestroyed: () => false, send } },
      ],
    });

    await handlers.get("project-appearance:choose-icon")(
      { sender: { id: 7 } },
      { projectIdentity: "wsi_alpha1234" },
    );
    expect(send).toHaveBeenCalledWith("project-appearance:changed", appearance);
    expect(send).toHaveBeenCalledTimes(1);

    await handlers.get("project-appearance:set-emoji")(
      { sender: { id: 7 } },
      { projectIdentity: "wsi_alpha1234", emoji: "🧠" },
    );
    expect(service.setEmoji).toHaveBeenCalledWith({
      projectIdentity: "wsi_alpha1234",
      emoji: "🧠",
    });
    expect(send).toHaveBeenCalledTimes(2);
  });
});

async function createTemporaryDirectory() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-project-appearance-"));
  temporaryDirectories.push(directory);
  return directory;
}

function sequenceClock() {
  let sequence = 0;
  return () => new Date(Date.UTC(2026, 8, 4, 0, 0, sequence++));
}
