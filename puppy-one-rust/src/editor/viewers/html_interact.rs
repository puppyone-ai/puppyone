//! Interact (`HtmlPreviewFrame` with `useHtmlFolderAccessDecision`,
//! `useHtmlFolderAccessBridge` and `useHtmlLinkNavigation`): the page
//! running in the system web engine.
//!
//! A page that names the folder picker asks once, before it runs, whether
//! it may use its folder ([`html_page`]): the page stays unloaded while the
//! question is open. Allowed (for this exact page text, remembered across
//! runs), it runs offline and locked to itself, with the folder bridge and a
//! `localStorage` kept here; declined (until PuppyOne restarts), it runs as
//! any other page. The pane menu's toggle changes the answer. A link the
//! person clicks opens its workspace document in the workbench or its
//! address in the browser; the page itself never follows it.
use super::{
    html_page::{self, Folder},
    html_preview,
    html_tools::{HtmlJsError, HtmlToolAction, HtmlToolEvent, HtmlToolMode, HtmlToolSnapshot},
    web::WebFrame,
};
use crate::{
    editor::{
        navigation::{self, Reference, ReferenceContext, Status},
        registry::{SurfaceEvent, SurfaceEvents, SurfaceRequest, ViewerSurface, viewer_budget},
    },
    localization::{t, tf},
    platform::{
        html_page_store,
        webview::{Budgeted, Content, Entry, Ipc, SCHEME, Source},
    },
    theme,
    ui::appearance::ActiveAppearance,
    workspace::{ErrorKind, Workspace},
};
use gpui::{prelude::*, *};
use std::{
    cell::{Cell, RefCell},
    collections::HashSet,
    path::{Path, PathBuf},
    rc::Rc,
    sync::{Arc, LazyLock, Mutex},
};

const INTERACTION_CSS: &str = include_str!("../../../assets/web/html-preview-interaction.css");
/// `projectCloudHtml`: a hosted document's assets come through its
/// provider, at most 64 references and 4 MiB per projection.
const MAX_REFERENCES: usize = 64;

/// Where allowances and page storage are kept; tests keep theirs apart.
fn store() -> PathBuf {
    #[cfg(test)]
    return std::env::temp_dir().join(format!("po-html-pages-{}", std::process::id()));
    #[cfg(not(test))]
    html_page_store::native()
}

/// `declinedHtmlPages`: declining lasts until PuppyOne restarts.
static DECLINED: LazyLock<Mutex<HashSet<(PathBuf, String)>>> = LazyLock::new(Default::default);

/// `FolderAccessState`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) enum Access {
    /// The page does not ask (or cannot: it is not in a folder here).
    #[default]
    None,
    Checking,
    /// The person is being asked; `changed`: an allowed page changed.
    Ask {
        changed: bool,
    },
    Allowed,
    Declined,
}

/// The preview document (`buildHtmlPreviewDocument`): `csp` and a `<base>`
/// for the document's folder, then the interaction stylesheet and `scripts`
/// lead its head.
pub fn preview_html(text: &str, csp: &str, scripts: &str) -> String {
    let extra = format!(
        "<style id=\"puppyone-html-preview-interaction\">{INTERACTION_CSS}</style>{scripts}"
    );
    let base = format!("{SCHEME}://local/");
    html_preview::interactive_document(text, &base, csp, &extra)
}

type EditCallback = Rc<dyn Fn(&mut App)>;
/// The host's external route (`openExternalUrl`): opens a web address in
/// the system browser, or says why it could not.
pub type ExternalRoute = Arc<dyn Fn(&str) -> Result<(), String> + Send + Sync>;

/// The product's external route: the system browser, failing when it
/// cannot be asked. Tests leave web addresses to the app, which records them.
fn external_route() -> Option<ExternalRoute> {
    #[cfg(test)]
    return None;
    #[cfg(not(test))]
    Some(Arc::new(crate::platform::desktop::open_url))
}
type FullpageSlices = (u64, Vec<(f32, Vec<u8>)>);

#[derive(Default)]
struct State {
    access: Access,
    /// The page text the decision is for.
    digest: String,
    asking: bool,
    references: Option<ReferenceContext>,
    events: Option<SurfaceEvents>,
    on_edit: Option<EditCallback>,
    /// The shown page's messages.
    inbox: Option<Task<()>>,
    /// Which shown page this is: a link's late answer for an earlier page
    /// is dropped.
    generation: u64,
    external: Option<ExternalRoute>,
    /// The shown page's message channel (tests post into it).
    #[cfg(test)]
    channel: Option<async_channel::Sender<String>>,
    tool_mode: HtmlToolMode,
    js_errors: Vec<HtmlJsError>,
    has_annotations: bool,
    fullpage_slices: Option<FullpageSlices>,
}

/// Interact's page and its decisions, shared by the surface and the Edit
/// fallback. The page's own message loop holds it weakly, so closing the
/// document drops the page.
#[derive(Clone)]
pub(super) struct Interact(Rc<Inner>);
pub(super) struct Inner {
    source: Rc<dyn ViewerSurface>,
    pub frame: Entity<WebFrame>,
    waiting: Entity<Waiting>,
    blank: Entity<Waiting>,
    pub is_empty: Rc<Cell<bool>>,
    folder: Option<PathBuf>,
    assets: Option<Source>,
    /// The local workspace the page's folder is read through; a lone file
    /// or a hosted document has none, and never asks.
    workspace: Option<Arc<Workspace>>,
    name: Rc<RefCell<String>>,
    file_mode: bool,
    /// The window's theme, which the page's tool chrome follows.
    dark: Cell<bool>,
    scroll_ratio: Rc<Cell<f32>>,
    window: AnyWindowHandle,
    pub notice: Rc<RefCell<Option<SharedString>>>,
    state: RefCell<State>,
}
impl std::ops::Deref for Interact {
    type Target = Inner;
    fn deref(&self) -> &Inner {
        &self.0
    }
}
impl Interact {
    /// Interact for the document `request` opens, over its `source` editor.
    pub fn new(
        request: &SurfaceRequest,
        source: Rc<dyn ViewerSurface>,
        scroll_ratio: Rc<Cell<f32>>,
        window: &Window,
        cx: &mut App,
    ) -> Self {
        let (folder, assets) = (request.folder.clone(), request.web_source.clone());
        let workspace = request.workspace.clone();
        let (name, dark) = (request.name.to_owned(), request.dark);
        let state = State {
            references: request.references.clone(),
            external: external_route(),
            ..State::default()
        };
        Self(Rc::new(Inner {
            source,
            frame: cx.new(|_| WebFrame::new(None, dark)),
            waiting: cx.new(|_| Waiting(Some("editor.html.loading"))),
            blank: cx.new(|_| Waiting(None)),
            is_empty: Rc::new(Cell::new(false)),
            folder,
            assets,
            workspace: workspace.filter(|w| w.local_root().is_some()),
            name: Rc::new(RefCell::new(name)),
            file_mode: request.file_mode,
            dark: Cell::new(dark),
            scroll_ratio,
            window: window.window_handle(),
            notice: Rc::default(),
            state: RefCell::new(state),
        }))
    }
    pub fn folder(&self) -> Option<PathBuf> {
        self.folder.clone()
    }
    pub fn assets(&self) -> Option<Source> {
        self.assets.clone()
    }
    pub fn access(&self) -> Access {
        self.state.borrow().access
    }
    /// Updates the bound workspace path and immediately refreshes non-empty
    /// documents so `link_script` `sourceUrl` and folder-access keys match the
    /// renamed file (`TODO-94`).
    pub fn rename(&self, name: &str, cx: &mut App) {
        if self.name.borrow().as_str() == name {
            return;
        }
        *self.name.borrow_mut() = name.to_owned();
        {
            let mut st = self.state.borrow_mut();
            st.digest.clear();
            st.access = Access::None;
            st.asking = false;
        }
        let text = self.source.text(cx).unwrap_or_default();
        if !super::html::is_empty_page(&text) {
            self.refresh(cx);
        } else {
            self.is_empty.set(true);
        }
    }
    pub fn query_scroll(&self, cx: &App) {
        self.frame
            .read(cx)
            .evaluate("window.__puppyoneReportScroll&&window.__puppyoneReportScroll()");
    }
    #[cfg(test)]
    pub fn bound_name(&self) -> String {
        self.name.borrow().clone()
    }
    #[cfg(test)]
    pub fn current_entry_html(&self, cx: &App) -> Option<String> {
        self.frame.read(cx).entry_html().map(str::to_owned)
    }
    /// The window's theme changed: the next tool the page shows follows it.
    pub fn set_dark(&self, dark: bool) {
        self.dark.set(dark);
    }
    pub fn set_references(&self, references: Option<ReferenceContext>) {
        self.state.borrow_mut().references = references;
    }
    pub fn set_events(&self, events: SurfaceEvents) {
        self.state.borrow_mut().events = Some(events);
    }
    /// The route web addresses open through.
    #[cfg(test)]
    pub fn set_external_route(&self, route: Option<ExternalRoute>) {
        self.state.borrow_mut().external = route;
    }
    /// The shown page's message channel, as its web view posts into it.
    #[cfg(test)]
    pub fn channel(&self) -> Option<async_channel::Sender<String>> {
        self.state.borrow().channel.clone()
    }
    pub fn set_on_edit(&self, on_edit: Rc<dyn Fn(&mut App)>) {
        self.state.borrow_mut().on_edit = Some(on_edit);
    }
    pub fn set_fallback_actions(&self, actions: Vec<super::web::WebFallbackAction>, cx: &mut App) {
        self.frame
            .update(cx, |frame, _| frame.set_fallback_actions(actions));
    }
    /// Local document path when this HTML viewer is backed by a local folder
    /// (never returns a path for Cloud documents).
    pub fn local_file_path(&self) -> Option<PathBuf> {
        if self.assets.is_some() {
            return None;
        }
        let folder = self.folder.as_ref()?;
        let name = self.name.borrow();
        let file_name = Path::new(name.as_str()).file_name()?;
        let candidate = folder.join(file_name);
        candidate.is_file().then_some(candidate)
    }
    /// The surface is closing: the edit callback holds its parts (this page
    /// among them), so it goes first.
    pub fn retire(&self) {
        self.state.borrow_mut().on_edit = None;
    }
    /// What Interact shows now.
    pub fn element(&self) -> AnyElement {
        match self.access() {
            Access::Checking => self.waiting.clone().into_any_element(),
            // The question is open: the page stays unloaded until it answers.
            Access::Ask { .. } => self.blank.clone().into_any_element(),
            _ => self.frame.clone().into_any_element(),
        }
    }
    /// The page file itself, when it is in a folder of a local workspace.
    fn page(&self) -> Option<PathBuf> {
        self.workspace.as_ref()?;
        let name = self.name.borrow();
        let file = Path::new(name.as_str()).file_name()?;
        Some(self.folder.as_ref()?.join(file))
    }
    /// The page's folder, as the bridge reaches it.
    fn bridge(&self) -> Option<Arc<Mutex<Folder>>> {
        let workspace = self.workspace.clone()?;
        let name = self.name.borrow();
        let dir = Path::new(name.as_str()).parent()?.to_path_buf();
        Some(Arc::new(Mutex::new(Folder::new(workspace, dir))))
    }

    /// The page as the document reads now: asked about, allowed or not.
    pub fn refresh(&self, cx: &mut App) {
        let text = self.source.text(cx).unwrap_or_default();
        self.is_empty.set(super::html::is_empty_page(&text));
        let page = self
            .page()
            .filter(|_| html_page::requests_folder_access(&text));
        let Some(page) = page else {
            self.state.borrow_mut().access = Access::None;
            return self.show(&text, None, cx);
        };
        let digest = html_page::digest(&text);
        let settled = {
            let state = self.state.borrow();
            (state.digest == digest).then_some(state.access)
        };
        match settled {
            Some(Access::Allowed) => return self.show_offline(text, page, cx),
            Some(Access::Declined) => return self.show(&text, None, cx),
            Some(Access::Ask { .. }) => return,
            _ => {}
        }
        {
            let mut state = self.state.borrow_mut();
            state.digest = digest.clone();
            state.access = Access::Checking;
        }
        let store = store();
        let path = page.clone();
        let granted = cx
            .background_executor()
            .spawn(async move { html_page_store::grant(&store, &path) });
        let this = self.clone();
        cx.spawn(async move |cx| {
            let granted = granted.await;
            cx.update(|cx| this.decided(text, page, digest, granted, cx));
        })
        .detach();
        self.redraw(cx);
    }
    fn decided(
        &self,
        text: String,
        page: PathBuf,
        digest: String,
        granted: Option<String>,
        cx: &mut App,
    ) {
        if self.state.borrow().digest != digest {
            return;
        }
        let declined = DECLINED
            .lock()
            .is_ok_and(|d| d.contains(&(page.clone(), digest.clone())));
        let access = match granted {
            Some(granted) if granted == digest => Access::Allowed,
            _ if declined => Access::Declined,
            Some(_) => Access::Ask { changed: true },
            None => Access::Ask { changed: false },
        };
        self.state.borrow_mut().access = access;
        match access {
            Access::Allowed => self.show_offline(text, page, cx),
            Access::Ask { changed } => self.ask(page, changed, cx),
            _ => self.show(&text, None, cx),
        }
        self.redraw(cx);
    }
    /// `HtmlFolderAccessDialog`: "Don't allow" is the default answer.
    fn ask(&self, page: PathBuf, changed: bool, cx: &mut App) {
        if std::mem::replace(&mut self.state.borrow_mut().asking, true) {
            return;
        }
        let folder = page
            .parent()
            .and_then(Path::file_name)
            .map(|f| f.to_string_lossy().into_owned())
            .unwrap_or_default();
        let name = page
            .file_name()
            .map(|f| f.to_string_lossy().into_owned())
            .unwrap_or_default();
        let title = t(if changed {
            "editor.html.folderAccessChangedTitle"
        } else {
            "editor.html.folderAccessTitle"
        });
        let detail = tf(
            "editor.html.folderAccessDescription",
            &[("page", name.into()), ("folder", folder.into())],
        );
        let this = self.clone();
        crate::editor::question::ask(
            crate::editor::question::Question {
                window: self.window,
                title: title.to_owned(),
                detail,
                decline: t("editor.html.folderAccessDecline").to_owned(),
                accept: t("editor.html.folderAccessAllow").to_owned(),
                answer: Box::new(move |allowed, cx| {
                    this.state.borrow_mut().asking = false;
                    this.set_allowed(allowed, cx);
                }),
            },
            cx,
        );
    }
    /// The answer, from the question or the pane menu's toggle.
    pub fn set_allowed(&self, allowed: bool, cx: &mut App) {
        let Some(page) = self.page() else {
            return;
        };
        let digest = self.state.borrow().digest.clone();
        if let Ok(mut declined) = DECLINED.lock() {
            let key = (page.clone(), digest.clone());
            if allowed {
                declined.remove(&key);
            } else {
                declined.insert(key);
            }
        }
        let (store, path, granted) = (store(), page.clone(), digest);
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_millis() as u64);
        cx.background_executor()
            .spawn(async move {
                html_page_store::set_grant(&store, &path, allowed.then_some(granted.as_str()), now)
            })
            .detach();
        self.state.borrow_mut().access = if allowed {
            Access::Allowed
        } else {
            Access::Declined
        };
        let text = self.source.text(cx).unwrap_or_default();
        if allowed {
            self.show_offline(text, page, cx);
        } else {
            self.show(&text, None, cx);
        }
        self.redraw(cx);
    }

    /// An allowed page, with the `localStorage` it kept.
    fn show_offline(&self, text: String, page: PathBuf, cx: &mut App) {
        let store = store();
        let path = page.clone();
        let kept = cx
            .background_executor()
            .spawn(async move { html_page_store::page_storage(&store, &path) });
        let this = self.clone();
        cx.spawn(async move |cx| {
            let storage = kept.await;
            cx.update(|cx| {
                if this.access() == Access::Allowed {
                    this.show(&text, Some(storage), cx);
                }
            });
        })
        .detach();
    }
    /// A new engine on `text`; `storage` (the page's kept entries) makes it
    /// the offline page with its folder.
    fn show(
        &self,
        text: &str,
        storage: Option<serde_json::Map<String, serde_json::Value>>,
        cx: &mut App,
    ) {
        let offline = storage.is_some() && self.folder.is_some();
        let page_url = self
            .page()
            .and_then(|p| p.file_name().map(|f| f.to_string_lossy().into_owned()))
            .map(|name| {
                format!(
                    "{SCHEME}://local/{}",
                    crate::platform::webview::url_for(&name)
                )
            });
        let mut scripts = String::new();
        if let (true, Some(storage), Some(folder)) = (offline, &storage, &self.folder) {
            let name = folder
                .file_name()
                .map(|f| f.to_string_lossy().into_owned())
                .unwrap_or_default();
            scripts.push_str(&html_page::folder_script(&name, storage));
        }
        scripts.push_str(&html_page::link_script(page_url.as_deref()));
        scripts.push_str(&preview_scroll_script(self.scroll_ratio.get()));
        if self.file_mode {
            let mut st = self.state.borrow_mut();
            st.tool_mode = HtmlToolMode::None;
            st.js_errors.clear();
            st.has_annotations = false;
            st.fullpage_slices = None;
            drop(st);
            scripts.push_str(&super::html_tools::injected_head_bundle());
        }
        let budget = viewer_budget("html-artifact");
        let (tx, rx) = async_channel::unbounded::<String>();
        {
            let mut st = self.state.borrow_mut();
            st.generation += 1;
            #[cfg(test)]
            {
                st.channel = Some(tx.clone());
            }
        }
        let source = self
            .assets
            .clone()
            .filter(|_| self.folder.is_none())
            .map(|source| Source(Arc::new(Budgeted::new(source, MAX_REFERENCES, budget))));
        let content = preview_content(
            text,
            &scripts,
            offline,
            source,
            self.folder.clone(),
            Ipc(tx),
        );
        self.frame
            .update(cx, |f, cx| f.set_content(Some(content), cx));
        let folder = self.bridge().filter(|_| offline);
        let base = html_preview::base_href(text);
        let this = Rc::downgrade(&self.0);
        let inbox = cx.spawn(async move |cx| {
            while let Ok(body) = rx.recv().await {
                let Some(this) = this.upgrade().map(Interact) else {
                    break;
                };
                let Ok(message) = serde_json::from_str::<serde_json::Value>(&body) else {
                    continue;
                };
                let (base, folder) = (base.clone(), folder.clone());
                cx.update(|cx| this.receive(message, base, folder, cx));
            }
        });
        self.state.borrow_mut().inbox = Some(inbox);
        if self.file_mode {
            self.emit_tool(HtmlToolEvent::StateChanged, cx);
        }
        self.redraw(cx);
    }
    pub fn tool_snapshot(&self, visual_edit: bool, source_open: bool) -> HtmlToolSnapshot {
        let st = self.state.borrow();
        HtmlToolSnapshot {
            mode: st.tool_mode,
            js_errors: st.js_errors.clone(),
            has_annotations: st.has_annotations,
            visual_edit,
            source_open,
        }
    }
    pub fn set_tool_mode(&self, mode: HtmlToolMode, cx: &mut App) {
        if !self.file_mode {
            return;
        }
        {
            let mut st = self.state.borrow_mut();
            if st.tool_mode == mode {
                return;
            }
            st.tool_mode = mode;
        }
        let script = format!(
            "window.__puppyoneHtmlTools&&window.__puppyoneHtmlTools.setMode('{}',{})",
            mode.as_js_name(),
            self.dark.get()
        );
        self.frame.read(cx).evaluate(&script);
        self.emit_tool(HtmlToolEvent::StateChanged, cx);
    }
    pub fn trigger_tool_action(&self, action: HtmlToolAction, cx: &mut App) {
        if !self.file_mode {
            return;
        }
        match action {
            HtmlToolAction::ReloadAndReset => {
                {
                    let mut st = self.state.borrow_mut();
                    st.tool_mode = HtmlToolMode::None;
                    st.js_errors.clear();
                    st.has_annotations = false;
                    st.fullpage_slices = None;
                }
                self.refresh(cx);
                self.emit_tool(HtmlToolEvent::StateChanged, cx);
            }
            HtmlToolAction::ClearAnnotations => {
                self.state.borrow_mut().has_annotations = false;
                self.frame.read(cx).evaluate(
                    "window.__puppyoneHtmlTools&&window.__puppyoneHtmlTools.clearAnnotations()",
                );
                self.emit_tool(HtmlToolEvent::StateChanged, cx);
            }
            HtmlToolAction::ClearErrors => {
                self.state.borrow_mut().js_errors.clear();
                self.emit_tool(HtmlToolEvent::StateChanged, cx);
            }
            HtmlToolAction::CaptureFullPage => {
                self.state.borrow_mut().tool_mode = HtmlToolMode::None;
                self.emit_tool(HtmlToolEvent::StateChanged, cx);
                let ran = self.frame.read(cx).evaluate(
                    "window.__puppyoneHtmlTools&&window.__puppyoneHtmlTools.captureFullPage()",
                );
                if !ran {
                    self.capture_single_png(
                        None,
                        None,
                        "copy-screenshot".into(),
                        "full-page".into(),
                        0,
                        cx,
                    );
                }
            }
        }
    }
    pub fn emit_find_result(&self, current: usize, total: usize, cx: &mut App) {
        let events = self.state.borrow().events.clone();
        if let Some(events) = events {
            events(SurfaceEvent::FindResult { current, total }, cx);
        }
    }
    fn emit_tool(&self, event: HtmlToolEvent, cx: &mut App) {
        let events = self.state.borrow().events.clone();
        if let Some(events) = events {
            events(SurfaceEvent::HtmlTool(event), cx);
        }
    }
    fn capture_single_png(
        &self,
        crop: Option<(f32, f32, f32, f32)>,
        viewport: Option<(f32, f32)>,
        purpose: String,
        label: String,
        stroke_count: usize,
        cx: &mut App,
    ) {
        let (tx, rx) = async_channel::bounded::<Option<Vec<u8>>>(1);
        let started = self
            .frame
            .read(cx)
            .capture_png(crop, viewport, move |bytes| {
                let _ = tx.try_send(bytes);
            });
        if !started {
            return;
        }
        let this = self.clone();
        cx.spawn(async move |cx| {
            let bytes = rx.recv().await.ok().flatten();
            cx.update(|cx| {
                this.frame.read(cx).evaluate(
                    "window.__puppyoneHtmlTools&&window.__puppyoneHtmlTools.restoreChrome()",
                );
                let Some(png) = bytes else {
                    return;
                };
                match purpose.as_str() {
                    "send-annotated" => {
                        this.emit_tool(
                            HtmlToolEvent::SendAnnotatedToAgent { png, stroke_count },
                            cx,
                        );
                    }
                    _ => {
                        this.emit_tool(HtmlToolEvent::CopyScreenshot { png, label }, cx);
                    }
                }
            });
        })
        .detach();
    }
    fn receive_tool(&self, message: &serde_json::Value, cx: &mut App) {
        if !self.file_mode {
            return;
        }
        match message["kind"].as_str() {
            Some("js-error") => {
                let text = message["message"].as_str().unwrap_or_default().trim();
                if text.is_empty() {
                    return;
                }
                let line = message["line"].as_u64().map(|n| n as u32);
                let column = message["col"].as_u64().map(|n| n as u32);
                let mut st = self.state.borrow_mut();
                if st.js_errors.len() < 20 {
                    st.js_errors.push(HtmlJsError {
                        message: text.to_owned(),
                        line,
                        column,
                    });
                    drop(st);
                    self.emit_tool(HtmlToolEvent::StateChanged, cx);
                }
            }
            Some("state") => {
                let next_mode = HtmlToolMode::from_js_name(message["mode"].as_str().unwrap_or(""));
                let has_annotations = message["hasAnnotations"].as_bool().unwrap_or(false);
                let changed = {
                    let mut st = self.state.borrow_mut();
                    let diff = st.tool_mode != next_mode || st.has_annotations != has_annotations;
                    st.tool_mode = next_mode;
                    st.has_annotations = has_annotations;
                    diff
                };
                if changed {
                    self.emit_tool(HtmlToolEvent::StateChanged, cx);
                }
            }
            Some("picked") => {
                self.state.borrow_mut().tool_mode = HtmlToolMode::None;
                let selector = message["selector"].as_str().unwrap_or("div").to_owned();
                let tag = message["tag"].as_str().unwrap_or("div").to_owned();
                let id = message["id"].as_str().unwrap_or_default().to_owned();
                let classes: Vec<String> = message["classes"]
                    .as_array()
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|v| v.as_str().map(str::to_owned))
                            .collect()
                    })
                    .unwrap_or_default();
                let index = message["index"].as_u64().unwrap_or(0) as usize;
                let text_preview = message["text"].as_str().unwrap_or_default().to_owned();
                let html_snippet = message["html"].as_str().unwrap_or_default().to_owned();
                let raw_source = self.source.text(cx).unwrap_or_default();
                let lines = super::html_tools::locate_element_lines(
                    &raw_source,
                    &tag,
                    &id,
                    &classes,
                    &text_preview,
                    index,
                );
                self.emit_tool(HtmlToolEvent::StateChanged, cx);
                self.emit_tool(
                    HtmlToolEvent::ElementPicked {
                        selector,
                        tag,
                        lines,
                        text_preview,
                        html_snippet,
                    },
                    cx,
                );
            }
            Some("snapshot") => {
                let purpose = message["purpose"]
                    .as_str()
                    .unwrap_or("copy-screenshot")
                    .to_owned();
                let crop = message["crop"].as_array().and_then(|a| {
                    if a.len() == 4 {
                        Some((
                            a[0].as_f64()? as f32,
                            a[1].as_f64()? as f32,
                            a[2].as_f64()? as f32,
                            a[3].as_f64()? as f32,
                        ))
                    } else {
                        None
                    }
                });
                let viewport = message["viewport"].as_array().and_then(|a| {
                    if a.len() == 2 {
                        Some((a[0].as_f64()? as f32, a[1].as_f64()? as f32))
                    } else {
                        None
                    }
                });
                let label = message["label"].as_str().unwrap_or("PNG").to_owned();
                let stroke_count = message["strokeCount"].as_u64().unwrap_or(0) as usize;
                self.capture_single_png(crop, viewport, purpose, label, stroke_count, cx);
            }
            Some("fullpage-slice") => {
                let Some(id) = message["id"].as_u64() else {
                    return;
                };
                let index = message["index"].as_u64().unwrap_or(0) as usize;
                let count = message["count"].as_u64().unwrap_or(1) as usize;
                let scroll_y = message["scrollY"].as_f64().unwrap_or(0.) as f32;
                let total_h = message["totalHeight"].as_f64().unwrap_or(1.) as f32;
                let vh = message["viewportHeight"].as_f64().unwrap_or(1.) as f32;
                let vw = message["viewportWidth"].as_f64().unwrap_or(1.) as f32;
                let (tx, rx) = async_channel::bounded::<Option<Vec<u8>>>(1);
                let started = self
                    .frame
                    .read(cx)
                    .capture_png(None, Some((vw, vh)), move |bytes| {
                        let _ = tx.try_send(bytes);
                    });
                if !started {
                    return;
                }
                let this = self.clone();
                cx.spawn(async move |cx| {
                    let bytes = rx.recv().await.ok().flatten();
                    cx.update(|cx| {
                        if let Some(png) = bytes {
                            let mut st = this.state.borrow_mut();
                            if st
                                .fullpage_slices
                                .as_ref()
                                .is_none_or(|(jid, _)| *jid != id)
                            {
                                st.fullpage_slices = Some((id, Vec::new()));
                            }
                            if let Some((_, list)) = &mut st.fullpage_slices {
                                list.push((scroll_y, png));
                            }
                        }
                        let next_js = format!(
                            "window.__puppyoneHtmlTools&&window.__puppyoneHtmlTools.nextSlice({id})"
                        );
                        this.frame.read(cx).evaluate(&next_js);
                        if index + 1 >= count {
                            let slices = this
                                .state
                                .borrow_mut()
                                .fullpage_slices
                                .take()
                                .map(|(_, list)| list)
                                .unwrap_or_default();
                            if let Some(stitched) =
                                crate::web_host::stitch_png_slices(&slices, total_h, vh)
                            {
                                this.emit_tool(
                                    HtmlToolEvent::CopyScreenshot {
                                        png: stitched,
                                        label: format!("{}×{}", vw as u32, total_h as u32),
                                    },
                                    cx,
                                );
                            }
                        }
                    });
                })
                .detach();
            }
            _ => {}
        }
    }
    fn receive(
        &self,
        message: serde_json::Value,
        base: Option<String>,
        folder: Option<Arc<Mutex<Folder>>>,
        cx: &mut App,
    ) {
        match message["type"].as_str() {
            Some("poFindResult") => {
                let current = message["current"].as_u64().unwrap_or(0) as usize;
                let total = message["total"].as_u64().unwrap_or(0) as usize;
                self.emit_find_result(current, total, cx);
            }
            Some("edit") => {
                if let Some(on_edit) = self.state.borrow().on_edit.clone() {
                    on_edit(cx);
                }
            }
            Some("link") => {
                if let Some(href) = message["href"].as_str() {
                    self.follow(href, base.as_deref(), folder.is_some(), cx);
                }
            }
            // `useHtmlFolderAccessBridge`: one request at a time, inside
            // the allowed folder only.
            Some("folder") => {
                let (Some(folder), Some(id)) = (folder, message["id"].as_u64()) else {
                    return;
                };
                let task = cx.background_executor().spawn(async move {
                    match folder.lock() {
                        Ok(mut folder) => folder.handle(&message),
                        Err(_) => Err(html_page::Refusal {
                            name: "InvalidStateError",
                            message: "Request failed.".into(),
                        }),
                    }
                });
                let frame = self.frame.clone();
                cx.spawn(async move |cx| {
                    let reply = match task.await {
                        Ok(value) => serde_json::json!({ "id": id, "ok": true, "value": value }),
                        Err(refusal) => serde_json::json!({ "id": id, "ok": false,
                            "name": refusal.name, "message": refusal.message }),
                    };
                    let script = format!(
                        "window.__puppyoneHtmlPage&&window.__puppyoneHtmlPage({})",
                        super::html_visual::script_json(&reply)
                    );
                    cx.update(|cx| frame.read(cx).evaluate(&script));
                })
                .detach();
            }
            Some("storage") => {
                let Some(page) = self.page().filter(|_| folder.is_some()) else {
                    return;
                };
                let store = store();
                let entries = message["entries"].clone();
                cx.background_executor()
                    .spawn(
                        async move { html_page_store::set_page_storage(&store, &page, &entries) },
                    )
                    .detach();
            }
            Some("po-tool") => self.receive_tool(&message, cx),
            Some("scroll") => {
                if let Some(ratio) = message["ratio"].as_f64()
                    && ratio.is_finite()
                {
                    let clamped = (ratio as f32).clamp(0.0, 1.0);
                    self.scroll_ratio.set(clamped);
                    let restore = format!(
                        "(()=>{{const el=document.scrollingElement||document.documentElement||document.body;\
                         if(!el)return;const m=Math.max(0,el.scrollHeight-el.clientHeight);\
                         if(m>0)window.scrollTo(0,m*{clamped:.6});}})()"
                    );
                    self.frame
                        .update(cx, |f, _| f.set_restore_script(Some(restore)));
                }
            }
            _ => {}
        }
    }
    /// `useHtmlLinkNavigation`: what a clicked link opens, or why not. An
    /// answer that arrives after the page was replaced is dropped.
    fn follow(&self, href: &str, base: Option<&str>, offline: bool, cx: &mut App) {
        if offline {
            return self.fail("offline", cx);
        }
        let generation = self.state.borrow().generation;
        let references = self.state.borrow().references.clone();
        let resolve = move |target: &str| references.as_ref().map(|r| r.resolve(target));
        let reference = html_page::navigation_href(href, base)
            .and_then(|target| navigation::resolve(&target, Some(&resolve)));
        match reference {
            Some(reference) if navigation::can_open(&reference) => match reference {
                Reference::External { href, .. } => self.open_external(href, generation, cx),
                // Not in the Explorer yet: the paths that are there open, and
                // none means the linked file is missing; a workspace that
                // cannot answer is a failure.
                Reference::Workspace {
                    status: Status::Unresolved,
                    candidates,
                    ..
                } if self.workspace.is_some() => {
                    let workspace = self.workspace.clone();
                    let found = cx.background_executor().spawn(async move {
                        let mut found = Vec::new();
                        for path in candidates {
                            let exists = workspace.as_ref().map_or(Ok(false), |w| {
                                w.entry_exists(Path::new(path.trim_start_matches('/')))
                            });
                            match exists {
                                Ok(true) => found.push(path),
                                Ok(false) => {}
                                Err(e) if e.kind == ErrorKind::NotFound => {}
                                Err(_) => return Err(()),
                            }
                        }
                        Ok(found)
                    });
                    let this = self.clone();
                    cx.spawn(async move |cx| {
                        let found = found.await;
                        cx.update(|cx| {
                            if this.state.borrow().generation != generation {
                                return;
                            }
                            match found {
                                Err(()) => this.fail("failed", cx),
                                Ok(found) if found.is_empty() => this.fail("missing", cx),
                                Ok(found) => this.open(found, cx),
                            }
                        });
                    })
                    .detach();
                }
                Reference::Workspace { candidates, .. } => self.open(candidates, cx),
                Reference::Denied { .. } => {}
            },
            Some(Reference::Workspace {
                status: Status::Missing,
                ..
            }) => self.fail("missing", cx),
            _ => self.fail("unavailable", cx),
        }
    }
    /// The host's external route: web addresses through the system browser
    /// (which can fail), other addresses (`mailto:`) through the app.
    fn open_external(&self, href: String, generation: u64, cx: &mut App) {
        let web = url::Url::parse(&href).is_ok_and(|u| matches!(u.scheme(), "http" | "https"));
        let route = self.state.borrow().external.clone().filter(|_| web);
        let Some(route) = route else {
            return cx.open_url(&href);
        };
        let opened = cx.background_executor().spawn(async move { route(&href) });
        let this = self.clone();
        cx.spawn(async move |cx| {
            let opened = opened.await;
            cx.update(|cx| {
                if opened.is_err() && this.state.borrow().generation == generation {
                    this.fail("failed", cx);
                }
            });
        })
        .detach();
    }
    /// The workbench opens the linked document.
    fn open(&self, paths: Vec<String>, cx: &mut App) {
        let events = self.state.borrow().events.clone();
        if let Some(events) = events {
            events(SurfaceEvent::OpenPaths(paths), cx);
        }
    }
    /// A message from the page, as its web view would post it.
    #[cfg(any(test, feature = "test-support"))]
    pub fn deliver(&self, body: &str, cx: &mut App) {
        let text = self.source.text(cx).unwrap_or_default();
        let folder = self.bridge().filter(|_| self.access() == Access::Allowed);
        if let Ok(message) = serde_json::from_str(body) {
            self.receive(message, html_preview::base_href(&text), folder, cx);
        }
    }
    #[cfg(any(test, feature = "test-support"))]
    pub fn notice(&self) -> Option<SharedString> {
        self.notice.borrow().clone()
    }
    fn fail(&self, reason: &str, cx: &mut App) {
        *self.notice.borrow_mut() = Some(t(&format!("editor.html.linkFailure.{reason}")).into());
        self.redraw(cx);
    }
    pub fn redraw(&self, cx: &mut App) {
        let events = self.state.borrow().events.clone();
        if let Some(events) = events {
            events(SurfaceEvent::Redraw, cx);
        }
        let _ = cx.update_window(self.window, |_, window, _| window.refresh());
    }
}

/// Injected scroll listener & initial scroll restorer for `viewportState` (`VW-23`).
/// The preview page for `text`: the document with `scripts`, under the
/// interactive policy or, with folder access, the offline one.
fn preview_content(
    text: &str,
    scripts: &str,
    offline: bool,
    source: Option<Source>,
    root: Option<PathBuf>,
    ipc: Ipc,
) -> Content {
    let (csp, policy) = if offline {
        (html_page::OFFLINE_CSP, html_page::OFFLINE_HEADER)
    } else {
        (
            html_preview::INTERACTIVE_CSP,
            html_preview::INTERACTIVE_HEADER,
        )
    };
    Content {
        source,
        root,
        entry: Entry::Html(preview_html(text, csp, scripts)),
        max_bytes: viewer_budget("html-artifact"),
        assets: vec![],
        ipc: Some(ipc),
        policy: Some(policy),
        frames: None,
        disk_assets: None,
        locked: offline,
    }
}

/// The native acceptance process loads the preview a lone document shows.
#[cfg(feature = "dev-capture")]
#[allow(dead_code)]
pub(crate) fn probe_content(text: &str, ipc: Ipc) -> Content {
    let mut scripts = html_page::link_script(None);
    scripts.push_str(&preview_scroll_script(0.));
    preview_content(text, &scripts, false, None, None, ipc)
}

fn preview_scroll_script(initial_ratio: f32) -> String {
    let init = initial_ratio.clamp(0.0, 1.0);
    format!(
        "<script>(()=>{{const ipc=window.ipc,init={init:.6};\
const scroller=()=>document.scrollingElement||document.documentElement||document.body;\
const apply=r=>{{const el=scroller();if(!el)return;const m=Math.max(0,el.scrollHeight-el.clientHeight);if(m>0)window.scrollTo(0,m*r)}};\
if(init>0){{addEventListener('DOMContentLoaded',()=>apply(init),{{once:true}});addEventListener('load',()=>apply(init),{{once:true}});requestAnimationFrame(()=>apply(init))}}\
let queued=false;\
const report=()=>{{if(queued)return;queued=true;requestAnimationFrame(()=>{{queued=false;const el=scroller();if(!el)return;\
const m=Math.max(0,el.scrollHeight-el.clientHeight);const ratio=m>0?Math.min(1,Math.max(0,el.scrollTop/m)):0;\
ipc&&ipc.postMessage(JSON.stringify({{type:'scroll',ratio}}))}})}};\
addEventListener('scroll',report,{{passive:true}});window.__puppyoneReportScroll=report}})();</script>"
    )
}

/// Interact's place while the page waits: a loading mark with its words,
/// or nothing while the person is asked.
struct Waiting(Option<&'static str>);
impl Render for Waiting {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = cx.palette();
        div()
            .size_full()
            .flex()
            .flex_col()
            .items_center()
            .justify_center()
            .gap(px(8.))
            .bg(p.canvas)
            .text_size(px(theme::ty().ui.meta))
            .text_color(p.subtle)
            .when_some(self.0, |d, label| {
                d.child(crate::ui::loading::LoadingMark::new("html-waiting").beside(t(label)))
                    .child(t(label))
            })
    }
}

#[cfg(test)]
#[path = "html_link_tests.rs"]
mod link_tests;
