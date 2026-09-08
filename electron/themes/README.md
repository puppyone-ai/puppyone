# PuppyOne Sub Themes

This folder is the runtime guide copied into the user Themes Folder. A Sub Theme changes the visual variant of a compatible PuppyOne Root Theme; it does not replace the application shell or style editor internals.

## Appearance model

PuppyOne resolves appearance in four layers:

1. **Root Theme** owns shell structure, component geometry, interaction policy, and the public token contract. Current Root Themes are `default` and `windows-xp`.
2. **Color Mode** resolves `light` or `dark` inside the active Root Theme. `system` is a request that resolves to one of those effective modes.
3. **Sub Theme** supplies a compatible visual variant for the effective mode. Light and Dark selections are remembered independently inside each Root Theme.
4. **Surface overrides** are typed product settings, such as Markdown heading scale. They have final authority and are not arbitrary CSS.

The user-facing resolution is:

`Root Theme → effective Color Mode → compatible Sub Theme variant → typed surface overrides → accessibility/last-resort product overrides`

Underneath that model, a generated Neutral fallback sits at the lowest CSS
layer. It keeps the client readable when a theme is missing or damaged; it is
not another selectable theme and never outranks a valid Root/Sub Theme.

Shared editors remain generic. They inherit public `--po-host-md-*` and `--po-host-csv-*` tokens from the application root; installed themes cannot select CodeMirror, Markdown, CSV, or other editor implementation nodes.

## Where this folder belongs

Open **Settings → Appearance → Open Themes Folder**. Add either:

- a directory containing one self-describing `theme.css` file (recommended);
- a directory containing `theme.json` and one CSS entrypoint per declared target; or
- one top-level `.css` file using the coordinated `@puppyone-theme` format below.

PuppyOne refreshes the catalog when its window regains focus.

The **+** action in Appearance creates a new `custom-theme/theme.css`, reveals
the file in this folder, refreshes the catalog, and selects it. Repeated use
creates `custom-theme-2`, `custom-theme-3`, and so on. The built-in Sub Themes
remain inside the application and are intentionally not copied here as editable
duplicates.

The recommended user layout is:

```text
themes/
├── ocean/
│   └── theme.css
└── newsprint/
    └── theme.css
```

The directory name is organizational for installed themes. Identity always
comes from the `id` inside `@puppyone-theme`.

## Package format

`theme.json`:

```json
{
  "schemaVersion": 1,
  "id": "com.example.newsprint",
  "name": "Newsprint",
  "version": "1.0.0",
  "author": "Example Studio",
  "compatibleRootThemeIds": ["default"],
  "modes": ["light", "dark"],
  "targets": ["application", "markdown", "csv"],
  "entrypoints": {
    "application": "application.css",
    "markdown": "markdown.css",
    "csv": "csv.css"
  }
}
```

Rules:

- `id` is a stable lowercase reverse-domain identifier with at least three segments.
- `compatibleRootThemeIds` defaults to `["default"]` when omitted.
- `modes` contains one or both of `light` and `dark`.
- A theme appears only when it declares a variant for the current effective mode. A light-only theme is never offered while Dark is active.
- Light and Dark are independent user slots. Selecting a theme for Light does not overwrite the remembered Dark theme, and vice versa.
- `targets` contains one or more of `application`, `markdown`, and `csv` and must match `entrypoints` exactly.
- Each entrypoint is a direct package-local `.css` filename.

## Single-file format

```css
@puppyone-theme {
  id: com.example.newsprint;
  name: Newsprint;
  version: 1.0.0;
  author: Example Studio;
  compatible-root-themes: default;
  modes: light dark;
}

@puppyone application {
  :root {
    --po-surface-canvas: #f5f0e8;
    /* An opaque literal enables matching browser and native first paint. */
    --po-canvas: #f5f0e8;
    --po-text: #2f2b27;
    --po-accent: #8b2f24;
  }

  .dark .theme-root {
    --po-surface-canvas: #17130f;
    --po-canvas: #17130f;
    --po-text: #f4eee6;
    --po-accent: #d99082;
  }
}

@puppyone typography {
  :root {
    --po-text-size-content: 16px;
    --po-text-size-conversation: 14px;
    --po-code-font-size: 13px;
    --po-terminal-font-size: 13px;
  }
}

@puppyone markdown {
  :root {
    --po-md-surface-background: #f5f0e8;
    --po-md-content-color: #342f29;
    --po-md-content-font: Georgia, serif;
    --po-md-link-color: #8b2f24;
  }
}

@puppyone csv {
  :root {
    --po-csv-surface-background: #f5f0e8;
    --po-csv-surface-color: #342f29;
    --po-editable-table-border: #cbbfaf;
  }
}
```

A metadata-free top-level CSS file is accepted as a Markdown-only compatibility theme only when it follows the same root-token contract.

`modes` is a capability contract, not descriptive text. Internally PuppyOne
normalizes it into explicit `variants.light` / `variants.dark` records and
injects only the effective variant. Common root declarations may be shared by
both modes, while `.dark` declarations provide Dark overrides. A light-only
theme may not contain hidden `.dark` selectors, and themes may not use
`prefers-color-scheme` to bypass the selected Color Mode.

Dual-mode Application themes must keep every static color token isolated by
mode. If a common root rule assigns a literal value to a public Application
token, the Dark variant must override that token explicitly. Adaptive values
derived with `var()` or `light-dark()` may remain shared because they continue
to resolve against the active mode's primitives. The compiler rejects static
common values that would otherwise leak Light colors into Dark mode.

For an Application target, declare `--po-canvas` as an opaque three- or
six-digit hex literal in every supported mode. PuppyOne compiles this token
into the synchronous browser and native-window first-paint value. Other CSS
forms remain valid as runtime tokens, but cannot be safely evaluated before
CSS loads; a missing or invalid first-paint literal therefore uses the Neutral
fallback until the selected theme mounts. Built-in Application themes are
stricter and fail generation when a declared mode omits this literal.

## Built-in source packages

Checked-in Sub Themes use the same single-file parser and token compiler as
installed themes. Their repository source is intentionally data-only:

```text
sub-themes/
├── default-neutral/theme.css
├── default-warm/theme.css
├── default-graphite/theme.css
├── default-github/theme.css
├── default-newspaper/theme.css
└── windows-xp-luna-blue/theme.css
```

There is no hand-written `manifest.ts` and no hand-maintained built-in registry.
Each package contains exactly one `theme.css`. Run `npm run generate:sub-themes`
after editing or adding a package; the generator parses metadata, validates Root
Theme compatibility and targets, compiles public tokens, and writes the runtime
registry plus generated fallback/first-paint projections. `default-neutral`
is both a normal theme and the sole editable fallback source.
`npm run check:sub-themes` rejects stale output or an invalid package.

Reserved two-segment IDs, `builtin-order`, and `legacy-*-preset` metadata are
accepted only by this checked-in generator. Installed themes continue to use
reverse-domain IDs and cannot opt into product compatibility metadata.

## CSS boundary

Every rule must be root-only. Use `:root`, `.theme-root`, `html`, `body`, or `#write` as an authoring alias; PuppyOne compiles the alias to its scoped appearance root. Dark values may use `.theme-root.dark` or `.dark .theme-root`.

Allowed examples:

```css
:root {
  --po-md-content-color: #342f29;
  --po-md-h1-size: 30px;
}

.dark .theme-root {
  --po-md-content-color: #ece8e1;
}
```

Disallowed examples:

```css
/* Element and implementation selectors are rejected. */
h1 { color: red; }
.theme-root h1 { color: red; }
.cm-editor { background: red; }
.markdown-codemirror-editor { color: red; }

/* Global resources and forced precedence are rejected. */
@font-face { font-family: Reader; src: url("reader.woff2"); }
:root { --po-md-content-color: red !important; }
```

The compiler also rejects remote imports, external URLs, global selectors, sibling escapes, unsupported at-rules, normal CSS declarations, and unknown tokens. `@import` may reference only package-local CSS and imported files must follow the same contract.

## Public tokens

Application targets accept only the published PuppyOne color tokens, including:

- surfaces: `--po-surface-canvas`, `--po-surface-chrome`, `--po-surface-panel`, `--po-control`;
- text and borders: `--po-text`, `--po-text-muted`, `--po-border`, `--po-divider`;
- state: `--po-hover`, `--po-selected`, `--po-accent`, `--po-focus-ring`, `--po-danger`, `--po-success`, `--po-warning`.

Typography targets accept bounded pixel defaults for `--po-text-size-interface`, `--po-text-size-content`, `--po-text-size-conversation`, `--po-text-size-data`, `--po-code-font-size`, and `--po-terminal-font-size`. A user's explicit Appearance setting always takes precedence and never rewrites the theme file. Markdown targets accept the public `--po-md-*` presentation tokens, such as content, heading, link, quote, inline-code, code-block, and syntax colors. CSV targets accept `--po-csv-*` plus the documented `--po-editable-table-*` presentation tokens.

PuppyOne maps these author-facing names to private host-boundary variables during compilation. Do not author `--po-host-*` variables directly.

## Troubleshooting

- If a theme is absent, inspect the diagnostics shown in Appearance settings.
- If a theme falls back, confirm that `compatibleRootThemeIds`, `modes`, and `targets` satisfy the active Root Theme.
- The `default` Root Theme requires `application`, `markdown`, and `csv`; `windows-xp` currently requires `markdown` and `csv` and supports light mode only.
- If a visual value seems overridden, check typed surface preferences. Those intentionally have higher priority than a Sub Theme.
