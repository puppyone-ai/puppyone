import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import plist from "plist";
import { PNG } from "pngjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prepareMacosIconBeforePack from "../../../../scripts/before-pack-macos-icon.mjs";
import verifyMacosIconAfterPack from "../../../../scripts/after-pack-macos-icon.mjs";
import { resolveDesktopAppIcon } from "../../../../shared/desktop/app-icon-contract.mjs";
import { decodeAppIconPng } from "../../../../tooling/desktop/build/app-icon-validation.mjs";
import { resolveMacosIconBuildInputs, verifyMacosIcns } from "../../../../tooling/desktop/build/macos-app-icon.mjs";

describe("app icon input validation", () => {
  it("rejects a PNG signature without actual image data", () => {
    expect(() => decodeAppIconPng(Buffer.from("89504e470d0a1a0a", "hex"), 1024, "icon"))
      .toThrow(/1024 x 1024/);
  });

  it("rejects corrupt pixels even when the dimensions are valid", () => {
    const encoded = PNG.sync.write(new PNG({ width: 16, height: 16 }));
    encoded[encoded.length - 13] ^= 1;
    expect(() => decodeAppIconPng(encoded, 16, "icon")).toThrow(/decodable PNG/);
  });

  it("rejects a mismatched channel or unapproved output path", () => {
    expect(() => resolveMacosIconBuildInputs("/project", {
      mac: { icon: resolveDesktopAppIcon("dev").macos },
      extraResources: [{ from: resolveDesktopAppIcon("stable").source, to: "puppy-app-image.png" }],
    })).toThrow(/canonical PNG/);
    expect(() => resolveDesktopAppIcon("unknown")).toThrow(/Unsupported/);
  });

  it("does not run native tools for other platforms", async () => {
    await prepareMacosIconBeforePack({ electronPlatformName: "win32" });
    await verifyMacosIconAfterPack({ electronPlatformName: "linux" });
  });
});

// Exercise Apple's actual codec; cross-platform identity tests cover their own
// concerns independently, without pretending a mocked conversion is a native pass.
describe.skipIf(process.platform !== "darwin")("native macOS icon packaging", () => {
  let root;
  let fixtures;
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "puppyone-native-icons-"));
    fixtures = new Map();
    for (const channel of ["stable", "dev"]) {
      const icon = resolveDesktopAppIcon(channel);
      await fs.mkdir(path.dirname(path.join(root, icon.source)), { recursive: true });
      await fs.copyFile(new URL(`../../../../${icon.source}`, import.meta.url), path.join(root, icon.source));
      const context = {
        electronPlatformName: "darwin",
        appOutDir: path.join(root, channel),
        packager: {
          projectDir: root,
          appInfo: { productFilename: "PuppyOne" },
          config: {
            mac: { icon: icon.macos },
            extraResources: [{ from: icon.source, to: "puppy-app-image.png" }],
          },
        },
      };
      await prepareMacosIconBeforePack(context);
      fixtures.set(channel, {
        context,
        png: await fs.readFile(path.join(root, icon.source)),
        icns: await fs.readFile(path.join(root, icon.macos)),
      });
    }
  }, 30_000);
  afterAll(async () => {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  async function installFixture(channel = "stable", info = {}) {
    const fixture = fixtures.get(channel);
    const contents = path.join(fixture.context.appOutDir, "PuppyOne.app", "Contents");
    const resources = path.join(contents, "Resources");
    await fs.mkdir(resources, { recursive: true });
    await fs.writeFile(path.join(resources, "puppy-app-image.png"), fixture.png);
    await fs.writeFile(path.join(resources, "icon.icns"), fixture.icns);
    await fs.writeFile(path.join(contents, "Info.plist"), plist.build({ CFBundleIconFile: "icon.icns", ...info }));
    return { ...fixture, contents, resources };
  }

  it.each(["stable", "dev"])("verifies all ten %s icon representations without rewriting bundle files", async (channel) => {
    const fixture = await installFixture(channel);
    const files = [path.join(fixture.contents, "Info.plist"), ...["icon.icns", "puppy-app-image.png"]
      .map((filename) => path.join(fixture.resources, filename))];
    const before = await Promise.all(files.map((filename) => fs.readFile(filename)));
    await verifyMacosIconAfterPack(fixture.context);
    expect(await Promise.all(files.map((filename) => fs.readFile(filename)))).toEqual(before);
    expect(fixtures.get("stable").icns.equals(fixtures.get("dev").icns)).toBe(false);
  });

  it.each([{ CFBundleIconFile: "puppy-app-image.png" }, { CFBundleIconName: "AppIcon" }])(
    "rejects conflicting bundle icon metadata %j", async (info) => {
      const fixture = await installFixture("stable", info);
      await expect(verifyMacosIconAfterPack(fixture.context)).rejects.toThrow(/CFBundleIconFile/);
    },
  );

  it.each(["icon.icns", "puppy-app-image.png"])("rejects a missing %s", async (filename) => {
    const fixture = await installFixture();
    await fs.unlink(path.join(fixture.resources, filename));
    await expect(verifyMacosIconAfterPack(fixture.context)).rejects.toThrow(/ENOENT/);
  });

  it("rejects stale or substituted channel artwork", async () => {
    const fixture = await installFixture();
    await fs.writeFile(path.join(fixture.resources, "puppy-app-image.png"), fixtures.get("dev").png);
    await expect(verifyMacosIconAfterPack(fixture.context)).rejects.toThrow(/selected channel/);
    await expect(verifyMacosIcns(path.join(fixture.resources, "icon.icns"), fixtures.get("dev").png))
      .rejects.toThrow(/artwork does not match/);
  });

  it("rejects the incorrect Retina dimensions produced by the former converter", async () => {
    const fixture = await installFixture();
    const chunks = [];
    for (let offset = 8; offset < fixture.icns.length;) {
      const length = fixture.icns.readUInt32BE(offset + 4);
      const type = fixture.icns.toString("ascii", offset, offset + 4);
      if (type === "ic13") {
        const pixels = PNG.sync.write(new PNG({ width: 512, height: 512 }));
        const header = Buffer.alloc(8);
        header.write(type);
        header.writeUInt32BE(pixels.length + 8, 4);
        chunks.push(header, pixels);
      } else chunks.push(fixture.icns.subarray(offset, offset + length));
      offset += length;
    }
    const header = Buffer.from(fixture.icns.subarray(0, 8));
    header.writeUInt32BE(8 + chunks.reduce((size, chunk) => size + chunk.length, 0), 4);
    const iconPath = path.join(fixture.resources, "icon.icns");
    await fs.writeFile(iconPath, Buffer.concat([header, ...chunks]));
    await expect(verifyMacosIcns(iconPath, fixture.png)).rejects.toThrow(/256 x 256/);
  });
});
