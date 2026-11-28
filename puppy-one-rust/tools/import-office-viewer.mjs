#!/usr/bin/env node
// Bundle the product's Office preview (tools/office-viewer-entry.tsx) against
// the product sources into assets/web/office-viewer.{js,css} and its three
// workers (office-*.worker.js), with a provenance receipt
// (assets/web/office-viewer.json). `--check` fails on drift.
import {bundleProductPage} from './product-web-bundle.mjs';

await bundleProductPage({
  name: 'office-viewer',
  entry: 'tools/office-viewer-entry.tsx',
  // The surface's own styles and the tokens they read. Colours are overlaid
  // by the native theme at runtime (src/editor/viewers/office.rs).
  styles: [
    'src/styles/fallback-theme.generated.css',
    'src/styles/tokens.css',
    'src/styles/typography/foundations.css',
    'src/styles/typography/locales.css',
    'src/styles/typography/roles.css',
    'src/shared-ui/styles/control-geometry.css',
    'src/shared-ui/styles/loading-mark.css',
    'src/shared-ui/styles/loading-placeholder.css',
    'src/shared-ui/styles/floating-notice.css',
    'src/shared-ui/styles/editor/preview-surfaces.css',
    'src/shared-ui/styles/editor/media-office-preview.css',
    'src/styles/tooltip.css',
  ],
  workers: {
    'office-validation.worker.js': 'src/shared-ui/editor/security/officePackageValidation.worker.ts',
    'office-spreadsheet.worker.js': 'src/shared-ui/editor/viewers/office/spreadsheetPreview.worker.ts',
    'office-text.worker.js': 'src/shared-ui/editor/viewers/office/officeTextFallback.worker.ts',
  },
});
