# File icon themes

File-format detection stays outside this directory. A theme receives a semantic
`FileIconRenderContext` and owns only its visual treatment.

## Classification boundary

- `core/fileFormats.json` is the source of truth for product-family identity.
  Formats such as Word, Excel, and PowerPoint declare `semanticKind` there.
- Common formats derive their semantic kind deterministically from viewer and
  category. Icon themes never inspect extensions, MIME types, or filenames.
- `file` is the explicit terminal state for an unknown format. It is not a
  renderer fallback for a missing known kind.

## Semantic coverage invariant

- `core/fileFormats.ts` owns the runtime `FILE_SEMANTIC_KINDS` tuple and its
  `FileSemanticKind` type. The icon layer aliases that contract; it must not
  maintain a second semantic union.
- A base theme must select a renderer for every semantic kind with
  `FileIconRendererMap` (or an equally exhaustive `Record`). Several kinds may
  deliberately point at the same generic document renderer.
- Base themes are assembled by `createIconTheme` or
  `createCustomPreviewIconTheme`; both factories require that exhaustive map.
  Variants are assembled by `createThemeVariant` and inherit base coverage.
- Do not use a partial renderer map followed by a generic document/file
  fallback. That hides omissions and turns new or forgotten kinds into the
  wrong icon.
- A variant may use partial overrides because every missing key delegates to an
  already exhaustive base theme. This is deliberate theme inheritance, not
  unknown-file fallback.

## Dependency direction

```text
iconThemeTypes/shared
        ↓
theme implementations
        ↓
registry
        ↓
fileIcons
```

- Theme implementations may import contracts, shared visual primitives, and
  another theme only when inheritance is intentional.
- Themes must not import the registry, `fileIcons`, or the compatibility entry.
- The registry is the only module that assembles all built-in themes.
- `fileIconThemeRegistry.tsx` remains a thin compatibility re-export.

## Line weight and ink

- Stroke every glyph with `glyphLine(size, viewBox)` from `shared/glyphLine.ts`.
  Glyphs then share the weight of the label text beside them: one CSS pixel up
  to explorer size, growing with larger previews.
- Plain documents (Markdown, text, other documents, unknown and binary files)
  take the label's ink (`currentColor`) and stay unfilled. Kinds whose colour
  tells the user what the file is keep their type accent.
- Folders are chevrons and code is `<>`. Documents (Markdown, text, PDF,
  archives) are one page with a folded corner and two lines of text, in their
  kind's ink, so a document never reads as a folder chevron; a file whose
  contents cannot be told is the same page left blank. A folder glyph in a
  row sits in a padded field so it weighs the same as its neighbours.

## Theme organization

- Keep compact tree glyphs in `glyphs.tsx`.
- Split large preview renderers into `previews.tsx`.
- Keep small themes in one `index.tsx` until another split improves ownership.
- Share only stable visual primitives. Theme-specific SVG paths stay with their
  theme even when a more generic abstraction would be possible.

## Adding a theme

Only `default` ships today. The plug-in contract stays in place for the next
theme:

1. Create `icon-themes/<id>/` and build the theme with one factory:
   `createIconTheme` (own glyphs, shared preview shell),
   `createCustomPreviewIconTheme` (own glyphs and previews), or
   `createThemeVariant` (inherit a base theme, override a few kinds).
2. Add `<id>` to `FileIconThemeId` in `../fileIconTypes.ts`.
3. List the theme in `registry.ts` (`FILE_ICON_THEME_ORDER` and
   `FILE_ICON_THEME_REGISTRY`). The `satisfies` check fails until 2 and 3 agree.
4. Add `settings.appearance.fileIcons.<id>.label` and `.description` to every
   renderer locale. Appearance settings show the File icons choice only while
   more than one theme is registered.
5. Re-export the Rust frontend's icon catalog
   (`puppy-one-rust/tools/import-file-icons.mjs`).

`check-data-ui-boundaries` discovers every theme folder, so a new theme gets
the same factory, dependency and coverage checks without editing the script.

Removing a theme maps its id to a remaining theme in `registry.ts`
(`RETIRED_FILE_ICON_THEME_IDS`) so saved preferences never fail to load.
