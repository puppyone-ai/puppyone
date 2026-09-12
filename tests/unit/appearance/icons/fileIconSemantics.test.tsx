import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  FILE_ICON_THEMES,
  FILE_VISUAL_KINDS,
  FileGlyphIcon,
  FilePreviewIcon,
  getFileVisualKind,
  type FileIconThemeId,
} from "../../../../packages/shared-ui/src/file/fileIcons";
import {
  getSemanticKindForFormat,
  resolveFileFormat,
  type FileFormat,
} from "../../../../packages/shared-ui/src/core/fileFormats";
import { FILE_ICON_THEME_REGISTRY } from "../../../../packages/shared-ui/src/file/icon-themes/registry";

describe("file icon semantics", () => {
  it.each(["table.csv", "table.tsv", "table.ods"])("classifies %s as a generic spreadsheet", (name) => {
    expect(getFileVisualKind(name)).toBe("spreadsheet");
  });

  it.each(["table.xls", "table.xlsm", "table.xlsx"])(
    "classifies %s as an Excel workbook",
    (name) => {
      expect(getFileVisualKind(name)).toBe("excel");
    },
  );

  it("owns Office product identity in the format registry", () => {
    expect(resolveFileFormat({ name: "proposal.docx" }).semanticKind).toBe("word");
    expect(resolveFileFormat({ name: "model.xlsx" }).semanticKind).toBe("excel");
    expect(resolveFileFormat({ name: "deck.pptx" }).semanticKind).toBe("presentation");
  });

  it("classifies Context Map documents with their dedicated semantic icon", () => {
    expect(resolveFileFormat({ name: "Knowledge.contextmap" }).semanticKind).toBe("context-map");
    expect(getFileVisualKind("Knowledge.contextmap")).toBe("context-map");
  });

  it.each<FileIconThemeId>(["default", "lines", "vscode", "material", "minimal"])(
    "renders Context Map as a treasure map product mark in the %s theme",
    (theme) => {
      const markup = renderToStaticMarkup(
        <FileGlyphIcon name="Knowledge.contextmap" size={18} theme={theme} />,
      );

      expect(markup).toContain('data-file-icon-product="context-map"');
      expect(markup).toContain('data-file-icon-shape="treasure-map"');
      expect(markup).toContain('data-file-icon-complexity="minimal"');
      expect(markup).toContain('data-file-icon-route="treasure-trail"');
    },
  );

  it("fails fast instead of falling back for an invalid declared semantic kind", () => {
    const invalidFormat = {
      ...resolveFileFormat({ name: "model.xlsx" }),
      semanticKind: "unknown-office-product",
    } as unknown as FileFormat;

    expect(() => getSemanticKindForFormat(invalidFormat)).toThrow(
      "Unknown semantic kind for file format xlsx",
    );
  });

  it.each(["proposal.doc", "proposal.docx"])(
    "classifies %s as a Word document",
    (name) => {
      expect(getFileVisualKind(name)).toBe("word");
    },
  );

  it.each(["deck.ppt", "deck.pptx", "show.ppsx", "deck.odp"])(
    "classifies %s as a presentation",
    (name) => {
      expect(getFileVisualKind(name)).toBe("presentation");
    },
  );

  it.each(["movie.mp4", "movie.mov", "movie.webm"])(
    "classifies %s as video",
    (name) => {
      expect(getFileVisualKind(name)).toBe("video");
    },
  );

  it.each<FileIconThemeId>(["default", "lines"])(
    "renders compact video files with a player glyph in the %s theme",
    (theme) => {
      const markup = renderToStaticMarkup(
        <FileGlyphIcon name="movie.mp4" size={18} theme={theme} />,
      );

      expect(markup).toContain('data-file-icon-shape="video-player"');
    },
  );

  it.each(FILE_ICON_THEMES)(
    "renders every registered semantic kind in the $id theme",
    ({ id }) => {
      const theme = FILE_ICON_THEME_REGISTRY[id];

      for (const kind of FILE_VISUAL_KINDS) {
        const markup = renderToStaticMarkup(theme.renderGlyph({
          kind,
          name: `fixture.${kind}`,
          type: kind,
          label: kind.toUpperCase(),
          size: 18,
          color: "currentColor",
        }));

        expect(markup, `${id}:${kind}`).not.toBe("");
      }
    },
  );

  it.each<FileIconThemeId>(["default", "lines", "vscode", "material", "minimal"])(
    "renders spreadsheet glyphs as a standalone table grid in the %s theme",
    (theme) => {
      const markup = renderToStaticMarkup(<FileGlyphIcon name="table.csv" size={18} theme={theme} />);

      expect(markup).toContain('data-file-icon-shape="table-grid"');
      expect(markup).toContain('data-file-icon-grid="2x2"');
    },
  );

  it.each<FileIconThemeId>(["default", "lines", "vscode", "material", "minimal"])(
    "renders a recognizable Word mark in the %s theme",
    (theme) => {
      const markup = renderToStaticMarkup(
        <FileGlyphIcon name="proposal.docx" size={18} theme={theme} />,
      );

      expect(markup).toContain('data-file-icon-office="word"');
      expect(markup).toContain('data-file-icon-shape="word-document"');
    },
  );

  it.each<FileIconThemeId>(["default", "lines", "vscode", "material", "minimal"])(
    "renders a recognizable Excel mark in the %s theme",
    (theme) => {
      const markup = renderToStaticMarkup(
        <FileGlyphIcon name="model.xlsx" size={18} theme={theme} />,
      );

      expect(markup).toContain('data-file-icon-office="excel"');
      expect(markup).toContain('data-file-icon-shape="excel-spreadsheet"');
    },
  );

  it.each<FileIconThemeId>(["default", "lines", "vscode", "material", "minimal"])(
    "renders a recognizable presentation mark in the %s theme",
    (theme) => {
      const markup = renderToStaticMarkup(
        <FileGlyphIcon name="deck.pptx" size={18} theme={theme} />,
      );

      expect(markup).toContain('data-file-icon-office="presentation"');
      expect(markup).toContain('data-file-icon-shape="presentation-slide"');
    },
  );

  it("keeps Word, Excel, and presentation preview identities distinct", () => {
    const wordMarkup = renderToStaticMarkup(
      <FilePreviewIcon name="proposal.docx" size={56} theme="default" />,
    );
    const excelMarkup = renderToStaticMarkup(
      <FilePreviewIcon name="model.xlsx" size={56} theme="default" />,
    );
    const presentationMarkup = renderToStaticMarkup(
      <FilePreviewIcon name="deck.pptx" size={56} theme="default" />,
    );

    expect(wordMarkup).toContain('data-file-icon-office="word"');
    expect(wordMarkup).not.toContain('data-file-icon-office="excel"');
    expect(wordMarkup).not.toContain('data-file-icon-office="presentation"');
    expect(excelMarkup).toContain('data-file-icon-office="excel"');
    expect(excelMarkup).not.toContain('data-file-icon-office="word"');
    expect(excelMarkup).not.toContain('data-file-icon-office="presentation"');
    expect(presentationMarkup).toContain('data-file-icon-office="presentation"');
    expect(presentationMarkup).not.toContain('data-file-icon-office="word"');
    expect(presentationMarkup).not.toContain('data-file-icon-office="excel"');
  });

  it("publishes every built-in theme in deterministic registry order", () => {
    expect(FILE_ICON_THEMES.map(({ id }) => id)).toEqual([
      "default",
      "lines",
      "vscode",
      "material",
      "minimal",
    ]);
  });

  it.each<FileIconThemeId>(["default", "lines", "vscode", "material", "minimal"])(
    "renders folder previews and their child count through the %s theme",
    (theme) => {
      const markup = renderToStaticMarkup(
        <FilePreviewIcon
          name="folder"
          type="folder"
          size={56}
          childrenCount={3}
          theme={theme}
        />,
      );

      expect(markup).toContain("<svg");
      expect(markup).toContain(">3</span>");
    },
  );

  it("keeps the lines folder treatment inherited from the default theme", () => {
    const renderFolder = (theme: FileIconThemeId) => renderToStaticMarkup(
      <FilePreviewIcon name="folder" type="folder" size={56} theme={theme} />,
    );

    expect(renderFolder("lines")).toBe(renderFolder("default"));
  });
});
