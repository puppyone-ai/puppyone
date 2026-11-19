/**
 * SF Symbols beside the menu commands PuppyOne adds itself.
 *
 * From macOS 26 AppKit draws a symbol beside every standard menu command
 * (About, Services, Hide, Quit, Close, Edit and Window commands). Commands an
 * app defines get none, so a menu mixes decorated and bare rows. This port
 * gives those commands the symbol a native app would use:
 * - at the size AppKit draws its own menu glyphs. Named symbols arrive at
 *   their default configuration (gearshape measures 32 units); menu glyphs
 *   measure about 11.5pt, so every symbol is scaled by the same factor and
 *   keeps the optical proportions of the SF Symbols set;
 * - as template images, so they follow the menu's text colour, including the
 *   highlighted and disabled states.
 * Before macOS 26 menus carry no symbols, so the port returns none and custom
 * commands stay as bare as the standard ones.
 */
export const MACOS_MENU_SYMBOLS_FIRST_MAJOR_VERSION = 26;
export const MACOS_MENU_SYMBOL_SCALE = 0.36;

export function createMacosMenuSymbolPort({ nativeImage, systemVersion }) {
  const major = Number.parseInt(String(systemVersion ?? "").split(".")[0], 10);
  if (!nativeImage || !(major >= MACOS_MENU_SYMBOLS_FIRST_MAJOR_VERSION)) return NO_MENU_SYMBOLS;
  const images = new Map();
  return Object.freeze({
    supported: true,
    image(symbolName) {
      if (!images.has(symbolName)) images.set(symbolName, createMenuSymbolImage(nativeImage, symbolName));
      return images.get(symbolName);
    },
  });
}

export const NO_MENU_SYMBOLS = Object.freeze({
  supported: false,
  image: () => undefined,
});

function createMenuSymbolImage(nativeImage, symbolName) {
  const symbol = nativeImage.createFromNamedImage(symbolName);
  if (!symbol || symbol.isEmpty()) return undefined;
  const size = symbol.getSize();
  const width = Math.max(1, Math.round(size.width * MACOS_MENU_SYMBOL_SCALE));
  const height = Math.max(1, Math.round(size.height * MACOS_MENU_SYMBOL_SCALE));
  const image = nativeImage.createEmpty();
  for (const scaleFactor of [1, 2]) {
    const representation = symbol.resize({
      width: width * scaleFactor,
      height: height * scaleFactor,
      quality: "best",
    });
    image.addRepresentation({ scaleFactor, width, height, buffer: representation.toPNG() });
  }
  image.setTemplateImage(true);
  return image;
}
