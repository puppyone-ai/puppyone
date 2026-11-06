//! `OfficeViewer` (`viewers/office`): the product's own Office preview,
//! bundled from its sources by `tools/import-office-viewer.mjs` and running in
//! the system web engine — Word through docx-preview with its zoom controls,
//! spreadsheets through the SheetJS worker and the virtualized grid,
//! presentations through pptx-renderer with thumbnails and navigation, the
//! OpenDocument and legacy text fallbacks, and the package preflight and
//! validation workers.
//!
//! This side serves the file (`puppyone-local:`, with the size probe the
//! product's loader sends first), converts .doc / .rtf to DOCX with `textutil`
//! (`convertOfficeDocumentToDocx`) and owns what leaves the page: opening the
//! file in its default application, opening links, and Retry.
use super::{html_visual::script_json, web::WebFrame};
use crate::{
    editor::registry::{SurfaceInput, SurfaceRequest, ViewerSurface},
    platform::webview::{Content, Entry, Ipc, local_url_for, url_for},
    workspace::{PreviewData, PreviewResource},
};
use gpui::{prelude::*, *};
use serde::Deserialize;
use std::path::{Path, PathBuf};

/// `office-preview` resourcePolicy.maxSourceBytes.
pub const BUDGET: u64 = 25 * 1024 * 1024;
const SCRIPT: &[u8] = include_bytes!("../../../assets/web/office-viewer.js");
const STYLE: &[u8] = include_bytes!("../../../assets/web/office-viewer.css");
const VALIDATION: &[u8] = include_bytes!("../../../assets/web/office-validation.worker.js");
const SPREADSHEET: &[u8] = include_bytes!("../../../assets/web/office-spreadsheet.worker.js");
const TEXT: &[u8] = include_bytes!("../../../assets/web/office-text.worker.js");
/// The DOCX `textutil` made of a .doc / .rtf, served beside nothing else.
const CONVERTED: &str = "__converted__.docx";

/// `NATIVE_DOCX_CONVERTIBLE_EXTENSIONS`.
fn convertible(extension: &str) -> bool {
    matches!(extension, "doc" | "rtf")
}
fn extension_of(name: &str) -> String {
    Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

/// Messages the page posts.
#[derive(Debug, PartialEq, Eq, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Inbound {
    OpenExternal,
    OpenUrl { url: String },
    Retry,
}

pub fn open(request: &SurfaceRequest, _: &mut Window, cx: &mut App) -> Box<dyn ViewerSurface> {
    let resource = match request.input {
        SurfaceInput::Resource(resource) => Some(resource.clone()),
        _ => None,
    };
    let (name, dark) = (request.name.to_owned(), request.dark);
    let extension = request
        .resolved_extension
        .map(str::to_lowercase)
        .unwrap_or_else(|| extension_of(&name));
    let view = cx.new(|cx| {
        let mut view = OfficeView {
            name,
            extension,
            dark,
            resource,
            frame: None,
            boot: serde_json::Value::Null,
            root: None,
            _served: None,
            _inbox: None,
        };
        view.load(cx);
        view
    });
    Box::new(OfficeSurface { view })
}

struct OfficeSurface {
    view: Entity<OfficeView>,
}
impl ViewerSurface for OfficeSurface {
    fn element(&self) -> AnyElement {
        self.view.clone().into_any_element()
    }
    fn rebind_resource(&self, resource: &PreviewResource, cx: &mut App) {
        let resource = resource.clone();
        self.view.update(cx, |view, cx| {
            view.resource = Some(resource);
            view.load(cx);
        });
    }
    /// The appearance follows the app without reloading the document.
    fn apply(
        &self,
        _: bool,
        dark: bool,
        _: crate::typography::Scale,
        _: &mut Window,
        cx: &mut App,
    ) {
        self.view.update(cx, |view, cx| view.set_dark(dark, cx));
    }
}
struct OfficeView {
    name: String,
    extension: String,
    dark: bool,
    resource: Option<PreviewResource>,
    frame: Option<Entity<WebFrame>>,
    /// What the current page was given: its boot fields and folder.
    boot: serde_json::Value,
    root: Option<PathBuf>,
    /// A private folder for Cloud bytes or a converted document.
    _served: Option<tempfile::TempDir>,
    _inbox: Option<Task<()>>,
}

/// What the page is given: the folder it may read and its boot fields.
struct Served {
    root: Option<PathBuf>,
    file_url: Option<String>,
    file_error: Option<String>,
    converted_url: Option<String>,
    conversion_error: Option<String>,
    warnings: Vec<String>,
    temporary: Option<tempfile::TempDir>,
}

impl OfficeView {
    /// The file's folder and name, or a private copy of Cloud bytes.
    fn source(&self) -> Result<(PathBuf, String, Option<tempfile::TempDir>), String> {
        match self.resource.as_ref().map(|r| r.data()) {
            Some(Ok(PreviewData::LocalFile(path))) => match (path.parent(), path.file_name()) {
                (Some(dir), Some(file)) => {
                    Ok((dir.to_path_buf(), file.to_string_lossy().into_owned(), None))
                }
                _ => Err("The Office document has no file name.".into()),
            },
            Some(Ok(PreviewData::Bytes { bytes, .. })) => {
                let file = Path::new(&self.name)
                    .file_name()
                    .map(|f| f.to_string_lossy().into_owned())
                    .unwrap_or_else(|| "document".into());
                let (dir, path) = crate::platform::webview::private_copy(&file, bytes)
                    .map_err(|e| e.to_string())?;
                let folder = path.parent().map(Path::to_path_buf).unwrap_or_default();
                Ok((folder, file, Some(dir)))
            }
            Some(Err(error)) => Err(error.to_string()),
            None => Err("The Office document is unavailable.".into()),
        }
    }
    fn serve(&self) -> Served {
        let empty = |error: Option<String>| Served {
            root: None,
            file_url: None,
            file_error: error,
            converted_url: None,
            conversion_error: None,
            warnings: vec![],
            temporary: None,
        };
        let (folder, file, temporary) = match self.source() {
            Ok(source) => source,
            Err(error) => return empty(Some(error)),
        };
        if !convertible(&self.extension) {
            return Served {
                root: Some(folder),
                file_url: Some(local_url_for(&file)),
                temporary,
                ..empty(None)
            };
        }
        // `convertOfficeDocumentToDocx`: the page reads only the result.
        let converted =
            crate::platform::office::convert_to_docx(&folder.join(&file)).and_then(|converted| {
                let dir = tempfile::Builder::new()
                    .prefix("puppyone-office-")
                    .tempdir()
                    .map_err(|e| e.to_string())?;
                crate::platform::webview::write_private(
                    &dir.path().join(CONVERTED),
                    &converted.bytes,
                )
                .map_err(|e| e.to_string())?;
                Ok((dir, converted.warnings))
            });
        match converted {
            Ok((dir, warnings)) => Served {
                root: Some(dir.path().to_path_buf()),
                converted_url: Some(url_for(CONVERTED)),
                warnings,
                temporary: Some(dir),
                ..empty(None)
            },
            Err(error) => Served {
                conversion_error: Some(error),
                ..empty(None)
            },
        }
    }
    /// A fresh page over the current input (opening, a new revision, Retry).
    fn load(&mut self, cx: &mut Context<Self>) {
        let served = self.serve();
        let boot = serde_json::json!({
            "name": Path::new(&self.name).file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default(),
            "path": self.name,
            "extension": self.extension,
            "fileUrl": served.file_url,
            "fileError": served.file_error,
            "convertedUrl": served.converted_url,
            "conversionError": served.conversion_error,
            "conversionWarnings": served.warnings,
            "canOpenExternal": self.local_path().is_some(),
            "locale": crate::localization::current_code(),
            "direction": "ltr",
            "messages": crate::localization::messages(&[
                "editor.office.", "editor.preview.", "editor.unavailable.", "editor.resource.",
                "editor.openDefaultApp", "common.", "shared-ui.",
            ]),
        });
        self.boot = boot;
        self.root = served.root;
        self._served = served.temporary;
        self.show(cx);
    }
    /// A new engine over the current boot fields in the current appearance.
    fn show(&mut self, cx: &mut Context<Self>) {
        let (tx, rx) = async_channel::unbounded::<String>();
        let content = Content {
            root: self.root.clone(),
            source: None,
            entry: Entry::Html(page(&self.boot, self.dark)),
            max_bytes: BUDGET,
            assets: vec![
                ("office-viewer.js", SCRIPT),
                ("office-viewer.css", STYLE),
                ("office-validation.worker.js", VALIDATION),
                ("office-spreadsheet.worker.js", SPREADSHEET),
                ("office-text.worker.js", TEXT),
            ],
            ipc: Some(Ipc(tx)),
            policy: None,
        };
        self.frame = Some(cx.new(|_| WebFrame::new(Some(content), self.dark)));
        self._inbox = Some(cx.spawn(async move |this, cx| {
            while let Ok(body) = rx.recv().await {
                let Ok(message) = serde_json::from_str::<Inbound>(&body) else {
                    continue;
                };
                let _ = this.update(cx, |view, cx| view.receive(message, cx));
            }
        }));
        cx.notify();
    }
    /// Swap the page's theme in place; before its engine exists, the page
    /// is simply rebuilt.
    fn set_dark(&mut self, dark: bool, cx: &mut Context<Self>) {
        if self.dark == dark {
            return;
        }
        self.dark = dark;
        let script = format!(
            "(function(){{var r=document.documentElement;r.classList.toggle(\"dark\",{dark});r.dataset.initialTheme=\"{scheme}\";var s=document.getElementById(\"po-native-tokens\");if(s)s.textContent={tokens};}})()",
            scheme = if dark { "dark" } else { "light" },
            tokens = script_json(&serde_json::Value::String(token_rule(dark))),
        );
        let applied = self
            .frame
            .as_ref()
            .is_some_and(|frame| frame.read(cx).evaluate(&script));
        if !applied {
            self.show(cx);
        }
    }
    fn receive(&mut self, message: Inbound, cx: &mut Context<Self>) {
        match message {
            Inbound::OpenExternal => {
                if let Some(path) = self.local_path() {
                    let _ = crate::platform::desktop::open(&path);
                }
            }
            Inbound::OpenUrl { url } => {
                if url.starts_with("https://") || url.starts_with("http://") {
                    let _ = crate::platform::desktop::open_url(&url);
                }
            }
            Inbound::Retry => self.load(cx),
        }
    }
    /// `openExternalFile`: local files only.
    fn local_path(&self) -> Option<PathBuf> {
        match self.resource.as_ref()?.data().ok()? {
            PreviewData::LocalFile(path) => Some(path.clone()),
            PreviewData::Bytes { .. } => None,
        }
    }
}

/// The entry document: the product's tokens with the native theme's
/// colours over them, then the bundle.
fn token_rule(dark: bool) -> String {
    let tokens: String = crate::theme::pack_tokens(dark)
        .iter()
        .filter(|(name, value)| {
            name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
                && !value.contains(['<', '>', '{', '}', ';'])
        })
        .map(|(name, value)| format!("--po-{name}:{value};"))
        .collect();
    format!(":root:root:root{{{tokens}}}")
}
fn page(boot: &serde_json::Value, dark: bool) -> String {
    let locale = crate::localization::current_code();
    let scheme = if dark { "dark" } else { "light" };
    format!(
        "<!doctype html><html lang=\"{lang}\" class=\"{class}\" data-initial-theme=\"{scheme}\"><head><meta charset=\"utf-8\">\
<meta name=\"viewport\" content=\"width=device-width\">\
<link rel=\"stylesheet\" href=\"__assets__/office-viewer.css\">\
<style id=\"po-native-tokens\">{tokens}</style><style>html,body,#root{{height:100%;margin:0}}body{{background:var(--po-editor-bg,var(--po-canvas));color:var(--po-text);font-family:var(--po-font-ui)}}#root>.office-document-host{{height:100%;display:flex;flex-direction:column}}</style>\
</head><body><div id=\"root\"></div><script>window.__PUPPYONE_OFFICE={boot}</script>\
<script src=\"__assets__/office-viewer.js\"></script></body></html>",
        lang = locale.replace(|c: char| !c.is_ascii_alphanumeric() && c != '-', ""),
        class = if dark { "dark" } else { "" },
        tokens = token_rule(dark),
        boot = script_json(boot),
    )
}

impl Render for OfficeView {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().size_full().children(self.frame.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn the_page_boots_the_product_bundle_and_reads_only_typed_messages() {
        let boot = serde_json::json!({ "name": "a</script><script>x</script>.docx" });
        let html = page(&boot, false);
        assert!(html.contains(r#"<script src="__assets__/office-viewer.js">"#));
        assert!(!html.contains("a</script>"));
        assert_eq!(
            serde_json::from_str::<Inbound>(r#"{"type":"openUrl","url":"https://x"}"#).unwrap(),
            Inbound::OpenUrl {
                url: "https://x".into()
            }
        );
        assert!(serde_json::from_str::<Inbound>(r#"{"type":"navigate"}"#).is_err());
        assert!(convertible("rtf") && convertible("doc") && !convertible("docx"));
    }
}
