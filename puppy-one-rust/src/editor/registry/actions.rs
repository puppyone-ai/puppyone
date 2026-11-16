//! Typed host commands, pane menu item identifiers and segmented mode switches (`RG-21`).
//!
//! External UI/serialization boundaries (`EditorCommand` action bindings,
//! standalone file-window header chrome, external WebView wire menus) bridge
//! strings once via `parse` / `as_wire`, keeping `ViewerSurface` strongly typed.

/// Markdown formatting commands dispatched through [`HostCommand::Format`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum MarkdownCommand {
    Bold,
    Italic,
    NewParagraph,
    Custom(String),
}

/// Typed host command dispatched by `DocumentEditor` to a [`super::ViewerSurface`] (`RG-21`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum HostCommand {
    Undo,
    Redo,
    Source,
    Copy,
    HtmlReload,
    Prepare,
    ReplayUndo,
    ReplayRedo,
    Format(MarkdownCommand),
}

impl HostCommand {
    pub fn parse(raw: &str) -> Self {
        match raw {
            "undo" => Self::Undo,
            "redo" => Self::Redo,
            "source" => Self::Source,
            "copy" => Self::Copy,
            "html-reload" => Self::HtmlReload,
            "prepare" => Self::Prepare,
            "replay-undo" => Self::ReplayUndo,
            "replay-redo" => Self::ReplayRedo,
            "bold" => Self::Format(MarkdownCommand::Bold),
            "italic" => Self::Format(MarkdownCommand::Italic),
            "new-paragraph" => Self::Format(MarkdownCommand::NewParagraph),
            other => Self::Format(MarkdownCommand::Custom(other.to_owned())),
        }
    }
}

impl From<&str> for HostCommand {
    fn from(raw: &str) -> Self {
        Self::parse(raw)
    }
}

impl From<&String> for HostCommand {
    fn from(raw: &String) -> Self {
        Self::parse(raw.as_str())
    }
}

/// Typed pane menu / header item identifier (`RG-21`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PaneItemId {
    DocumentEditing,
    DocumentSourcePanel,
    HtmlFolderAccess,
    CsvHeaderRow,
    CsvRowNumbers,
    CsvFitColumnsToViewport,
    CsvResetColumnWidths,
    ImageZoomFit,
    ImageZoomActual,
    ImageZoomIn,
    ImageZoomOut,
    PdfReload,
    PdfOutline(usize),
    External(&'static str),
}

impl PaneItemId {
    pub const DOCUMENT_EDITING_WIRE: &'static str = "document-editing";
    pub const DOCUMENT_SOURCE_PANEL_WIRE: &'static str = "document-source-panel";
    pub const HTML_FOLDER_ACCESS_WIRE: &'static str = "html-folder-access";
    pub const CSV_HEADER_ROW_WIRE: &'static str = "csv-header-row";
    pub const CSV_ROW_NUMBERS_WIRE: &'static str = "csv-row-numbers";
    pub const CSV_FIT_COLUMNS_WIRE: &'static str = "csv-fit-columns-to-viewport";
    pub const CSV_RESET_COLUMN_WIDTHS_WIRE: &'static str = "csv-reset-column-widths";
    pub const IMAGE_ZOOM_FIT_WIRE: &'static str = "image-zoom-fit";
    pub const IMAGE_ZOOM_ACTUAL_WIRE: &'static str = "image-zoom-actual";
    pub const IMAGE_ZOOM_IN_WIRE: &'static str = "image-zoom-in";
    pub const IMAGE_ZOOM_OUT_WIRE: &'static str = "image-zoom-out";
    pub const PDF_RELOAD_WIRE: &'static str = "pdf-reload";
    pub const PDF_OUTLINE_PREFIX: &'static str = "pdf-outline-";

    pub fn parse(raw: &'static str) -> Self {
        match raw {
            Self::DOCUMENT_EDITING_WIRE => Self::DocumentEditing,
            Self::DOCUMENT_SOURCE_PANEL_WIRE => Self::DocumentSourcePanel,
            Self::HTML_FOLDER_ACCESS_WIRE => Self::HtmlFolderAccess,
            Self::CSV_HEADER_ROW_WIRE => Self::CsvHeaderRow,
            Self::CSV_ROW_NUMBERS_WIRE => Self::CsvRowNumbers,
            Self::CSV_FIT_COLUMNS_WIRE => Self::CsvFitColumnsToViewport,
            Self::CSV_RESET_COLUMN_WIDTHS_WIRE => Self::CsvResetColumnWidths,
            Self::IMAGE_ZOOM_FIT_WIRE => Self::ImageZoomFit,
            Self::IMAGE_ZOOM_ACTUAL_WIRE => Self::ImageZoomActual,
            Self::IMAGE_ZOOM_IN_WIRE => Self::ImageZoomIn,
            Self::IMAGE_ZOOM_OUT_WIRE => Self::ImageZoomOut,
            Self::PDF_RELOAD_WIRE => Self::PdfReload,
            other => {
                if let Some(rest) = other.strip_prefix(Self::PDF_OUTLINE_PREFIX)
                    && let Ok(index) = rest.parse::<usize>()
                {
                    return Self::PdfOutline(index);
                }
                Self::External(other)
            }
        }
    }

    pub fn as_wire(self) -> &'static str {
        match self {
            Self::DocumentEditing => Self::DOCUMENT_EDITING_WIRE,
            Self::DocumentSourcePanel => Self::DOCUMENT_SOURCE_PANEL_WIRE,
            Self::HtmlFolderAccess => Self::HTML_FOLDER_ACCESS_WIRE,
            Self::CsvHeaderRow => Self::CSV_HEADER_ROW_WIRE,
            Self::CsvRowNumbers => Self::CSV_ROW_NUMBERS_WIRE,
            Self::CsvFitColumnsToViewport => Self::CSV_FIT_COLUMNS_WIRE,
            Self::CsvResetColumnWidths => Self::CSV_RESET_COLUMN_WIDTHS_WIRE,
            Self::ImageZoomFit => Self::IMAGE_ZOOM_FIT_WIRE,
            Self::ImageZoomActual => Self::IMAGE_ZOOM_ACTUAL_WIRE,
            Self::ImageZoomIn => Self::IMAGE_ZOOM_IN_WIRE,
            Self::ImageZoomOut => Self::IMAGE_ZOOM_OUT_WIRE,
            Self::PdfReload => Self::PDF_RELOAD_WIRE,
            Self::PdfOutline(_) => Self::PDF_OUTLINE_PREFIX,
            Self::External(wire) => wire,
        }
    }
}

/// Typed segmented mode switch identifier (`RG-21`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PaneSegmentId {
    Live,
    Source,
    Preview,
    Edit,
    External(&'static str),
}

impl PaneSegmentId {
    pub fn parse(raw: &'static str) -> Self {
        match raw {
            "live" => Self::Live,
            "source" => Self::Source,
            "preview" => Self::Preview,
            "edit" => Self::Edit,
            other => Self::External(other),
        }
    }

    pub fn as_wire(self) -> &'static str {
        match self {
            Self::Live => "live",
            Self::Source => "source",
            Self::Preview => "preview",
            Self::Edit => "edit",
            Self::External(wire) => wire,
        }
    }
}
