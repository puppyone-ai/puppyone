import { defineMarkdownFeature } from "../../core/features/markdownFeatureContract";
import { markdownCalloutExtension } from "./calloutExtension";

export const calloutFeature = defineMarkdownFeature({
  id: "callout",
  semanticKinds: [],
  inlineWidgetKinds: [],
  blockWidgetKinds: [],
  livePreviewExtensions: [markdownCalloutExtension],
});
