import { createCustomPreviewIconTheme } from "../themeFactory";
import { defaultGlyphRenderers } from "./glyphs";
import { renderDefaultPreview } from "./previews";

export const defaultTheme = createCustomPreviewIconTheme({
  id: "default",
  glyphRenderers: defaultGlyphRenderers,
  renderPreview: renderDefaultPreview,
});
