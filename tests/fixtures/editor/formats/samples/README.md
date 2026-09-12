# Editor Rendering Test Pack

This folder contains small English sample files for checking preview, metadata, and rendering support.

Suggested checks:

- Text preview and line wrapping
- Log preview and timestamp readability
- Markdown headings, lists, and code blocks
- Table rendering for CSV and spreadsheet files
- Audio playback controls and duration metadata
- Video playback controls, aspect ratios, and thumbnails
- Image previews and vector rendering
- PDF and Office document previews

Office fidelity fixtures:

- `puppyone-preview-sample.docx` checks authored Word pagination and typography.
- `puppyone-preview-sample.xlsx` checks workbook styles, formulas, and sheet navigation.
- `puppyone-presentation-fidelity.pptx` is a three-slide, 16:9 regression deck for
  Chinese/English typography, native shapes, merged tables, charts, and source colors.
  Its content and data are synthetic and safe for repeatable local rendering tests.

All sample content is intentionally short and safe to load repeatedly during development.

`pane-contract.webm` is a one-second synthetic VP8 test pattern (160 × 100,
10 fps) for repeatable Chromium video decoding and pane lifecycle checks.
It contains no recorded people, voices or workspace content. Generate it with:

```sh
ffmpeg -f lavfi -i 'testsrc2=size=160x100:rate=10:duration=1' -c:v libvpx -b:v 60k -an pane-contract.webm
```

FFmpeg is only needed to regenerate the checked-in fixture, not to run tests.
