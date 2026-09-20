import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  FILE_ICON_THEMES,
  FILE_VISUAL_KINDS,
  FileGlyphIcon,
  FilePreviewIcon,
  getFileVisualKind,
  isFileIconThemeId,
  parseFileIconThemeId,
  type FileIconThemeId,
} from "../../../../packages/shared-ui/src/file/fileIcons";
import {
  getSemanticKindForFormat,
  getPreferredMimeType,
  resolveFileFormat,
  type FileFormat,
} from "../../../../packages/shared-ui/src/core/fileFormats";
import { FILE_ICON_THEME_REGISTRY } from "../../../../packages/shared-ui/src/file/icon-themes/registry";

describe("file icon semantics", () => {
  it.each(["data.db", "data.db3", "data.sqlite", "data.sqlite3", "data.duckdb", "data.ddb", "DATA.DB"])(
    "classifies %s as a database without changing binary admission",
    (name) => {
      expect(getFileVisualKind(name, "file")).toBe("database");
      expect(getFileVisualKind(name, "binary")).toBe("database");
      expect(resolveFileFormat({ name })).toMatchObject({
        id: "database-candidate",
        semanticKind: "database",
        category: "binary",
        defaultViewer: "database-preview",
        editable: false,
        ingestStrategy: "raw",
      });
    },
  );

  it.each(["application/vnd.sqlite3", "application/x-sqlite3", "application/vnd.duckdb"])(
    "resolves %s to the same database semantic identity",
    (mimeType) => {
      expect(getSemanticKindForFormat(resolveFileFormat({ mimeType }))).toBe("database");
    },
  );

  it("does not mistake arbitrary binary files for databases or DB candidates for SQLite", () => {
    expect(getPreferredMimeType("data.db")).toBe("application/octet-stream");
    expect(getPreferredMimeType("data.db3")).toBe("application/octet-stream");
    expect(getFileVisualKind("firmware.bin")).toBe("file");
    expect(getFileVisualKind("firmware.bin", "binary")).toBe("binary");
    expect(getFileVisualKind("unknown.unregistered")).toBe("file");
    expect(getSemanticKindForFormat(resolveFileFormat({ mimeType: "application/octet-stream" }))).not.toBe("database");
  });

  it.each(FILE_ICON_THEMES)(
    "renders standalone database cylinders for glyphs and previews in the $id theme",
    ({ id }) => {
      for (const name of ["data.db", "data.db3", "data.sqlite", "data.sqlite3", "data.duckdb", "data.ddb"]) {
        for (const markup of [
          renderToStaticMarkup(<FileGlyphIcon name={name} type="binary" size={18} theme={id} />),
          renderToStaticMarkup(<FilePreviewIcon name={name} type="file" size={56} theme={id} />),
        ]) {
          expect(markup).toContain('data-file-icon-shape="database-cylinder"');
          expect(markup).toContain("<ellipse");
          expect(markup.match(/<svg\b/g)).toHaveLength(1);
          expect(markup).not.toContain('viewBox="0 0 44 54"');
          expect(markup).not.toContain("drop-shadow");
          expect(markup).toContain("var(--po-file-accent-code)");
          expect(markup).toContain('viewBox="-3 -3 30 30"');
        }
      }
    },
  );

  it.each(FILE_ICON_THEMES)(
    "keeps database icon slots stable while reducing the artwork in the $id theme",
    ({ id }) => {
      for (const size of [14, 18, 24]) {
        const markup = renderToStaticMarkup(<FileGlyphIcon name="data.db" size={size} theme={id} />);
        expect(markup).toContain(`width="${size}"`);
        expect(markup).toContain(`height="${size}"`);
        expect(markup).toContain('viewBox="-3 -3 30 30"');
      }
    },
  );

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

  it.each<FileIconThemeId>(["default", "lines", "semantic", "material", "minimal"])(
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

  it.each<FileIconThemeId>(["default", "lines", "semantic", "material", "minimal"])(
    "renders spreadsheet glyphs as a standalone table grid in the %s theme",
    (theme) => {
      const markup = renderToStaticMarkup(<FileGlyphIcon name="table.csv" size={18} theme={theme} />);

      expect(markup).toContain('data-file-icon-shape="table-grid"');
      expect(markup).toContain('data-file-icon-grid="2x2"');
    },
  );

  it.each<FileIconThemeId>(["default", "lines", "semantic", "material", "minimal"])(
    "renders a recognizable Word mark in the %s theme",
    (theme) => {
      const markup = renderToStaticMarkup(
        <FileGlyphIcon name="proposal.docx" size={18} theme={theme} />,
      );

      expect(markup).toContain('data-file-icon-office="word"');
      expect(markup).toContain('data-file-icon-shape="word-document"');
    },
  );

  it.each<FileIconThemeId>(["default", "lines", "semantic", "material", "minimal"])(
    "renders a recognizable Excel mark in the %s theme",
    (theme) => {
      const markup = renderToStaticMarkup(
        <FileGlyphIcon name="model.xlsx" size={18} theme={theme} />,
      );

      expect(markup).toContain('data-file-icon-office="excel"');
      expect(markup).toContain('data-file-icon-shape="excel-spreadsheet"');
    },
  );

  it.each<FileIconThemeId>(["default", "lines", "semantic", "material", "minimal"])(
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
      "semantic",
      "material",
      "minimal",
    ]);
  });

  it("migrates the retired branded theme ID without keeping it in the public contract", () => {
    expect(isFileIconThemeId("vscode")).toBe(false);
    expect(parseFileIconThemeId("vscode")).toBe("semantic");
    expect(parseFileIconThemeId("semantic")).toBe("semantic");
  });

  it.each<FileIconThemeId>(["default", "lines", "semantic", "material", "minimal"])(
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
