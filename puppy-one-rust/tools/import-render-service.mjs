#!/usr/bin/env node
// Bundle the product's diagram and formula renderers (Mermaid's host
// settings and SVG sanitizer, KaTeX with its fonts inlined) into
// assets/web/render-service.{js,css} for the native render service's
// hidden page (tools/render-service-entry.ts), with a provenance receipt
// (assets/web/render-service.json). `--check` fails on drift.
import {bundleProductPage} from './product-web-bundle.mjs';

await bundleProductPage({
  name: 'render-service',
  entry: 'tools/render-service-entry.ts',
  styles: [
    'src/styles/typography/foundations.css',
    'node_modules/katex/dist/katex.min.css',
  ],
  packages: ['mermaid', 'katex'],
  cssFonts: 'inline',
});
