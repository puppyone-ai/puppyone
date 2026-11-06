#!/usr/bin/env node
// Bundle the product's App Preview (tools/app-preview-entry.tsx) against the
// product sources into assets/web/app-preview.{js,css} with a provenance
// receipt (assets/web/app-preview.json). `--check` fails on drift.
import {bundleProductPage, BASE_STYLES} from './product-web-bundle.mjs';

await bundleProductPage({
  name: 'app-preview',
  entry: 'tools/app-preview-entry.tsx',
  styles: [
    ...BASE_STYLES.slice(0, -1),
    'src/shared-ui/styles/floating-notice.css',
    'src/shared-ui/styles/editor/editor-chrome.css',
    'src/shared-ui/styles/editor/code-editor.css',
    'src/shared-ui/styles/editor/preview-surfaces.css',
    BASE_STYLES.at(-1),
  ],
});
