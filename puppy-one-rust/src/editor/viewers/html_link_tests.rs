#![cfg(test)]
//! Links clicked in an Interact page (`htmlLinkNavigation.test.tsx`; gap
//! `html-preview-link-routing`): where a link points against the page's own
//! base, which documents carry the fixed UI scripts, and how a clicked
//! link reaches the host's external and workspace routes, or says why not.
use super::{
    super::{
        code,
        html_page::{link_script, navigation_href},
        html_preview::{INTERACTIVE_CSP, base_href},
    },
    ExternalRoute, Interact, preview_html,
};
use crate::{
    editor::{
        navigation::{Document, ReferenceContext, ReferenceIndex},
        registry::{
            EditorDocument, SourceKind, SurfaceEvent, SurfaceInput, SurfaceRequest, ViewerSurface,
            resolve,
        },
    },
    localization::t,
    typography::Scale,
};
use core::prelude::v1::test;
use gpui::{App, TestAppContext, VisualTestContext, Window};
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
    sync::{Arc, Mutex},
};

/// `HTML link destinations` #0–#10.
#[test]
fn links_resolve_against_the_pages_own_base() {
    for (href, base, expected) in [
        ("notes.md", None, "./notes.md"),
        ("notes%20%E4%B8%AD.md", None, "./notes 中.md"),
        ("../other.html#section", None, "../other.html#section"),
        ("other.html", Some("../pages/"), "../pages/other.html"),
        (
            "other.html",
            Some("../pages/index.html"),
            "../pages/other.html",
        ),
        ("/notes.md", Some("pages/"), "/notes.md"),
        (
            "other.html?q=1#section",
            Some("https://example.test/docs/"),
            "https://example.test/docs/other.html?q=1#section",
        ),
        ("//example.test/docs", None, "https://example.test/docs"),
        (
            "//example.test/docs",
            Some("http://example.test/"),
            "http://example.test/docs",
        ),
        (
            "guide.html",
            Some("//example.test/docs/"),
            "https://example.test/docs/guide.html",
        ),
        (
            "mailto:person@example.test",
            None,
            "mailto:person@example.test",
        ),
    ] {
        assert_eq!(
            navigation_href(href, base).as_deref(),
            Some(expected),
            "{href} with base {base:?}"
        );
    }
}

/// #11–#18.
#[test]
fn malformed_or_frame_local_links_are_refused() {
    for href in [
        "#section",
        "",
        "//",
        "a\n.md",
        "%2fetc/passwd",
        "a%5cb.md",
        "%00.md",
        "%broken",
    ] {
        assert_eq!(navigation_href(href, None), None, "{href:?}");
    }
}

/// #19: the fixed UI scripts run ahead of the author's own policy, which
/// stays as written and keeps governing the page's own scripts (the
/// product adds a nonce to that policy instead).
#[test]
fn fixed_ui_scripts_lead_the_authors_policy_without_enabling_its_scripts() {
    let author = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; \
        script-src 'nonce-author'; connect-src 'none'\"><script>alert(1)</script>";
    let scripts = link_script(None);
    let page = preview_html(author, INTERACTIVE_CSP, &scripts);
    let host_policy = page.find("Content-Security-Policy").unwrap();
    let ui_script = page.find(&scripts).unwrap();
    let author_policy = page.find("script-src 'nonce-author'").unwrap();
    let authored_script = page.find("<script>alert(1)").unwrap();
    assert!(host_policy < ui_script && ui_script < author_policy);
    assert!(author_policy < authored_script);
    // The author's policy is kept as written: no source is added to it.
    assert!(
        page.contains(
            "content=\"default-src 'none'; script-src 'nonce-author'; connect-src 'none'\""
        )
    );
    // A page that already allows inline scripts is left as it is.
    let open = "<meta http-equiv=\"Content-Security-Policy\" \
        content=\"script-src 'unsafe-inline' https:; connect-src 'none'\">";
    assert!(
        preview_html(open, INTERACTIVE_CSP, &scripts)
            .contains("content=\"script-src 'unsafe-inline' https:; connect-src 'none'\"")
    );
    // Only clicks the person makes are reported.
    assert!(scripts.contains("if(!event.isTrusted"));
}

/// #20: the projection keeps the author's policy and base, and links
/// resolve against that base; the source itself is never changed.
#[test]
fn the_projection_keeps_the_authors_policy_and_base() {
    let source = "<meta http-equiv=\"Content-Security-Policy\" content=\"script-src 'none'; \
        connect-src 'none'\"><base href=\"https://example.test/docs/\"><a href=\"other.html\">Open</a>";
    let before = source.to_owned();
    let page = preview_html(source, INTERACTIVE_CSP, &link_script(None));
    assert!(page.contains("connect-src 'none'"));
    assert!(page.contains("<base href=\"https://example.test/docs/\" target=\"_self\">"));
    assert!(page.contains("connect-src https:"), "the host policy leads");
    assert_eq!(source, before);
    let base = base_href(source);
    assert_eq!(base.as_deref(), Some("https://example.test/docs/"));
    assert_eq!(
        navigation_href("other.html", base.as_deref()).as_deref(),
        Some("https://example.test/docs/other.html")
    );
}

/// What reached the host.
#[derive(Default)]
struct Host {
    external: Arc<Mutex<Vec<String>>>,
    opened: Rc<RefCell<Vec<Vec<String>>>>,
    failing: Arc<Mutex<bool>>,
    redraws: Rc<Cell<usize>>,
}

const PAGE: &str =
    "<!doctype html><html><head></head><body><a href=\"note.md\">n</a></body></html>";

fn page<'a>(
    cx: &'a mut TestAppContext,
    text: &str,
) -> (Interact, Host, tempfile::TempDir, &'a mut VisualTestContext) {
    cx.update(|cx| {
        if cx.try_global::<gpui_kit::component::Theme>().is_none() {
            gpui_kit::init(cx);
        }
    });
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().canonicalize().unwrap();
    std::fs::create_dir(root.join("pages")).unwrap();
    std::fs::write(root.join("pages/page.html"), text).unwrap();
    std::fs::write(root.join("pages/note.md"), "# Note\n").unwrap();
    let workspace = crate::workspace::Workspace::open(&root).unwrap();
    let (_, visual) = cx.add_window_view(|_, _| gpui::Empty);
    let host = Host::default();
    let text = text.to_owned();
    let (external, opened, failing, redraws) = (
        host.external.clone(),
        host.opened.clone(),
        host.failing.clone(),
        host.redraws.clone(),
    );
    let interact = visual.update(move |window: &mut Window, cx: &mut App| {
        let doc = EditorDocument::local("pages/page.html");
        let resolved = resolve(&doc);
        let request = SurfaceRequest {
            id: "html-links",
            name: "pages/page.html",
            input: SurfaceInput::Text(&text),
            format: resolved.format,
            resolved_extension: Some(".html"),
            dark: false,
            scale: Scale::default(),
            workspace: Some(workspace),
            file_mode: false,
            folder: Some(root.join("pages")),
            web_source: None,
            assets: None,
            references: Some(ReferenceContext {
                source: "pages/page.html".into(),
                index: Arc::new(ReferenceIndex::new(vec![Document {
                    path: "pages/note.md".into(),
                    name: "note.md".into(),
                }])),
            }),
            source_kind: SourceKind::Local,
            models: Default::default(),
        };
        let source: Rc<dyn ViewerSurface> =
            Rc::from(code::open_with(&request, None, false, window, cx));
        let interact = Interact::new(&request, source, Rc::new(Cell::new(0.)), window, cx);
        interact.set_events(Rc::new(move |event, _| match event {
            SurfaceEvent::OpenPaths(paths) => opened.borrow_mut().push(paths),
            SurfaceEvent::Redraw => redraws.set(redraws.get() + 1),
            _ => {}
        }));
        let route: ExternalRoute = Arc::new(move |href: &str| {
            external.lock().unwrap().push(href.to_owned());
            if *failing.lock().unwrap() {
                Err("OS failed".into())
            } else {
                Ok(())
            }
        });
        interact.set_external_route(Some(route));
        interact.refresh(cx);
        interact
    });
    visual.run_until_parked();
    (interact, host, dir, visual)
}

/// The page posts a clicked link, as its web view does.
fn click(interact: &Interact, cx: &mut VisualTestContext, href: &str) {
    let channel = interact.channel().expect("the page is shown");
    let body = serde_json::json!({ "type": "link", "href": href }).to_string();
    channel.try_send(body).unwrap();
    cx.run_until_parked();
}

fn notice(interact: &Interact) -> Option<String> {
    interact.notice.borrow().as_ref().map(|n| n.to_string())
}

fn failure(reason: &str) -> Option<String> {
    Some(t(&format!("editor.html.linkFailure.{reason}")).to_owned())
}

/// `HTML navigation capability` #21: a web address goes to the host's
/// external route, a workspace document to the workbench.
#[gpui::test]
fn links_use_the_hosts_external_and_workspace_routes(cx: &mut TestAppContext) {
    let (interact, host, _dir, cx) = page(cx, PAGE);
    click(&interact, cx, "https://example.test/docs");
    click(&interact, cx, "note.md");
    assert_eq!(
        *host.external.lock().unwrap(),
        ["https://example.test/docs"]
    );
    assert_eq!(*host.opened.borrow(), [vec!["pages/note.md".to_string()]]);
    assert_eq!(notice(&interact), None);
}

/// #22: only the shown page's own channel reaches the routes: a replaced
/// page's channel is closed, the page may load no frames, and its script
/// reports only clicks the person makes.
#[gpui::test]
fn only_the_current_pages_channel_reaches_the_routes(cx: &mut TestAppContext) {
    let (interact, host, _dir, cx) = page(cx, PAGE);
    let stale = interact.channel().unwrap();
    cx.update(|_, cx| interact.refresh(cx));
    cx.run_until_parked();
    let body = serde_json::json!({ "type": "link", "href": "https://example.test/" });
    let _ = stale.try_send(body.to_string());
    cx.run_until_parked();
    assert!(host.external.lock().unwrap().is_empty());
    assert_eq!(notice(&interact), None);
    assert!(INTERACTIVE_CSP.contains("frame-src 'none'"));
    assert!(link_script(None).contains("if(!event.isTrusted"));
}

/// #23–#26: unsafe addresses never reach the system.
#[gpui::test]
fn unsafe_addresses_never_reach_the_system(cx: &mut TestAppContext) {
    let (interact, host, _dir, cx) = page(cx, PAGE);
    for href in [
        "javascript:alert(1)",
        "file:///etc/passwd",
        "data:text/html,x",
        "https://user:password@example.test/",
    ] {
        *interact.notice.borrow_mut() = None;
        let before = host.redraws.get();
        click(&interact, cx, href);
        assert_eq!(notice(&interact), failure("unavailable"), "{href}");
        assert_eq!(host.redraws.get(), before + 1, "reported once: {href}");
    }
    assert!(host.external.lock().unwrap().is_empty());
    assert!(host.opened.borrow().is_empty());
}

/// #27: a missing file and a failed opening are reported.
#[gpui::test]
fn missing_files_and_failed_openings_are_reported(cx: &mut TestAppContext) {
    let (interact, host, _dir, cx) = page(cx, PAGE);
    click(&interact, cx, "missing.md");
    assert_eq!(notice(&interact), failure("missing"));
    *host.failing.lock().unwrap() = true;
    click(&interact, cx, "https://example.test/");
    assert_eq!(notice(&interact), failure("failed"));
    assert_eq!(*host.external.lock().unwrap(), ["https://example.test/"]);
}

/// #28: a page allowed its folder runs offline: links stay.
#[gpui::test]
fn a_folder_page_keeps_its_links_offline(cx: &mut TestAppContext) {
    let folder_page = "<!doctype html><html><body><a href=\"https://example.test/\">x</a>\
        <script>showDirectoryPicker()</script></body></html>";
    let (interact, host, _dir, cx) = page(cx, folder_page);
    cx.update(|_, cx| interact.set_allowed(true, cx));
    cx.run_until_parked();
    click(&interact, cx, "https://example.test/");
    assert!(host.external.lock().unwrap().is_empty());
    assert_eq!(notice(&interact), failure("offline"));
}

/// #29: a workspace that cannot answer reports a failure and opens
/// nothing.
#[gpui::test]
fn a_workspace_that_cannot_answer_reports_a_failure(cx: &mut TestAppContext) {
    let (interact, host, _dir, cx) = page(cx, PAGE);
    // Not in the index: the workspace itself is asked, and refuses.
    interact.workspace.as_ref().unwrap().revoke();
    click(&interact, cx, "elsewhere.md");
    assert_eq!(notice(&interact), failure("failed"));
    assert!(host.external.lock().unwrap().is_empty());
    assert!(host.opened.borrow().is_empty());
}

/// #30: a late failure for a replaced page is not shown on its
/// replacement.
#[gpui::test]
fn a_late_failure_does_not_reach_a_replacement_page(cx: &mut TestAppContext) {
    let (interact, host, _dir, cx) = page(cx, PAGE);
    *host.failing.lock().unwrap() = true;
    // The link is followed, then the page is replaced before the opening
    // answers.
    cx.update(|_, cx| {
        let link = serde_json::json!({ "type": "link", "href": "https://example.test/" });
        interact.receive(link, None, None, cx);
        interact.refresh(cx);
    });
    cx.run_until_parked();
    assert_eq!(*host.external.lock().unwrap(), ["https://example.test/"]);
    assert_eq!(notice(&interact), None);
}
