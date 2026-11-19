import { defineMarkdownFeature } from "../../core/features/markdownFeatureContract";
import { markdownMediaParserExtension } from "./markdownMediaParserExtension";

export const mediaSyntaxFeature = defineMarkdownFeature({
  id: "media-syntax",
  semanticKinds: [],
  inlineWidgetKinds: [],
  blockWidgetKinds: [],
  parserExtensions: [markdownMediaParserExtension],
});
