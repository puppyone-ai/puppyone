import { createIconTheme } from "../themeFactory";
import {
  renderSemanticFolderPreviewGlyph,
  semanticGlyphRenderers,
} from "./glyphs";

export const semanticTheme = createIconTheme({
  id: "semantic",
  glyphRenderers: semanticGlyphRenderers,
  renderFolderPreviewGlyph: renderSemanticFolderPreviewGlyph,
});
