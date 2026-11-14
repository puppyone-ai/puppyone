//! `AppPreviewViewer` (`viewers/app`): the product's App Preview, bundled
//! from its sources by `tools/import-app-preview.mjs` and running in the
//! system web engine, over the native runtime (`platform::app_preview`).
//!
//! Detection and setup run in the page over this side's workspace reads;
//! setup's write rereads the file and refuses one that changed. Start,
//! restart, stop, logs and Open in browser go to the runtime off the main
//! thread; a local server's first run asks for confirmation in a native
//! prompt. The running app's origin is the only one the page's frame may
//! load. Closing the surface releases its share of the app.
use super::{html_visual::script_json, web::WebFrame, workspace_port};
use crate::{
    editor::registry::{SurfaceInput, SurfaceRequest, ViewerSurface},
    localization::{t, tf},
    platform::{
        app_preview::runtime::{self, Confirm, Snapshot, TrustPrompt},
        webview::{Content, Entry, Frames, Ipc},
    },
    typography::Scale,
    workspace::Workspace,
};
use gpui::{prelude::*, *};
use serde::Deserialize;
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

const SCRIPT: &[u8] = include_bytes!("../../../assets/web/app-preview.js");
const STYLE: &[u8] = include_bytes!("../../../assets/web/app-preview.css");

/// Messages the page posts.
#[derive(Debug, PartialEq, Eq, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Inbound {
    Ready,
    List {
        request: u64,
        path: Option<String>,
    },
    Read {
        request: u64,
        path: String,
    },
    Configure {
        request: u64,
        path: String,
        content: String,
        expected: String,
    },
    Start {
        request: u64,
        path: String,
    },
    Restart {
        request: u64,
        path: String,
    },
    Stop {
        request: u64,
        path: String,
    },
    Logs {
        request: u64,
        path: String,
    },
    OpenExternal {
        request: u64,
        path: String,
    },
}

pub fn open(request: &SurfaceRequest, window: &mut Window, cx: &mut App) -> Box<dyn ViewerSurface> {
    let text = match request.input {
        SurfaceInput::Text(text) => text.to_owned(),
        _ => String::new(),
    };
    let workspace = request.workspace.clone();
    let handle = window.window_handle();
    let (name, dark) = (request.name.to_owned(), request.dark);
    let view = cx.new(|cx| {
        let mut view = AppPreviewView {
            name,
            text,
            workspace,
            window: handle,
            owner: runtime::owner(),
            dark,
            ready: false,
            frames: Frames::default(),
            frame: None,
            _inbox: None,
            _runtime: None,
        };
        view.show(cx);
        view.follow_runtime(cx);
        view
    });
    Box::new(AppPreviewSurface { view })
}

struct AppPreviewView {
    name: String,
    text: String,
    workspace: Option<Arc<Workspace>>,
    window: AnyWindowHandle,
    /// This surface's share of the apps it starts.
    owner: u64,
    dark: bool,
    ready: bool,
    frames: Frames,
    frame: Option<Entity<WebFrame>>,
    _inbox: Option<Task<()>>,
    _runtime: Option<Task<()>>,
}
impl Drop for AppPreviewView {
    fn drop(&mut self) {
        let owner = self.owner;
        // Stopping a process waits for it; never on the main thread.
        std::thread::spawn(move || runtime::runtime().release_owner(owner));
    }
}

impl AppPreviewView {
    /// The local workspace root the runtime serves (Cloud has no runtime).
    fn root(&self) -> Option<PathBuf> {
        self.workspace
            .as_ref()
            .and_then(|w| w.local_root().map(Path::to_path_buf))
    }
    fn show(&mut self, cx: &mut Context<Self>) {
        let boot = serde_json::json!({
            "text": self.text,
            "name": Path::new(&self.name).file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default(),
            "path": self.name,
            "available": self.root().is_some(),
            "locale": crate::localization::current_code(),
            "direction": "ltr",
            "messages": crate::localization::messages(&[
                "editor.app.", "editor.preview.", "editor.find.", "common.", "shared-ui.",
            ]),
        });
        let (tx, rx) = async_channel::unbounded::<String>();
        let content = Content {
            root: None,
            source: None,
            entry: Entry::Html(page(&boot, self.dark)),
            max_bytes: 0,
            assets: vec![("app-preview.js", SCRIPT), ("app-preview.css", STYLE)],
            ipc: Some(Ipc(tx)),
            policy: None,
            frames: Some(self.frames.clone()),
            disk_assets: None,
        };
        self.ready = false;
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
    /// `subscribeRuntime`: this workspace's app states, as they change.
    fn follow_runtime(&mut self, cx: &mut Context<Self>) {
        let Some(root) = self.root().and_then(|r| r.canonicalize().ok()) else {
            return;
        };
        let updates = runtime::runtime().subscribe();
        self._runtime = Some(cx.spawn(async move |this, cx| {
            while let Ok(update) = updates.recv().await {
                if update.root != root {
                    continue;
                }
                let alive = this.update(cx, |view, cx| {
                    view.allow_frame(&update.result);
                    view.post(
                        serde_json::json!({ "type": "runtime", "state": update.result }),
                        cx,
                    );
                });
                if alive.is_err() {
                    break;
                }
            }
        }));
    }
    fn allow_frame(&self, snapshot: &Snapshot) {
        if let Some(url) = snapshot
            .url
            .as_deref()
            .filter(|_| snapshot.status == "running")
        {
            self.frames.allow(url);
        }
    }
    fn post(&mut self, message: serde_json::Value, cx: &mut Context<Self>) -> bool {
        let script = format!(
            "window.__puppyoneAppPreview&&window.__puppyoneAppPreview({})",
            script_json(&message)
        );
        self.ready
            && self
                .frame
                .as_ref()
                .is_some_and(|frame| frame.read(cx).evaluate(&script))
    }
    fn reply(
        &mut self,
        request: u64,
        result: Result<serde_json::Value, String>,
        cx: &mut Context<Self>,
    ) {
        let message = match result {
            Ok(value) => {
                serde_json::json!({ "type": "reply", "request": request, "ok": true, "value": value })
            }
            Err(error) => {
                serde_json::json!({ "type": "reply", "request": request, "ok": false, "error": error })
            }
        };
        self.post(message, cx);
    }
    fn answer(
        &mut self,
        request: u64,
        task: Task<Result<serde_json::Value, String>>,
        cx: &mut Context<Self>,
    ) {
        cx.spawn(async move |this, cx| {
            let result = task.await;
            let _ = this.update(cx, |view, cx| view.reply(request, result, cx));
        })
        .detach();
    }
    /// The trust prompt, asked on the main thread for a runtime call that
    /// waits on a background thread.
    fn confirm(&self, cx: &mut Context<Self>) -> Confirm {
        let (tx, rx) = async_channel::unbounded::<(TrustPrompt, std::sync::mpsc::Sender<bool>)>();
        let window = self.window;
        cx.spawn(async move |_, cx| {
            while let Ok((prompt, answer)) = rx.recv().await {
                let asked = cx.update_window(window, |_, window, cx| {
                    let mut detail = vec![
                        t("native.appPreview.run.intro").to_owned(),
                        t("native.appPreview.run.security").to_owned(),
                        String::new(),
                        tf(
                            "native.appPreview.run.command",
                            &[("command", prompt.command.clone().into())],
                        ),
                        tf(
                            "native.appPreview.run.workingDirectory",
                            &[("directory", prompt.directory.clone().into())],
                        ),
                    ];
                    if let Some(permissions) = &prompt.permissions {
                        detail.push(tf(
                            "native.appPreview.run.permissions",
                            &[("permissions", permissions.clone().into())],
                        ));
                    }
                    window.prompt(
                        PromptLevel::Info,
                        &tf(
                            "native.appPreview.run.message",
                            &[("appName", prompt.app_name.clone().into())],
                        ),
                        Some(&detail.join("\n")),
                        &[
                            PromptButton::new(t("native.appPreview.run.confirm")),
                            PromptButton::cancel(t("native.appPreview.run.cancel")),
                        ],
                        cx,
                    )
                });
                let run = match asked {
                    Ok(choice) => matches!(choice.await, Ok(0)),
                    Err(_) => false,
                };
                let _ = answer.send(run);
            }
        })
        .detach();
        Box::new(move |prompt| {
            let (answer, chosen) = std::sync::mpsc::channel();
            tx.send_blocking((prompt, answer)).is_ok() && chosen.recv().unwrap_or(false)
        })
    }
    fn receive(&mut self, message: Inbound, cx: &mut Context<Self>) {
        let workspace = self.workspace.clone();
        let unavailable = || {
            Err::<serde_json::Value, String>(
                "App Preview is unavailable for this workspace.".into(),
            )
        };
        match message {
            Inbound::Ready => self.ready = true,
            Inbound::List { request, path } => {
                let task = cx.background_executor().spawn(async move {
                    match workspace {
                        Some(w) => workspace_port::list(&w, path.as_deref()),
                        None => unavailable(),
                    }
                });
                self.answer(request, task, cx);
            }
            Inbound::Read { request, path } => {
                let task = cx.background_executor().spawn(async move {
                    match workspace {
                        Some(w) => workspace_port::read(&w, &path),
                        None => unavailable(),
                    }
                });
                self.answer(request, task, cx);
            }
            Inbound::Configure {
                request,
                path,
                content,
                expected,
            } => {
                let task = cx.background_executor().spawn(async move {
                    match workspace {
                        Some(w) => workspace_port::write_expected(
                            &w,
                            &path,
                            &expected,
                            &content,
                            "This App changed while setup was open. Review the latest version and try again.",
                        ),
                        None => unavailable(),
                    }
                });
                self.answer(request, task, cx);
            }
            Inbound::Start { request, path } => self.run(request, path, 0, cx),
            Inbound::Restart { request, path } => self.run(request, path, 1, cx),
            Inbound::Stop { request, path } => self.run(request, path, 2, cx),
            Inbound::Logs { request, path } => self.run(request, path, 3, cx),
            Inbound::OpenExternal { request, path } => self.run(request, path, 4, cx),
        }
    }
    /// A runtime operation (start, restart, stop, logs, open in browser).
    fn run(&mut self, request: u64, path: String, kind: u8, cx: &mut Context<Self>) {
        let Some(root) = self.root() else {
            return self.reply(
                request,
                Err("App Preview is unavailable for this workspace.".into()),
                cx,
            );
        };
        let owner = self.owner;
        let confirm = self.confirm(cx);
        let task = cx.background_executor().spawn(async move {
            let runtime = runtime::runtime();
            let json =
                |snapshot: Snapshot| serde_json::to_value(snapshot).map_err(|e| e.to_string());
            match kind {
                0 => runtime.start(owner, &root, &path, &confirm).and_then(json),
                1 => runtime
                    .restart(owner, &root, &path, &confirm)
                    .and_then(json),
                2 => runtime.stop(owner, &root, &path).and_then(json),
                3 => runtime
                    .logs(owner, &root, &path)
                    .map(serde_json::Value::String),
                _ => runtime
                    .open_external(owner, &root, &path, &confirm)
                    .map(|()| serde_json::Value::Null),
            }
        });
        // The frame may load the app before the page shows it.
        let frames = self.frames.clone();
        cx.spawn(async move |this, cx| {
            let result = task.await;
            if let Ok(value) = &result
                && value["status"] == "running"
                && let Some(url) = value["url"].as_str()
            {
                frames.allow(url);
            }
            let _ = this.update(cx, |view, cx| view.reply(request, result, cx));
        })
        .detach();
    }
    fn replace_text(&mut self, text: &str, cx: &mut Context<Self>) {
        if self.text == text {
            return;
        }
        self.text = text.to_owned();
        if !self.post(serde_json::json!({ "type": "reset", "text": text }), cx) {
            self.show(cx);
        }
    }
    fn set_dark(&mut self, dark: bool, cx: &mut Context<Self>) {
        if self.dark != dark {
            self.dark = dark;
            self.show(cx);
        }
    }
}

/// The entry document: the product's tokens with the native theme's
/// colours over them, then the bundle.
fn page(boot: &serde_json::Value, dark: bool) -> String {
    let tokens: String = crate::theme::pack_tokens(dark)
        .iter()
        .filter(|(name, value)| {
            name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
                && !value.contains(['<', '>', '{', '}', ';'])
        })
        .map(|(name, value)| format!("--po-{name}:{value};"))
        .collect();
    let locale = crate::localization::current_code();
    let scheme = if dark { "dark" } else { "light" };
    format!(
        "<!doctype html><html lang=\"{lang}\" class=\"{class}\" data-initial-theme=\"{scheme}\"><head><meta charset=\"utf-8\">\
<meta name=\"viewport\" content=\"width=device-width\">\
<link rel=\"stylesheet\" href=\"__assets__/app-preview.css\">\
<style>:root:root:root{{{tokens}}}html,body,#root{{height:100%;margin:0}}body{{background:var(--po-editor-bg,var(--po-canvas));color:var(--po-text);font-family:var(--po-font-ui)}}#root>.app-preview-host{{height:100%;display:flex;flex-direction:column}}</style>\
</head><body><div id=\"root\"></div><script>window.__PUPPYONE_APP_PREVIEW={boot}</script>\
<script src=\"__assets__/app-preview.js\"></script></body></html>",
        lang = locale.replace(|c: char| !c.is_ascii_alphanumeric() && c != '-', ""),
        class = if dark { "dark" } else { "" },
        boot = script_json(boot),
    )
}

struct AppPreviewSurface {
    view: Entity<AppPreviewView>,
}
impl ViewerSurface for AppPreviewSurface {
    fn element(&self) -> AnyElement {
        self.view.clone().into_any_element()
    }
    fn replace_text(&self, text: &str, _: &mut Window, cx: &mut App) {
        self.view.update(cx, |view, cx| view.replace_text(text, cx));
    }
    fn rebind_name(&self, name: &str, cx: &mut App) {
        let name = name.to_owned();
        self.view.update(cx, |view, _| view.name = name);
    }
    fn apply(&self, _: bool, dark: bool, _: Scale, _: &mut Window, cx: &mut App) {
        self.view.update(cx, |view, cx| view.set_dark(dark, cx));
    }
}

impl Render for AppPreviewView {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().size_full().children(self.frame.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn requests_are_typed_and_the_frame_admits_only_the_running_app() {
        assert_eq!(
            serde_json::from_str::<Inbound>(
                r#"{"type":"openExternal","request":3,"path":"a.puppyoneapp"}"#
            )
            .unwrap(),
            Inbound::OpenExternal {
                request: 3,
                path: "a.puppyoneapp".into()
            }
        );
        assert!(serde_json::from_str::<Inbound>(r#"{"type":"spawn","request":1}"#).is_err());
        let frames = Frames::default();
        frames.allow("http://127.0.0.1:5173/app");
        assert!(frames.allows("http://127.0.0.1:5173/other?x=1"));
        assert!(!frames.allows("http://127.0.0.1:5174/"));
        assert!(!frames.allows("puppyone-local://local/x"));
        let html = page(&serde_json::json!({ "text": "</script>" }), false);
        assert!(html.contains("__assets__/app-preview.js") && !html.contains("\"</script>"));
    }
}
