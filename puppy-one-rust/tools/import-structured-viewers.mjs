#!/usr/bin/env node
// Bundle the product's structured document viewers (PuppyFlow, Context
// Map; tools/structured-viewer-entry.tsx) against the product sources into
// assets/web/structured-viewers.{js,css} with a provenance receipt
// (assets/web/structured-viewers.json). `--check` fails on drift.
import {bundleProductPage, BASE_STYLES} from './product-web-bundle.mjs';

await bundleProductPage({
  name: 'structured-viewers',
  entry: 'tools/structured-viewer-entry.tsx',
  // Public assets (agent brand images) are served under this prefix by
  // src/editor/viewers/structured.rs.
  baseUrl: '__assets__/public/',
  styles: [
    ...BASE_STYLES.slice(0, -1),
    'src/shared-ui/styles/floating-notice.css',
    'src/shared-ui/styles/file-icons.css',
    'src/shared-ui/styles/editor/puppyflow-editor.css',
    'src/shared-ui/styles/editor/context-map-viewer.css',
    BASE_STYLES.at(-1),
  ],
});
