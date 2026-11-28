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
//! (`convertOfficeDocumentToDocx`), at most two at once in a window, and owns
//! what leaves the page: opening the file in its default application, opening
//! links, and Retry.
use super::{
    html_visual::script_json,
    web::{WebFallbackAction, WebFrame, parse_find_result},
};
use crate::{
    editor::{
        registry::{
            PaneEntries, SurfaceEvent, SurfaceEvents, SurfaceInput, SurfaceRequest, ViewerSurface,
            viewer_budget,
        },
        workbench::find::FindEvent,
    },
    platform::{
        office::Conversions,
        webview::{Content, Entry, Ipc, ResourceSource, Source, local_url_for, url_for},
    },
    workspace::{PreviewData, PreviewResource},
};
use gpui::{prelude::*, *};
use serde::Deserialize;
use std::{
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

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

/// The app's running conversions, by window.
#[derive(Default)]
struct OfficeConversions(Conversions);
impl Global for OfficeConversions {}

pub fn open(request: &SurfaceRequest, window: &mut Window, cx: &mut App) -> Box<dyn ViewerSurface> {
    let resource = match request.input {
        SurfaceInput::Resource(resource) => Some(resource.clone()),
        _ => None,
    };
    let (name, dark) = (request.name.to_owned(), request.dark);
    let extension = request
        .resolved_extension
        .map(str::to_lowercase)
        .unwrap_or_else(|| extension_of(&name));
    let window = window.window_handle().window_id().as_u64();
    let conversions = cx.default_global::<OfficeConversions>().0.clone();
    let view = cx.new(|cx| {
        let mut view = OfficeView {
            name,
            extension,
            dark,
            window,
            conversions,
            resource,
            frame: None,
            boot: serde_json::Value::Null,
            root: None,
            _served: None,
            _inbox: None,
            pending: None,
            load_epoch: 0,
            _loading: None,
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
    fn subscribe(&self, events: SurfaceEvents, cx: &mut App) -> Option<Subscription> {
        Some(
            cx.subscribe(&self.view, move |_, event: &SurfaceEvent, cx| {
                events(event.clone(), cx)
            }),
        )
    }
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
    fn pane(&self, _: &App) -> PaneEntries {
        PaneEntries {
            find: true,
            ..Default::default()
        }
    }
    fn find(&self, event: FindEvent, _: &mut Window, cx: &mut App) -> Option<(usize, usize)> {
        let frame = self.view.read(cx).frame.clone()?;
        frame.read(cx).find(event, cx)
    }
}
impl EventEmitter<SurfaceEvent> for OfficeView {}

struct OfficeView {
    name: String,
    extension: String,
    dark: bool,
    /// The window it shows in, whose conversions it counts against.
    window: u64,
    conversions: Conversions,
    resource: Option<PreviewResource>,
    frame: Option<Entity<WebFrame>>,
    /// What the current page was given: its boot fields and folder.
    boot: serde_json::Value,
    root: Option<PathBuf>,
    /// A private folder for Cloud bytes or a converted document.
    _served: Option<tempfile::TempDir>,
    _inbox: Option<Task<()>>,
    pending: Option<Pending>,
    load_epoch: u64,
    _loading: Option<Task<()>>,
}
struct Pending(Arc<AtomicBool>);
impl Drop for Pending {
    fn drop(&mut self) {
        self.0.store(true, Ordering::Release);
    }
}
struct OfficeInput {
    name: String,
    extension: String,
    resource: Option<PreviewResource>,
    window: u64,
    conversions: Conversions,
}

/// What the page is given: the folder it may read and its boot fields.
#[derive(Debug, Default)]
struct Served {
    root: Option<PathBuf>,
    file_url: Option<String>,
    file_error: Option<String>,
    converted_url: Option<String>,
    conversion_error: Option<String>,
    warnings: Vec<String>,
    temporary: Option<tempfile::TempDir>,
}

impl OfficeInput {
    /// Only a bounded provider snapshot enters the private serving directory.
    fn source(&self, cancel: &AtomicBool) -> Result<(tempfile::TempDir, String), String> {
        if cancel.load(Ordering::Acquire) {
            return Err("Office preparation was cancelled.".into());
        }
        let resource = self
            .resource
            .as_ref()
            .ok_or("The Office document is unavailable.")?;
        resource.data().map_err(|e| e.to_string())?;
        let bytes = resource
            .bytes(viewer_budget("office-preview"))
            .ok_or("The Office document is unavailable or exceeds its preview budget.")?;
        if cancel.load(Ordering::Acquire) {
            return Err("Office preparation was cancelled.".into());
        }
        let file = Path::new(&self.name)
            .file_name()
            .and_then(|f| f.to_str())
            .ok_or("The Office document has no file name.")?
            .to_owned();
        let (dir, _) =
            crate::platform::webview::private_copy(&file, &bytes).map_err(|e| e.to_string())?;
        resource.data().map_err(|e| e.to_string())?;
        if cancel.load(Ordering::Acquire) {
            return Err("Office preparation was cancelled.".into());
        }
        Ok((dir, file))
    }
    fn serve(&self, cancel: &AtomicBool) -> Served {
        let empty = |error: Option<String>| Served {
            root: None,
            file_url: None,
            file_error: error,
            converted_url: None,
            conversion_error: None,
            warnings: vec![],
            temporary: None,
        };
        let (temporary, file) = match self.source(cancel) {
            Ok(source) => source,
            Err(error) => return empty(Some(error)),
        };
        let folder = temporary.path().to_path_buf();
        if !convertible(&self.extension) {
            return Served {
                root: Some(folder),
                file_url: Some(local_url_for(&file)),
                temporary: Some(temporary),
                ..empty(None)
            };
        }
        // `convertOfficeDocumentToDocx`: the page reads only the result.
        let converted = self
            .conversions
            .convert(self.window, &folder.join(&file), cancel)
            .and_then(|converted| {
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
        if cancel.load(Ordering::Acquire)
            || self.resource.as_ref().is_none_or(|r| r.data().is_err())
        {
            return empty(Some("The Office document is no longer available.".into()));
        }
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
}
struct OfficeLease(PreviewResource);
impl ResourceSource for OfficeLease {
    fn read(&self, _: &Path) -> Option<Vec<u8>> {
        None
    }
    fn is_live(&self) -> bool {
        self.0.data().is_ok()
    }
}
impl OfficeView {
    fn resource_is_live(&self) -> bool {
        self.resource.as_ref().is_none_or(|r| r.data().is_ok())
    }
    fn retire(&mut self) {
        self.load_epoch += 1;
        self.pending = None;
        self._loading = None;
        self._inbox = None;
        self.frame = None;
        self.root = None;
        self._served = None;
        self.boot = serde_json::Value::Null;
    }
    /// Prepare bytes away from the UI thread; every revision owns its own
    /// cancellation token and only its matching completion can publish a page.
    fn load(&mut self, cx: &mut Context<Self>) {
        let input = OfficeInput {
            name: self.name.clone(),
            extension: self.extension.clone(),
            resource: self.resource.clone(),
            window: self.window,
            conversions: self.conversions.clone(),
        };
        self.start_load(cx, move |cancel| async move { input.serve(&cancel) });
    }
    fn start_load<F, Fut>(&mut self, cx: &mut Context<Self>, prepare: F)
    where
        F: FnOnce(Arc<AtomicBool>) -> Fut,
        Fut: std::future::Future<Output = Served> + Send + 'static,
    {
        self.retire();
        let epoch = self.load_epoch;
        let cancel = Arc::new(AtomicBool::new(false));
        self.pending = Some(Pending(cancel.clone()));
        let task = cx.background_spawn(prepare(cancel));
        self._loading = Some(cx.spawn(async move |this, cx| {
            let served = task.await;
            let _ = this.update(cx, |view, cx| {
                if view.load_epoch == epoch {
                    view.pending = None;
                    view.finish_load(served, cx);
                }
            });
        }));
        cx.notify();
    }
    fn finish_load(&mut self, served: Served, cx: &mut Context<Self>) {
        if !self.resource_is_live() {
            self.retire();
            cx.notify();
            return;
        }
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
    fn content(&self, ipc: Option<Ipc>) -> Content {
        Content {
            root: self.root.clone(),
            source: self
                .resource
                .clone()
                .map(|r| Source(Arc::new(OfficeLease(r)))),
            entry: Entry::Html(page(&self.boot, self.dark)),
            max_bytes: viewer_budget("office-preview"),
            assets: vec![
                ("office-viewer.js", SCRIPT),
                ("office-viewer.css", STYLE),
                ("office-validation.worker.js", VALIDATION),
                ("office-spreadsheet.worker.js", SPREADSHEET),
                ("office-text.worker.js", TEXT),
            ],
            ipc,
            policy: None,
            frames: None,
            disk_assets: None,
            locked: false,
        }
    }
    /// A new engine over the current boot fields in the current appearance.
    fn show(&mut self, cx: &mut Context<Self>) {
        if !self.resource_is_live() {
            self.retire();
            cx.notify();
            return;
        }
        let (tx, rx) = async_channel::unbounded::<String>();
        let content = self.content(Some(Ipc(tx)));
        self.load_epoch += 1;
        let epoch = self.load_epoch;
        let local_path = self.local_path();
        self.frame = Some(cx.new(|_| {
            let mut frame = WebFrame::new(Some(content), self.dark);
            if let Some(path) = local_path {
                frame.set_fallback_actions(vec![WebFallbackAction::open_local_file(path)]);
            }
            frame
        }));
        self._inbox = Some(cx.spawn(async move |this, cx| {
            while let Ok(body) = rx.recv().await {
                if let Some(found) = parse_find_result(&body) {
                    let _ = this.update(cx, |_, cx| {
                        cx.emit(SurfaceEvent::FindResult {
                            current: found.0,
                            total: found.1,
                        })
                    });
                    continue;
                }
                let Ok(message) = serde_json::from_str::<Inbound>(&body) else {
                    continue;
                };
                let _ = this.update(cx, |view, cx| view.receive_for(epoch, message, cx));
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
        if self.pending.is_some() {
            cx.notify();
            return;
        }
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
    fn receive_for(&mut self, epoch: u64, message: Inbound, cx: &mut Context<Self>) {
        if epoch != self.load_epoch {
            return;
        }
        if !self.resource_is_live() && message != Inbound::Retry {
            return;
        }
        match message {
            Inbound::OpenExternal => {
                if let Some(path) = self.local_path() {
                    crate::editor::question::open_external(None, path, |_, _| {}, cx);
                }
            }
            Inbound::OpenUrl { url } => {
                if url.starts_with("https://") || url.starts_with("http://") {
                    let _ = crate::platform::desktop::open_url(&url);
                }
            }
            Inbound::Retry => cx.emit(SurfaceEvent::RetryInput),
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
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if !self.resource_is_live() {
            self.retire();
            use crate::ui::appearance::ActiveAppearance;
            let view = cx.weak_entity();
            return super::image::resource_failure(
                "office-retry",
                crate::localization::t("editor.office.resourceUnavailable").into(),
                cx.palette(),
                move |_, cx| {
                    let _ = view.update(cx, |_, cx| cx.emit(SurfaceEvent::RetryInput));
                },
            );
        }
        div()
            .id("office-preview")
            .size_full()
            .when(self.pending.is_some(), |d| {
                d.role(Role::Status)
                    .aria_label(crate::localization::t("editor.preview.loading"))
                    .flex()
                    .items_center()
                    .justify_center()
                    .gap(px(8.))
                    .child(crate::ui::loading::LoadingMark::new("office-converting").silent())
                    .child(crate::localization::t("editor.preview.loading"))
            })
            .children(self.frame.clone())
            .into_any_element()
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

#[cfg(test)]
mod lifetime_tests {
    use super::*;
    use core::prelude::v1::test;

    fn view(cx: &mut TestAppContext) -> Entity<OfficeView> {
        cx.new(|_| OfficeView {
            name: "document.rtf".into(),
            extension: "rtf".into(),
            dark: false,
            window: 1,
            conversions: Conversions::default(),
            resource: None,
            frame: None,
            boot: serde_json::Value::Null,
            root: None,
            _served: None,
            _inbox: None,
            pending: None,
            load_epoch: 0,
            _loading: None,
        })
    }
    fn answer(url: &str) -> Served {
        Served {
            converted_url: Some(url.into()),
            ..Default::default()
        }
    }
    #[gpui::test]
    fn preparing_a_conversion_keeps_the_ui_available_and_uses_the_latest_appearance(
        cx: &mut TestAppContext,
    ) {
        let view = view(cx);
        let (send, receive) = async_channel::bounded(1);
        view.update(cx, |v, cx| {
            v.start_load(cx, |_| async move { receive.recv().await.unwrap() })
        });
        cx.run_until_parked();
        view.update(cx, |v, cx| {
            assert!(v.pending.is_some() && v.frame.is_none());
            v.set_dark(true, cx);
            assert!(v.frame.is_none());
        });
        send.try_send(answer("new.docx")).unwrap();
        cx.run_until_parked();
        view.read_with(cx, |v, _| {
            assert!(v.pending.is_none() && v.frame.is_some());
            assert!(v.dark);
            assert_eq!(v.boot["convertedUrl"], "new.docx");
        });
    }
    #[gpui::test]
    fn replacing_an_input_cancels_its_conversion_and_discards_an_already_queued_reply(
        cx: &mut TestAppContext,
    ) {
        let view = view(cx);
        let (old_send, old_receive) = async_channel::bounded(1);
        view.update(cx, |v, cx| {
            v.start_load(cx, |_| async move { old_receive.recv().await.unwrap() })
        });
        cx.run_until_parked();
        let old_cancel = view.read_with(cx, |v, _| v.pending.as_ref().unwrap().0.clone());
        let old_temporary = tempfile::tempdir().unwrap();
        let old_path = old_temporary.path().to_path_buf();
        old_send
            .try_send(Served {
                root: Some(old_path.clone()),
                temporary: Some(old_temporary),
                ..answer("stale.docx")
            })
            .unwrap();
        // The producer has finished. Only the cancelled receiving task owns
        // this queued result; the fixture must not retain a channel endpoint.
        drop(old_send);
        let (send, receive) = async_channel::bounded(1);
        view.update(cx, |v, cx| {
            v.start_load(cx, |_| async move { receive.recv().await.unwrap() })
        });
        assert!(old_cancel.load(Ordering::Acquire));
        cx.run_until_parked();
        view.read_with(cx, |v, _| assert!(v.pending.is_some() && v.boot.is_null()));
        assert!(
            !old_path.exists(),
            "discarded conversion retained its files"
        );
        send.try_send(answer("current.docx")).unwrap();
        cx.run_until_parked();
        view.read_with(cx, |v, _| {
            assert_eq!(v.boot["convertedUrl"], "current.docx")
        });
    }
    #[gpui::test]
    fn disposing_the_view_cancels_the_same_token_observed_by_its_worker(cx: &mut TestAppContext) {
        let view = view(cx);
        let (send, receive) = async_channel::bounded(1);
        let (tokens, token_receiver) = async_channel::bounded(1);
        view.update(cx, |v, cx| {
            v.start_load(cx, move |cancel| async move {
                tokens.send(cancel).await.unwrap();
                receive.recv().await.unwrap()
            })
        });
        cx.run_until_parked();
        let cancel = token_receiver.try_recv().unwrap();
        assert!(!cancel.load(Ordering::Acquire));
        let weak = view.downgrade();
        drop(view);
        // GPUI releases zero-reference entities at the end of an App update,
        // as the real window-close/rebind transaction does.
        cx.update(|_| {});
        cx.run_until_parked();
        assert!(weak.upgrade().is_none());
        assert!(cancel.load(Ordering::Acquire));
        assert!(send.try_send(answer("abandoned.docx")).is_err());
    }
    #[cfg(target_os = "macos")]
    #[gpui::test]
    fn real_rtf_conversion_loads_a_private_docx_and_releases_it_with_the_view(
        cx: &mut TestAppContext,
    ) {
        let dir = tempfile::tempdir().unwrap();
        let original = r"{\rtf1\ansi Native conversion}";
        std::fs::write(dir.path().join("document.rtf"), original).unwrap();
        let ws = crate::workspace::Workspace::open(dir.path()).unwrap();
        let resource = ws.resource(Path::new("document.rtf")).unwrap();
        let view = view(cx);
        let surface = OfficeSurface { view: view.clone() };
        cx.update(|cx| surface.rebind_resource(&resource, cx));
        drop(surface);
        view.read_with(cx, |v, _| assert!(v.pending.is_some() && v.frame.is_none()));
        cx.run_until_parked();
        let private = view.read_with(cx, |v, _| {
            assert!(v.pending.is_none(), "conversion has not settled");
            assert!(v.boot["conversionError"].is_null(), "{}", v.boot);
            assert!(v.boot["convertedUrl"].as_str().unwrap().contains(CONVERTED));
            let private = v.root.clone().unwrap();
            assert!(
                std::fs::read(private.join(CONVERTED))
                    .unwrap()
                    .starts_with(b"PK\x03\x04")
            );
            private
        });
        assert_eq!(
            std::fs::read_to_string(dir.path().join("document.rtf")).unwrap(),
            original
        );
        drop(view);
        // GPUI releases zero-reference entities at the end of an App update,
        // as the real window-close/rebind transaction does.
        cx.update(|_| {});
        cx.run_until_parked();
        assert!(!private.exists());
    }
}

#[cfg(test)]
mod admission_tests;
