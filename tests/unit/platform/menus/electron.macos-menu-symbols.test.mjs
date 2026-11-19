import { describe, expect, it, vi } from "vitest";
import {
  MACOS_MENU_SYMBOL_SCALE,
  NO_MENU_SYMBOLS,
  createMacosMenuSymbolPort,
} from "../../../../electron/main/platform/macos/menu-symbols.mjs";
import { createDesktopPlatformHost } from "../../../../electron/main/platform/create-platform-host.mjs";

function createNativeImage(symbols = { gearshape: { width: 32, height: 32 } }) {
  const created = [];
  const nativeImage = {
    createFromNamedImage: vi.fn((name) => {
      const size = symbols[name];
      return {
        isEmpty: () => !size,
        getSize: () => size ?? { width: 0, height: 0 },
        resize: vi.fn((target) => ({ toPNG: () => Buffer.from(JSON.stringify(target)) })),
      };
    }),
    createEmpty: vi.fn(() => {
      const image = {
        representations: [],
        template: false,
        addRepresentation: vi.fn((representation) => image.representations.push(representation)),
        setTemplateImage: vi.fn((template) => { image.template = template; }),
      };
      created.push(image);
      return image;
    }),
  };
  return { nativeImage, created };
}

describe("macOS menu symbols", () => {
  it("draws SF Symbols from macOS 26 at menu glyph size, crisp at 1x and 2x, as template images", () => {
    const { nativeImage } = createNativeImage();
    const port = createMacosMenuSymbolPort({ nativeImage, systemVersion: "26.0.1" });
    const image = port.image("gearshape");

    expect(port.supported).toBe(true);
    expect(nativeImage.createFromNamedImage).toHaveBeenCalledWith("gearshape");
    const side = Math.round(32 * MACOS_MENU_SYMBOL_SCALE);
    expect(image.representations.map(({ scaleFactor, width, height }) => ({ scaleFactor, width, height }))).toEqual([
      { scaleFactor: 1, width: side, height: side },
      { scaleFactor: 2, width: side, height: side },
    ]);
    expect(JSON.parse(image.representations[1].buffer.toString())).toEqual({ width: side * 2, height: side * 2, quality: "best" });
    expect(image.template).toBe(true);
    expect(port.image("gearshape")).toBe(image);
    expect(nativeImage.createFromNamedImage).toHaveBeenCalledOnce();
  });

  it("returns no image for symbols the system does not know", () => {
    const { nativeImage } = createNativeImage();
    expect(createMacosMenuSymbolPort({ nativeImage, systemVersion: "26.0" }).image("not.a.symbol")).toBeUndefined();
  });

  it("keeps menus bare before macOS 26, where standard commands carry no symbols", () => {
    const { nativeImage } = createNativeImage();
    for (const systemVersion of ["15.6.1", "14.0", "", undefined]) {
      const port = createMacosMenuSymbolPort({ nativeImage, systemVersion });
      expect(port).toBe(NO_MENU_SYMBOLS);
      expect(port.image("gearshape")).toBeUndefined();
    }
    expect(createMacosMenuSymbolPort({ nativeImage: null, systemVersion: "26.0" })).toBe(NO_MENU_SYMBOLS);
    expect(nativeImage.createFromNamedImage).not.toHaveBeenCalled();
  });

  it("is a macOS platform capability", () => {
    const { nativeImage } = createNativeImage();
    const macos = createDesktopPlatformHost({ nodePlatform: "darwin", nodeArch: "arm64", nativeImage, systemVersion: "26.1" });
    expect(macos.menuSymbols.supported).toBe(true);
    for (const nodePlatform of ["win32", "linux"]) {
      const host = createDesktopPlatformHost({ nodePlatform, nodeArch: "x64", nativeImage, systemVersion: "26.1" });
      expect(host.menuSymbols).toBe(NO_MENU_SYMBOLS);
    }
  });
});
