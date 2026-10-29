//! The built-in viewer contributions in match order
//! (`builtinViewerContributions.ts`) — the only list of them. Matching is the
//! product's; each viewer's surface lives in `editor::viewers`.
//!
//! Viewers the product renders with a canvas or app runtime the native build
//! does not have yet edit their source as text (context map, PuppyFlow,
//! HTML) or show an honest "preview unavailable" placeholder (app preview,
//! PDF, database, Office, audio, video).
use super::contribution::{
    Presentation::{Native, Unavailable},
    Profile, ProviderPolicy, SemanticInput, ViewerImplementation, ViewerMatch,
};
use crate::editor::viewers::{code, csv, image, pdf, placeholder, text};

fn yes(_: &ViewerMatch, _: &str) -> bool {
    true
}
fn kind(m: &ViewerMatch, kind: &str) -> bool {
    m.document.kind == kind
}
fn viewer(m: &ViewerMatch, viewer: &str) -> bool {
    m.format.default_viewer == viewer
}

pub fn contributions() -> Vec<ViewerImplementation> {
    vec![
        ViewerImplementation {
            id: "context-map",
            policy: None,
            matches: |m| m.format.id == "context-map",
            editable: Some(yes),
            presentation: Native(text::open_source),
        },
        ViewerImplementation {
            id: "app-preview",
            policy: None,
            matches: |m| kind(m, "app") || viewer(m, "app-preview"),
            editable: None,
            presentation: Unavailable,
        },
        ViewerImplementation {
            id: "markdown",
            policy: Some(ProviderPolicy {
                profile: Profile::EditableDocument,
                source_toggle: true,
                semantic_inputs: &[SemanticInput::LinkGraph, SemanticInput::AssetResolver],
                document_directory: false,
            }),
            matches: |m| kind(m, "markdown") || viewer(m, "markdown-editor"),
            editable: Some(yes),
            presentation: Native(text::open_markdown),
        },
        ViewerImplementation {
            id: "puppyflow",
            policy: None,
            matches: |m| m.format.id == "puppyflow",
            editable: Some(yes),
            presentation: Native(text::open_source),
        },
        ViewerImplementation {
            id: "json",
            policy: None,
            matches: |m| kind(m, "json") || m.format.id == "json" || m.format.id == "jsonl",
            editable: Some(yes),
            presentation: Native(code::open),
        },
        ViewerImplementation {
            id: "csv-table",
            policy: None,
            matches: |m| viewer(m, "csv-table"),
            editable: Some(yes),
            presentation: Native(csv::open),
        },
        ViewerImplementation {
            id: "html-artifact",
            policy: Some(ProviderPolicy {
                profile: Profile::EditableDocument,
                source_toggle: true,
                semantic_inputs: &[],
                document_directory: true,
            }),
            matches: |m| kind(m, "html") || viewer(m, "html-artifact"),
            editable: Some(yes),
            presentation: Native(text::open_source),
        },
        ViewerImplementation {
            id: "image-preview",
            policy: None,
            matches: |m| kind(m, "image") || viewer(m, "image-preview"),
            editable: None,
            presentation: Native(image::open),
        },
        ViewerImplementation {
            id: "pdf-preview",
            policy: None,
            matches: |m| kind(m, "pdf") || viewer(m, "pdf-preview"),
            editable: None,
            presentation: Native(pdf::open),
        },
        ViewerImplementation {
            id: "database-preview",
            policy: None,
            matches: |m| viewer(m, "database-preview"),
            editable: None,
            presentation: Unavailable,
        },
        ViewerImplementation {
            id: "office-preview",
            policy: None,
            matches: |m| viewer(m, "office-preview"),
            editable: None,
            presentation: Unavailable,
        },
        ViewerImplementation {
            id: "audio-preview",
            policy: None,
            matches: |m| kind(m, "audio") || viewer(m, "audio-preview"),
            editable: None,
            presentation: Unavailable,
        },
        ViewerImplementation {
            id: "video-preview",
            policy: None,
            matches: |m| kind(m, "video") || viewer(m, "video-preview"),
            editable: None,
            presentation: Unavailable,
        },
        ViewerImplementation {
            id: "text",
            policy: None,
            matches: |m| {
                kind(m, "code")
                    || kind(m, "text")
                    || viewer(m, "plain-text")
                    || viewer(m, "monaco-code")
            },
            editable: Some(yes),
            presentation: Native(code::open),
        },
    ]
}

/// `fallbackViewerContribution`: every document has an honest surface.
pub fn fallback() -> ViewerImplementation {
    ViewerImplementation {
        id: "document-placeholder",
        policy: None,
        matches: |_| true,
        editable: None,
        presentation: Native(placeholder::open_binary),
    }
}
