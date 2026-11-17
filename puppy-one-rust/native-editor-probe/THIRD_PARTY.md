# Third-party material

Original probe code follows the repository's [Apache-2.0 license](../../LICENSE). This does not replace any dependency's or asset's own license.

## Dependencies

- [GPUI Kit 0.8.0](https://github.com/longbridge/gpui-kit/tree/v0.8.0): Apache-2.0, including its matching gpui-pre backend. The shared native input in `../src/ui/input.rs` is originally adapted from GPUI 0.2.2’s published `examples/input.rs`. See the shared [attribution](../THIRD_PARTY.md).
- `unicode-segmentation`: MIT OR Apache-2.0, used for grapheme navigation.
- Exact transitive versions are in `Cargo.lock`; `cargo tree --locked` records the selected native dependency graph. This is a local, unpublished experiment, not a completed redistribution-license audit. A distributable package must carry all applicable notices, not just this summary.

## Embedded fonts

`assets/Geist-Regular.ttf` and `assets/Geist-Bold.ttf` derive from the repository's `public/fonts/geist/Geist-Variable.woff2`, instantiated at weights 400 and 700, with distinct Regular/Bold style and PostScript names for CoreText registration. Copyright 2024 The Geist Project Authors. Licensed under the **SIL Open Font License 1.1**, retained at [assets/Geist-OFL.txt](assets/Geist-OFL.txt).

`assets/OpenSans-{Regular,Bold,Italic,BoldItalic}.ttf` are converted from the
repository's corresponding `public/fonts/open-sans/*.woff2`, with no outline
modification. These real style faces render the rich-text area's bold and italic
in GPUI, which does not synthesize missing font faces. Copyright 2020 The Open
Sans Project Authors. SIL Open Font License 1.1, retained at
[assets/OpenSans-OFL.txt](assets/OpenSans-OFL.txt).

Rebuild only when intentionally updating assets:

```bash
python3 tools/import-fonts.py
```

This development helper requires fonttools[woff]; font conversion and downloading do not occur at runtime.

On macOS the process may read an already-installed system Unicode fallback font. That OS font is **not copied or redistributed** with this source or executable.
