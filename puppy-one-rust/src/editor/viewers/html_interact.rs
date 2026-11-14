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
    web::WebFrame,
};
use crate::{
    editor::{
        navigation::{self, Reference, ReferenceContext, Status},
        registry::{
            SurfaceEvent, SurfaceEvents, SurfaceRequest, ViewerSurface, document_folder,
            document_source,
        },
    },
    localization::{t, tf},
    platform::{
        html_page_store,
        webview::{Budgeted, Content, Entry, Ipc, SCHEME, Source},
    },
    theme,
    ui::appearance::ActiveAppearance,
    workspace::Workspace,
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
/// `html-artifact` resourcePolicy.maxSourceBytes.
pub(super) const BUDGET: u64 = 4 * 1024 * 1024;
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

#[derive(Default)]
struct State {
    access: Access,
    /// The page text the decision is for.
    digest: String,
    asking: bool,
    references: Option<ReferenceContext>,
    events: Option<SurfaceEvents>,
    /// The shown page's messages.
    inbox: Option<Task<()>>,
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
        window: &Window,
        cx: &mut App,
    ) -> Self {
        let (folder, assets) = (document_folder(request.id), document_source(request.id));
        let workspace = request.workspace.clone();
        let (name, dark) = (request.name.to_owned(), request.dark);
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
            window: window.window_handle(),
            notice: Rc::default(),
            state: RefCell::default(),
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
    pub fn rename(&self, name: &str) {
        *self.name.borrow_mut() = name.to_owned();
    }
    pub fn set_references(&self, references: Option<ReferenceContext>) {
        self.state.borrow_mut().references = references;
    }
    pub fn set_events(&self, events: SurfaceEvents) {
        self.state.borrow_mut().events = Some(events);
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
        let asked = cx.update_window(self.window, |_, window, cx| {
            window.prompt(
                PromptLevel::Info,
                title,
                Some(&detail),
                &[
                    PromptButton::new(t("editor.html.folderAccessDecline")),
                    PromptButton::new(t("editor.html.folderAccessAllow")),
                ],
                cx,
            )
        });
        let this = self.clone();
        cx.spawn(async move |cx| {
            let allowed = match asked {
                Ok(answer) => matches!(answer.await, Ok(1)),
                Err(_) => false,
            };
            cx.update(|cx| {
                this.state.borrow_mut().asking = false;
                this.set_allowed(allowed, cx);
            });
        })
        .detach();
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
        let (csp, policy) = if offline {
            (html_page::OFFLINE_CSP, html_page::OFFLINE_HEADER)
        } else {
            (
                html_preview::INTERACTIVE_CSP,
                html_preview::INTERACTIVE_HEADER,
            )
        };
        let (tx, rx) = async_channel::unbounded::<String>();
        let content = Content {
            source: self
                .assets
                .clone()
                .filter(|_| self.folder.is_none())
                .map(|source| Source(Arc::new(Budgeted::new(source, MAX_REFERENCES, BUDGET)))),
            root: self.folder.clone(),
            entry: Entry::Html(preview_html(text, csp, &scripts)),
            max_bytes: BUDGET,
            assets: vec![],
            ipc: Some(Ipc(tx)),
            policy: Some(policy),
            frames: None,
            disk_assets: None,
            locked: offline,
        };
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
    }
    fn receive(
        &self,
        message: serde_json::Value,
        base: Option<String>,
        folder: Option<Arc<Mutex<Folder>>>,
        cx: &mut App,
    ) {
        match message["type"].as_str() {
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
            _ => {}
        }
    }
    /// `useHtmlLinkNavigation`: what a clicked link opens, or why not.
    fn follow(&self, href: &str, base: Option<&str>, offline: bool, cx: &mut App) {
        if offline {
            return self.fail("offline", cx);
        }
        let references = self.state.borrow().references.clone();
        let resolve = move |target: &str| references.as_ref().map(|r| r.resolve(target));
        let reference = html_page::navigation_href(href, base)
            .and_then(|target| navigation::resolve(&target, Some(&resolve)));
        match reference {
            Some(reference) if navigation::can_open(&reference) => match reference {
                Reference::External { href, .. } => cx.open_url(&href),
                Reference::Workspace { candidates, .. } => {
                    let events = self.state.borrow().events.clone();
                    if let Some(events) = events {
                        events(SurfaceEvent::OpenPaths(candidates), cx);
                    }
                }
                Reference::Denied { .. } => {}
            },
            Some(Reference::Workspace {
                status: Status::Missing,
                ..
            }) => self.fail("missing", cx),
            _ => self.fail("unavailable", cx),
        }
    }
    /// A message from the page, as its web view would post it.
    #[cfg(test)]
    pub fn deliver(&self, body: &str, cx: &mut App) {
        let text = self.source.text(cx).unwrap_or_default();
        let folder = self.bridge().filter(|_| self.access() == Access::Allowed);
        if let Ok(message) = serde_json::from_str(body) {
            self.receive(message, html_preview::base_href(&text), folder, cx);
        }
    }
    #[cfg(test)]
    pub fn notice(&self) -> Option<SharedString> {
        self.notice.borrow().clone()
    }
    fn fail(&self, reason: &str, cx: &mut App) {
        *self.notice.borrow_mut() = Some(t(&format!("editor.html.linkFailure.{reason}")).into());
        self.redraw(cx);
    }
    fn redraw(&self, cx: &mut App) {
        let _ = cx.update_window(self.window, |_, window, _| window.refresh());
    }
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
                d.child(crate::ui::loading::LoadingMark::new("html-waiting"))
                    .child(t(label))
            })
    }
}
