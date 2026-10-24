//! One restricted local WebView for the editor CONTENT. Rust still owns all
//! surrounding layout, toolbar, navigation, document identity and disk writes.
use crate::documents::ClientMessage;
use crate::{
    geometry::{HitMap, Rect},
    wake::Wake,
};
use serde_json::Value;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
    mpsc::{self, Receiver},
};
use std::{cell::RefCell, rc::Rc};

pub struct WebEditor {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    view: wry::WebView,
    rx: Receiver<ClientMessage>,
    overflow: Arc<AtomicBool>,
    bounds: Option<(i32, i32, u32, u32)>,
    visible: bool,
    overlay: bool,
    #[cfg(target_os = "macos")]
    composition: crate::web_composition_macos::Composition,
    dark: Option<(bool, i8)>,
    locale: Option<String>,
    dismiss_popovers: bool,
    input_blocked: bool,
    interaction: Option<(bool, bool)>,
}
impl WebEditor {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    pub fn new(
        window: &gpui::Window,
        wake: &Wake,
        hits: Rc<RefCell<HitMap>>,
    ) -> Result<Self, String> {
        let (tx, rx) = mpsc::sync_channel(64);
        let overflow = Arc::new(AtomicBool::new(false));
        let sink = tx.clone();
        let alarm = overflow.clone();
        let wake = wake.clone();
        let nonce = uuid::Uuid::new_v4().simple().to_string();
        let html = include_str!("../editor/src/index.html")
            .replace("__NONCE__", &nonce)
            .replace(
                "__STYLE_BUNDLE__",
                include_str!("../editor/bundle/editor.css"),
            )
            .replace(
                "__SMOKE__",
                if cfg!(feature = "webview-smoke") {
                    "true"
                } else {
                    "false"
                },
            )
            .replace(
                "__BUNDLE__",
                &include_str!("../editor/bundle/editor.js").replace("</script", "<\\/script"),
            );
        let view = wry::WebViewBuilder::new()
            .with_html(html)
            .with_incognito(true)
            .with_devtools(false)
            .with_clipboard(true)
            .with_visible(false)
            .with_background_color((22, 22, 22, 255))
            .with_navigation_handler(|url| url == "about:blank")
            .with_new_window_req_handler(|_, _| wry::NewWindowResponse::Deny)
            .with_drag_drop_handler(|_| true)
            .with_ipc_handler(move |request| {
                // Bound queue and individual payloads. Document IDs, request
                // IDs and phase checks are enforced again by Documents.
                let message = if request.body().len() > crate::workspace::MAX_TEXT_BYTES * 6 + 4096
                {
                    ClientMessage::Fault {
                        message: "IPC payload too large".into(),
                    }
                } else {
                    match serde_json::from_str::<ClientMessage>(request.body()) {
                        Ok(message) => message,
                        Err(_) => ClientMessage::Fault {
                            message: "Invalid editor protocol message".into(),
                        },
                    }
                };
                if sink.try_send(message).is_err() {
                    alarm.store(true, Ordering::Relaxed);
                }
                wake.notify();
            })
            .build_as_child(window)
            .map_err(|e| e.to_string())?;
        #[cfg(target_os = "macos")]
        let composition = crate::web_composition_macos::Composition::install(&view, hits)?;
        Ok(Self {
            view,
            rx,
            overflow,
            bounds: None,
            visible: false,
            overlay: false,
            #[cfg(target_os = "macos")]
            composition,
            dark: None,
            locale: None,
            dismiss_popovers: false,
            input_blocked: false,
            interaction: None,
        })
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    pub fn new(
        _window: &gpui::Window,
        wake: &Wake,
        hits: Rc<RefCell<HitMap>>,
    ) -> Result<Self, String> {
        Err("This editor host currently supports macOS and Windows only; Linux embedding is not implemented.".into())
    }
    pub fn messages(&self) -> Vec<ClientMessage> {
        let mut messages: Vec<_> = self.rx.try_iter().collect();
        if self.overflow.swap(false, Ordering::Relaxed) {
            messages.push(ClientMessage::Fault{message:"Editor queue overflow; retry the operation. Unsaved work must not be discarded.".into()});
        }
        messages
    }
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    pub fn send(&self, message: &Value) -> Result<(), String> {
        #[cfg(feature = "webview-smoke")]
        if std::env::var_os("PUPPYONE_SMOKE_DIR").is_some() {
            let mut shown = message.clone();
            if let Some(text) = shown.get_mut("text") {
                *text = Value::String(format!("<{} chars>", text.as_str().map_or(0, str::len)));
            }
            eprintln!("Host → island: {shown}");
        }
        self.view
            // A host-evaluated failure would surface only as "Script error.".
            .evaluate_script(&format!(
                "try{{window.puppyEditor.receive({message});}}catch(error){{window.ipc.postMessage(JSON.stringify({{type:'fault',message:'Host message: '+error.message}}));}}"
            ))
            .map_err(|e| e.to_string())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    pub fn send(&self, _message: &Value) -> Result<(), String> {
        Err("No editor host".into())
    }
    /// Editor interaction preferences (`EditorInteractionPreferences`) owned
    /// by native Settings → Experimental.
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    pub fn interaction(&mut self, block_drag: bool, heading_outline: bool) -> Result<(), String> {
        if self.interaction != Some((block_drag, heading_outline)) {
            self.send(&serde_json::json!({"kind":"preferences","interaction":{
                "markdownBlockDragEnabled": block_drag,
                "markdownHeadingOutlineEnabled": heading_outline,
            }}))?;
            self.interaction = Some((block_drag, heading_outline));
        }
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    pub fn interaction(&mut self, _: bool, _: bool) -> Result<(), String> {
        Ok(())
    }
    pub fn presentation(
        &mut self,
        locale: &str,
        dismiss_popovers: bool,
        input_blocked: bool,
    ) -> Result<(), String> {
        if self.locale.as_deref() != Some(locale) {
            self.send(&serde_json::json!({"kind":"locale","locale":locale}))?;
            self.locale = Some(locale.to_owned());
        }
        if self.dismiss_popovers != dismiss_popovers || self.input_blocked != input_blocked {
            self.send(
                &serde_json::json!({"kind":"host-overlay","dismissOnPointerDown":dismiss_popovers,"inputBlocked":input_blocked}),
            )?;
            self.dismiss_popovers = dismiss_popovers;
            self.input_blocked = input_blocked;
        }
        Ok(())
    }
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    pub fn sync(
        &mut self,
        ppp: f32,
        bounds: Rect,
        visible: bool,
        dark: bool,
        ready: bool,
        overlay: bool,
    ) -> Result<(), String> {
        let b = (
            (bounds.x * ppp).round() as i32,
            (bounds.y * ppp).round() as i32,
            (bounds.w * ppp).round().max(1.) as u32,
            (bounds.h * ppp).round().max(1.) as u32,
        );
        #[cfg(target_os = "macos")]
        self.composition.bounds(bounds);
        #[cfg(not(target_os = "macos"))]
        if self.bounds != Some(b) {
            self.view
                .set_bounds(wry::Rect {
                    position: wry::dpi::PhysicalPosition::new(b.0, b.1).into(),
                    size: wry::dpi::PhysicalSize::new(b.2, b.3).into(),
                })
                .map_err(|e| e.to_string())?;
        }
        self.bounds = Some(b);
        if overlay && !self.overlay {
            self.view.focus_parent().map_err(|e| e.to_string())?;
        }
        self.overlay = overlay;
        let visible = visible && (cfg!(target_os = "macos") || !overlay);
        if self.visible != visible {
            if !visible {
                let _ = self.view.focus_parent();
            }
            self.view.set_visible(visible).map_err(|e| e.to_string())?;
            self.visible = visible;
            if visible {
                let _ = self.view.focus();
            }
        }
        if ready && self.dark != Some((dark, (crate::theme::font_size(14.) - 14.) as i8)) {
            self.send(&serde_json::json!({"kind":"theme","dark":dark,"scale":(crate::theme::font_size(14.)-14.) as i8}))?;
            self.dark = Some((dark, (crate::theme::font_size(14.) - 14.) as i8));
        }
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    pub fn sync(
        &mut self,
        _ppp: f32,
        _bounds: Rect,
        _visible: bool,
        _dark: bool,
        _ready: bool,
        _overlay: bool,
    ) -> Result<(), String> {
        Ok(())
    }
    #[cfg(all(feature = "webview-smoke", target_os = "macos"))]
    pub fn hit_is_native_for_test(&self, position: (f32, f32)) -> bool {
        self.composition.editor_hit_is_native(position)
    }
    #[cfg(feature = "webview-smoke")]
    pub fn overlay_for_test(&self) -> bool {
        self.overlay
    }
    #[cfg(feature = "webview-smoke")]
    pub fn visible_for_test(&self) -> bool {
        self.visible
    }
    #[cfg(all(
        feature = "webview-smoke",
        any(target_os = "macos", target_os = "windows")
    ))]
    pub fn evaluate(&self, script: &str) -> Result<(), String> {
        // Host-injected scripts surface only as an opaque "Script error.";
        // report the real assertion through the island's fault channel.
        let wrapped = format!(
            "try{{{script}\n}}catch(error){{window.ipc.postMessage(JSON.stringify({{type:'fault',message:'Smoke: '+error.message}}));}}"
        );
        self.view
            .evaluate_script(&wrapped)
            .map_err(|e| e.to_string())
    }
}
