# Authored OCR scan fixtures

These PNGs contain only synthetic text written for this repository. They have
no text layer, private documents, user names, or third-party document content.
They were rasterized on a white 1400 × 600 canvas using Pillow and the system
Arial Unicode font at 42 px, with lines at (80, 90 + 100 × row).
The font itself is not distributed.

| File | Text lines |
| --- | --- |
| english.png | Document conversion test / Hello world. Local OCR. / Invoice 0012    Total 1234.50 |
| chinese.png | 文档转换测试 / 中文识别保留核心内容 / 编号 0012    金额 1234.50 |
| mixed.png | 文档转换 Document conversion / 本地识别 Local OCR / 编号 Code 0012    金额 Total 1234.50 |
| table.png | Code                 Amount / 0012                 1234.50 / 0013                 5678.90 |

`tests/support/editor/conversionSamples.mjs` embeds these raster pixels in PDF
image streams. Acceptance covers image-only PDFs, a native-text page followed
by a scan, and a long native header above a scanned body on the same page.
These small clean samples verify integration and exact output strings, not a
general OCR accuracy benchmark for customer scans.
