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

## GPUI test scheduler

`vendor/gpui-pre-scheduler` contains `gpui-pre-scheduler` 0.3.9, Apache-2.0,
from Zed revision `93d745668805029476e6d7fbb19652116fed51de`. The retained
`LICENSE-APACHE` covers the source. `PUPPYONE_PATCH.md` documents the narrow
lock-order fix in its test scheduler; the platform scheduler is unchanged.

## Other material

- `unicode-segmentation`: MIT OR Apache-2.0; grapheme boundaries.
- `unicode-normalization` 0.1 (MIT / Apache-2.0): NFKD for installed theme slugs and file-name collation in the Themes Folder.
- `assets/themes/`: the product's Themes Folder guide, Markdown theme contract and built-in Sub Theme sources, copied by `tools/import-theme-contract.mjs` (product licence).
- `rusty-leveldb` 4.0.2 (MIT) with `snap` (BSD-3-Clause) and `crc32c` (Apache-2.0 / MIT): reads the Electron product's `localStorage` once, for the first-launch preference import.
- `tar` 0.4.46 (MIT / Apache-2.0) with `filetime` (MIT / Apache-2.0) and `flate2` 1.1 (MIT / Apache-2.0): read the reviewed Codex and Cursor CLI archives for Local Agent activation. The archives are validated and written by `src/platform/local_agent_setup/installer.rs`; the crate never unpacks them.
- `hmac` 0.12 (MIT / Apache-2.0) over the existing `sha2`: the product's monthly-rotating anonymous analytics identifiers (`src/platform/telemetry/store.rs`).
- `image` 0.25.10 (MIT / Apache-2.0) with its PNG, JPEG and WebP codecs (`png`, `zune-jpeg`, `image-webp`; MIT / Apache-2.0, `zune-jpeg` also Zlib), already in the graph through GPUI: feedback screenshots are sniffed, decoded and re-encoded (`src/platform/feedback.rs`).
- `assets/providers/`: model provider and local service marks from [LobeHub Icons](https://github.com/lobehub/lobe-icons) (`@lobehub/icons-static-svg` 1.104.0, MIT; notice in `assets/providers/LICENSE-lobe-icons.txt`) and, for llama.cpp (MIT), MLX (MIT), Jan (Apache-2.0), LocalAI (MIT), oMLX (Apache-2.0) and Unsloth (Apache-2.0), from each project's own repository (sources in [assets/README.md](assets/README.md)), shown on the Model Connections page and in Chat.
- Built-in Agent OAuth sign-in (`src/agent/model_connections/oauth/`) ports the flows of [Pi Coding Agent](https://github.com/earendil-works/pi) at `d981de1229ef899957bbe968bc8dcda02a21f477` (`packages/ai/src/auth/oauth/`), MIT, Copyright (c) 2025 Mario Zechner. Qwen Code sign-in (`oauth/qwen.rs`) follows [Qwen Code](https://github.com/QwenLM/qwen-code) `packages/core/src/qwen/qwenOAuth2.ts`, Apache-2.0.
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

## Office preview bundle

`assets/web/office-viewer.js`, its CSS and its three workers are the
product's own Office preview, bundled from the pinned product checkout by
`tools/import-office-viewer.mjs` (receipt: `assets/web/office-viewer.json`).
They include the renderers the Electron product uses — docx-preview 0.4.0
(Apache-2.0), JSZip 3.10.1 (MIT), @aiden0z/pptx-renderer 1.2.4 (Apache-2.0)
and SheetJS xlsx 0.20.3 (Apache-2.0) — with their license comments kept at
the end of each file. They run only inside the preview WebView.

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

## Excalidraw whiteboard Viewer Pack (`puppyone.excalidraw`)

The Excalidraw whiteboard (`ExcalidrawViewer` over `ExcalidrawDocumentModel`,
including `@excalidraw/excalidraw` 0.18.1 MIT and its 234 SDK fonts) is
decoupled from the base application binary and app bundle as the on-demand
`puppyone.excalidraw` Viewer Pack (`tools/release/package-excalidraw-pack.py`),
with its SHA-256 digests pinned in `assets/web/excalidraw.json` and
`assets/web/excalidraw-fonts.json`. When installed into the user's
`viewer-packs/` directory, the archive carries `LICENSE` and `FONT-NOTICES.txt`
(`licenses/excalidraw/`) and runs only inside the whiteboard's WebView.

## Diagram and formula render page

`assets/web/render-service.{js,css}` is the page the native render service
(`src/render_service`) draws Markdown diagrams and formulas in: the product's
Mermaid host settings and SVG sanitizer with Mermaid 11.17.0 (MIT), and KaTeX
0.16.47 (MIT) with its WOFF2 fonts inlined in the stylesheet, bundled against
the product checkout by `tools/import-render-service.mjs` (receipt in
`assets/web/render-service.json`). Both licenses ship as
`MERMAID_LICENSE.txt` and `KATEX_LICENSE.txt` (`licenses/render-service/`,
copied from the pinned npm packages). The page runs hidden, offline and
locked to its own document; only its snapshots reach the window.

## Terminal custom glyphs

`assets/terminal-glyphs.json` holds xterm.js's custom glyph definitions
(box drawing, block elements, shade patterns and Powerline symbols) as
`tools/import-xterm-glyphs.mjs` extracts them from the product's
`@xterm/addon-webgl` 0.19.0 (MIT, Copyright (c) 2017-2019 The xterm.js
authors), with the bundle's SHA-256 recorded in the file. The native
terminal draws them in `src/features/terminal_glyphs.rs`.
