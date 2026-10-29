# Third-party material

Original project code follows the repository [Apache-2.0 license](../LICENSE).
Dependencies and assets retain their own licenses.

## GPUI native input

[GPUI 0.2.2](https://crates.io/crates/gpui/0.2.2), by the Zed contributors,
is licensed under Apache-2.0. `src/native_editor/gpui/input.rs` (exported through `src/ui/input.rs`) is adapted from the published
crate's `examples/input.rs`: native selection, text shaping, clipboard and
`EntityInputHandler` integration. This project adds multiline wrapping,
style runs, editing limits, grouped IME history, model events and caret scrolling.
The shell, integrated native editor and independent probe use this shared module.
The upstream crate records source revision
`zed-industries/zed@69e2130295c2649963eb639fc70b4f2ee8ea1624` (dirty packaging tree);
that revision identifies the original example, not the current dependency graph.
The current text renderer and ordinary form engine are provided by Kit.

No Zed application/editor implementation is included. The integrated native editor
and probe own their document models, formatting, table commands and history.

## GPUI Kit

[GPUI Kit 0.8.0](https://github.com/longbridge/gpui-kit/tree/v0.8.0), Apache-2.0,
is the single application UI dependency. It supplies Base, Component, assets,
and the matching gpui-pre 0.3.9 platform crates. The app uses public widgets and
`base::text::editor_host`; no Kit source is vendored or forked, and no independent
Markdown editor package is included. Ordinary Input/Textarea editing and history
are upstream; the continuous document retains its host-owned editing model.

## Other material

- `unicode-segmentation`: MIT OR Apache-2.0; grapheme boundaries.
- Embedded icons/fonts and their retained notices: [assets/README.md](assets/README.md).
- Probe fonts and dependency details: [native-editor-probe/THIRD_PARTY.md](native-editor-probe/THIRD_PARTY.md).

Both Cargo lockfiles pin the full dependency graph. This is an unpublished local
experiment; a distributable package still needs a complete dependency-notice audit.

## PDFium

The PDF viewer renders pages with PDFium (BSD-3-Clause / Apache-2.0, the engine
of Chromium's PDF viewer), loaded at runtime from the app bundle's
`Frameworks/libpdfium.dylib`. Builds come from bblanchon/pdfium-binaries
(`chromium/8125`, pinned with its SHA-256 by `tools/fetch-pdfium.py`); the
license ships as `PDFIUM_LICENSE.txt`. `pdfium-render` (MIT/Apache-2.0) binds it.

## Browser renderers for Office previews

`assets/web/vendor/` carries the exact builds the Electron product uses,
copied by `tools/import-web-vendor.py`: docx-preview 0.4.0 (Apache-2.0),
JSZip 3.10.1 (MIT), @aiden0z/pptx-renderer 1.2.4 (Apache-2.0) and SheetJS
xlsx 0.20.3 (Apache-2.0). They run only inside the sandboxed preview WebView.

## HTML visual editor bundle

`assets/web/html-visual.{js,css}` is the product's HTML visual editor
(`HtmlVisualSurface` and the shared-ui primitives it uses) bundled against
the product checkout by `tools/import-html-visual.mjs`, with a source-hash
receipt in `assets/web/html-visual.json`. It includes React 18.3.1 and
react-dom (MIT), scheduler (MIT), parse5 8.0.0 (MIT) with entities 7.0.1
(BSD-2-Clause), PostCSS 8.5 (MIT) with nanoid, picocolors and source-map-js
(MIT / ISC / BSD-3-Clause), @codemirror/state, view, commands and language
and @lezer/common and highlight (MIT) with style-mod, w3c-keyname and crelt
(MIT), intl-messageformat (BSD-3-Clause) with the @formatjs parsers (MIT),
lucide-react (ISC) and tslib (0BSD). License comments are kept at the end of
the script. It runs only in the HTML viewer's Edit-mode WebView.
