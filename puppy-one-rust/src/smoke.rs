//! Opt-in integration driver. Refuses to run outside a marked temporary test
//! directory. Not compiled into ordinary builds and never uses real user data.
use crate::wake::Wake;
use crate::{
    documents::{Documents, Intent},
    web_editor::WebEditor,
};
use std::{
    path::PathBuf,
    time::{Duration, Instant},
};

pub struct Smoke {
    root: PathBuf,
    step: u8,
    started: Instant,
    reported_step: Option<u8>,
}
impl Smoke {
    pub fn from_environment() -> Option<Self> {
        let root = std::env::var_os("PUPPYONE_SMOKE_DIR").map(PathBuf::from)?;
        let root = root.canonicalize().expect("smoke root");
        let temp = std::env::temp_dir().canonicalize().expect("temp root");
        assert!(
            root.starts_with(temp)
                && root
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with("puppyone-rust-smoke-"),
            "Refusing non-test directory"
        );
        assert_eq!(
            std::fs::read_to_string(root.join(".puppyone-smoke-marker")).unwrap(),
            "disposable-native-editor-test\n"
        );
        Some(Self {
            root,
            step: 0,
            started: Instant::now(),
            reported_step: None,
        })
    }
    fn capture(&self, name: &str) -> bool {
        if std::env::var_os("PUPPYONE_SMOKE_CAPTURE").is_none() {
            return true;
        }
        if self.root.join(format!("captured-{name}")).exists() {
            return true;
        }
        std::fs::write(self.root.join("capture-request"), name).unwrap();
        false
    }
    pub fn tick(
        &mut self,
        d: &mut Documents,
        web: Option<&WebEditor>,
        ctx: &Wake,
        viewport: (f32, f32),
        popover: Option<crate::geometry::Rect>,
    ) {
        if self.reported_step != Some(self.step) {
            eprintln!(
                "Smoke checkpoint {} ({} ms)",
                self.step,
                self.started.elapsed().as_millis()
            );
            self.reported_step = Some(self.step);
        }
        if self.started.elapsed() > Duration::from_secs(40) {
            panic!(
                "WebView smoke timed out at step {}: {:?}",
                self.step, d.error
            );
        }
        ctx.after(Duration::from_millis(30));
        if let Some(ws) = &d.workspace {
            assert_eq!(ws.path, self.root, "Refusing to test a different workspace");
        }
        let Some(web) = web else {
            return;
        };
        let loaded = || {
            d.document
                .as_ref()
                .is_some_and(|doc| Some(&doc.id) == d.web_loaded.as_ref())
        };
        match self.step {
            0 if d.ready && d.workspace.is_some() && !d.busy() => {
                d.begin(Intent::OpenFile("note.md".into()), ctx);
                self.step = 1;
            }
            1 if loaded() => {
                web.evaluate(
                    "window.__puppySmoke.checkMarkdown().then(() => { window.__puppySmoke.edit('# Rust workspace\\n\\n你好 from CodeMirror\\n'); }).catch(error => window.ipc.postMessage(JSON.stringify({type:'fault',message:error.message})));",  
                )
                .unwrap();
                // The shared session autosaves; no explicit Save command is issued.
                self.step = 3;
            }
            3 if !d.busy()
                && !d.dirty
                && d.document.as_ref().is_some_and(|doc| {
                    doc.text == "# Rust workspace\n\n你好 from CodeMirror\n"
                }) =>
            {
                assert_eq!(
                    std::fs::read(self.root.join("note.md")).unwrap(),
                    "\u{feff}# Rust workspace\r\n\r\n你好 from CodeMirror\r\n".as_bytes()
                );
                web.evaluate("window.__hostProbeContent=document.querySelector('.cm-content'); window.__hostProbeState=window.__puppySmoke.state(); window.__puppySmoke.action('settings');").unwrap();
                self.step = 20;
            }
            20 if web.overlay_for_test() => {
                self.step = 21;
            }
            21 if web.overlay_for_test() => {
                #[cfg(target_os = "macos")]
                {
                    assert!(web.visible_for_test());
                    assert!(web.hit_is_native_for_test((viewport.0 / 2., viewport.1 / 2.)));
                }
                if !self.capture("settings-over-editor") {
                    return;
                }
                web.evaluate("if(!window.__puppySmoke.state().hostBlocked || !document.body.inert) throw Error('Settings must block web keyboard focus'); document.querySelector('.cm-content').focus(); if(document.querySelector('.cm-content').contains(document.activeElement)) throw Error('Hidden focus entered a native modal background'); window.__puppySmoke.action('settings');")
                    .unwrap();
                self.step = 22;
            }
            22 if !web.overlay_for_test() => {
                web.evaluate("window.__puppySmoke.action('project-menu');")
                    .unwrap();
                self.step = 23;
            }
            23 if web.overlay_for_test() => {
                self.step = 24;
            }
            24 if web.overlay_for_test() => {
                #[cfg(target_os = "macos")]
                {
                    assert!(web.visible_for_test());
                    assert!(
                        !web.hit_is_native_for_test((viewport.0 / 2., viewport.1 / 2.)),
                        "Non-modal project menu must leave the editor interactive"
                    );
                    // Probe the popup where it overlaps the editor content,
                    // wherever the Header places it.
                    let popup = popover.expect("project popup bounds");
                    assert!(
                        popup.y + popup.h > 48.,
                        "project popup must overlap the editor"
                    );
                    assert!(
                        web.hit_is_native_for_test((
                            popup.x + popup.w / 2.,
                            popup.y + popup.h - 6.
                        )),
                        "Project popup owns its overlapping hit rectangle"
                    );
                }
                if !self.capture("project-over-editor") {
                    return;
                }
                web.evaluate("if(window.__puppySmoke.state().hostBlocked || document.body.inert) throw Error('Non-modal popup blocked editor focus'); document.querySelector('.cm-content').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));").unwrap();
                self.step = 25;
            }
            25 if !web.overlay_for_test() => {
                web.evaluate("window.__puppySmoke.action('toggle-right');")
                    .unwrap();
                self.step = 26;
            }
            26 => {
                self.step = 27;
            }
            27 => {
                assert!(web.visible_for_test());
                if !self.capture("right-resize-editor") {
                    return;
                }
                web.evaluate("if(document.querySelector('.cm-content')!==window.__hostProbeContent || window.__puppySmoke.state().text!==window.__hostProbeState.text || window.__puppySmoke.state().revision!==window.__hostProbeState.revision) throw Error('Host presentation retired or edited the document'); window.__puppySmoke.action('toggle-right');").unwrap();
                self.step = 28;
            }
            28 => {
                std::fs::write(self.root.join("note.md"), b"external writer\n").unwrap();
                self.step = 4;
            }
            4 if !d.busy()
                && !d.saving()
                && d.document
                    .as_ref()
                    .is_some_and(|doc| doc.text == "external writer\n") =>
            {
                assert!(d.error.is_none());
                assert_eq!(
                    std::fs::read(self.root.join("note.md")).unwrap(),
                    b"external writer\n"
                );
                d.begin(Intent::OpenFile("second.txt".into()), ctx);
                self.step = 9;
            }
            9 if loaded()
                && d.document.as_ref().unwrap().relative == std::path::Path::new("second.txt") =>
            {
                assert_eq!(d.document.as_ref().unwrap().text, "second\n");
                web.evaluate("window.__puppySmoke.edit('second pending\\n');")
                    .unwrap();
                self.step = 30;
            }
            // Product CSV table viewer behind the same session: navigation
            // drains the text edit, then a model edit autosaves exact bytes.
            30 => {
                d.begin(Intent::OpenFile("table.csv".into()), ctx);
                self.step = 31;
            }
            31 if loaded()
                && d.document.as_ref().unwrap().relative == std::path::Path::new("table.csv") =>
            {
                assert_eq!(
                    std::fs::read(self.root.join("second.txt")).unwrap(),
                    b"second pending\n"
                );
                web.evaluate("(async()=>{for(let i=0;i<100&&!document.querySelector('.csv-table-editor');i++)await new Promise(r=>setTimeout(r,20));const s=window.__puppySmoke.state();if(s.viewer!=='csv-table')throw Error('CSV routed to '+s.viewer);if(!document.querySelector('.csv-table-editor'))throw Error('Product CSV table missing');if(!document.querySelector('.desktop-editor-pane-handle'))throw Error('Pane handle missing');for(let i=0;i<50&&!window.__puppySmoke.state().menuItems?.includes('csv-header-row');i++)await new Promise(r=>setTimeout(r,20));if(!window.__puppySmoke.state().menuItems.includes('csv-header-row'))throw Error('CSV pane menu contribution missing: '+window.__puppySmoke.state().menuItems);window.__puppySmoke.edit('id,name\\n1,edited\\n');})().catch(error=>window.ipc.postMessage(JSON.stringify({type:'fault',message:'Smoke: '+error.message})));")
                    .unwrap();
                self.step = 32;
            }
            32 if !d.busy()
                && !d.saving()
                && !d.dirty
                && d.document
                    .as_ref()
                    .is_some_and(|doc| doc.text == "id,name\n1,edited\n") =>
            {
                assert_eq!(
                    std::fs::read(self.root.join("table.csv")).unwrap(),
                    b"id,name\n1,edited\n"
                );
                web.evaluate("window.__puppySmoke.edit('id,name\\n1,pending\\n');")
                    .unwrap();
                self.step = 10;
            }
            10 => {
                // Navigation snapshots catch edits even before their dirty event.
                d.begin(Intent::Quit, ctx);
                self.step = 14;
            }
            14 if d.allow_quit => {
                assert_eq!(
                    std::fs::read(self.root.join("table.csv")).unwrap(),
                    b"id,name\n1,pending\n"
                );
                let result = serde_json::json!({"passed":true,"host":"gpui-wry-codemirror","checks":["real-folder-open","real-web-editor-load","product-markdown-rich-heading-and-table","rich-checkbox-edit-and-undo",
                        "host-menu-history-reaches-editor-model",
                        "history-rejects-modal-and-stale-document","source-live-toggle-retains-view-and-bytes","theme-retains-rich-model","eight-locales-retain-model-and-baseline","markdown-shortcuts-before-host-shortcuts","settings-retains-visible-editor","native-task-blocks-dom-focus-without-remount","project-popup-native-hit-routing","web-outside-click-dismisses-project-popup","right-toggle-retains-document-view-and-revision","utf8-bom-crlf-save-roundtrip","automatic-save-without-command","external-disk-adoption-without-conflict-ui","switch-file-without-save-prompt","product-csv-table-viewer-and-pane-menu","csv-model-edit-autosaves-exact-bytes","automatic-drain-before-quit"],"elapsedMs":self.started.elapsed().as_millis()});
                std::fs::write(
                    self.root.join("result.json"),
                    serde_json::to_vec_pretty(&result).unwrap(),
                )
                .unwrap();
                println!("Native WebView editor smoke passed");
                self.step = 15;
            }
            _ => {}
        }
    }
}
