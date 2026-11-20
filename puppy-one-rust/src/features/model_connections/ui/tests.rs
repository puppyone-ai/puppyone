//! GPUI tests of the Model Connections page state machine.
use super::*;

use core::prelude::v1::test;
use gpui::{TestAppContext, VisualTestContext};

/// The page with no connections read and nothing pending.
fn page(cx: &mut TestAppContext) -> (Entity<ModelConnections>, &mut VisualTestContext) {
    cx.update(gpui_kit::init);
    let (view, cx) = cx.add_window_view(|window, cx| {
        ModelConnections::with_loader(window, cx, |_| std::sync::mpsc::sync_channel(1).1)
    });
    view.update(cx, |s, _| {
        s.busy = false;
        s.loaded = true;
    });
    (view, cx)
}

/// `modelConnectionsSettings.test.tsx`: "starts an API connection with
/// URL and write-only Key" and the local service defaults.
#[gpui::test]
fn a_new_connection_starts_from_its_category_and_service(cx: &mut TestAppContext) {
    let (view, cx) = page(cx);
    view.update(cx, |s, cx| {
        s.navigate(PageState::Add(SourceKind::Api, None, None), cx);
        assert_eq!(
            (s.form.driver, s.form.auth),
            (Driver::OpenaiCompatible, Auth::Bearer)
        );
        assert_eq!(s.endpoint.read(cx).text(), "");
        assert!(!s.form.advanced && !s.form.key_storage);
        s.navigate(PageState::Add(SourceKind::Local, None, None), cx);
        assert_eq!((s.form.driver, s.form.auth), (Driver::Ollama, Auth::None));
        assert_eq!(s.endpoint.read(cx).text(), "http://127.0.0.1:11434/v1");
        assert_eq!(s.context.read(cx).text(), "32768");
        s.key.update(cx, |i, cx| i.set_text("typed-key", cx));
        s.select_driver(Driver::Unsloth, cx);
        assert_eq!(s.form.auth, Auth::Bearer);
        assert_eq!(
            (s.name.read(cx).text(), s.endpoint.read(cx).text()),
            ("Unsloth", "http://127.0.0.1:8000/v1")
        );
        assert_eq!(s.key.read(cx).text(), "");
        s.form.advanced = true;
        s.form.key_storage = true;
    });
    cx.run_until_parked();
    let candidate = client::Candidate {
        driver: Driver::LmStudio,
        name: "LM Studio".into(),
        endpoint: "http://127.0.0.1:1234/v1".into(),
    };
    view.update(cx, |s, cx| {
        s.navigate(PageState::Add(SourceKind::Local, Some(candidate), None), cx);
        assert_eq!((s.form.driver, s.form.auth), (Driver::LmStudio, Auth::None));
        assert_eq!(s.name.read(cx).text(), "LM Studio");
    });
}

/// "preserves the saved Key on edit": the key field starts empty, and a
/// new endpoint or authentication asks for the key again.
#[gpui::test]
fn an_edit_keeps_the_saved_key_until_its_endpoint_changes(cx: &mut TestAppContext) {
    let (view, cx) = page(cx);
    let id = uuid::Uuid::new_v4().to_string();
    view.update(cx, |s, cx| {
        s.items = vec![ModelConnection {
            id: id.clone(),
            name: "Work API".into(),
            endpoint: "https://example.test/v1".into(),
            auth: Auth::Bearer,
            credential_id: Some("stored".into()),
            generation: "g1".into(),
            manual_context_window: Some(8192),
            ..Default::default()
        }];
        s.navigate(PageState::Edit(id.clone()), cx);
        assert_eq!(s.key.read(cx).text(), "");
        assert_eq!(s.context.read(cx).text(), "8192");
        assert!(!s.key_required(cx));
        s.endpoint
            .update(cx, |i, cx| i.set_text("https://other.test/v1", cx));
        assert!(s.key_required(cx));
        s.endpoint
            .update(cx, |i, cx| i.set_text("https://example.test/v1", cx));
        s.form.auth = Auth::None;
        assert!(s.key_required(cx));
    });
    cx.run_until_parked();
}

/// A preset fills the form; the user only pastes the key.
#[gpui::test]
fn a_provider_preset_fills_its_address_protocol_and_budget(cx: &mut TestAppContext) {
    let (view, cx) = page(cx);
    view.update(cx, |s, cx| {
        s.navigate(PageState::ChooseProvider, cx);
        s.navigate(PageState::Add(SourceKind::Api, None, Some("anthropic")), cx);
        assert_eq!(
            (s.form.driver, s.form.auth),
            (Driver::Anthropic, Auth::Bearer)
        );
        assert_eq!(s.form.provider, Some("anthropic"));
        assert_eq!(s.endpoint.read(cx).text(), "https://api.anthropic.com");
        assert_eq!(s.name.read(cx).text(), "Anthropic");
        assert_eq!(s.context.read(cx).text(), "200000");
        assert_eq!(s.title(), "Anthropic");
        s.navigate(PageState::Add(SourceKind::Api, None, Some("custom")), cx);
        assert_eq!(s.endpoint.read(cx).text(), "");
        assert_eq!(s.form.driver, Driver::OpenaiCompatible);
        s.navigate(PageState::Add(SourceKind::Api, None, Some("deepseek")), cx);
        assert_eq!(s.endpoint.read(cx).text(), "https://api.deepseek.com/v1");
    });
    cx.run_until_parked();
}

/// One saved sign-in per provider is found; signing in again is offered
/// from it rather than a second connection.
#[gpui::test]
fn sign_ins_are_found_by_provider(cx: &mut TestAppContext) {
    let (view, cx) = page(cx);
    view.update(cx, |s, _| {
        s.items = vec![ModelConnection {
            id: uuid::Uuid::new_v4().to_string(),
            name: "ChatGPT".into(),
            endpoint: "https://chatgpt.com/backend-api".into(),
            driver: Driver::Chatgpt,
            auth: Auth::Oauth,
            oauth_provider: Some(OauthProvider::Chatgpt),
            credential_id: Some("item".into()),
            ..Default::default()
        }];
        assert!(s.signed_in(OauthProvider::Chatgpt).is_some());
        assert!(s.signed_in(OauthProvider::Xai).is_none());
    });
    cx.run_until_parked();
}

/// A finished discovery shows services; a started service moves from
/// stopped to found.
#[gpui::test]
fn discovery_results_replace_stopped_services_once_started(cx: &mut TestAppContext) {
    let (view, cx) = page(cx);
    view.update(cx, |s, cx| {
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        s.discover_rx = None;
        s.discovery = client::Discovery {
            candidates: vec![],
            stopped: vec![client::Installed {
                driver: Driver::Ollama,
                name: "Ollama",
            }],
        };
        tx.send(client::Discovery {
            candidates: vec![Candidate {
                driver: Driver::Ollama,
                name: "Ollama".into(),
                endpoint: "http://127.0.0.1:11434/v1".into(),
            }],
            stopped: vec![],
        })
        .unwrap();
        s.starting = Some((Driver::Ollama, rx));
        s.receive(cx);
        assert!(s.starting.is_none());
        assert_eq!(s.discovery.candidates.len(), 1);
        assert!(s.discovery.stopped.is_empty());
    });
    cx.run_until_parked();
}

/// Codes the user can act on read as sentences.
#[test]
fn known_errors_read_as_sentences() {
    for code in [
        "OAUTH_DENIED",
        "OAUTH_REAUTH_REQUIRED",
        "NO_USABLE_MODEL",
        "START_FAILED",
    ] {
        assert!(!ModelConnections::error_text(code).contains(code), "{code}");
    }
    assert!(ModelConnections::error_text("HTTP_500").contains("HTTP_500"));
}

/// An error appears next to the action that failed; navigating clears it.
#[gpui::test]
fn errors_stay_next_to_the_failed_action(cx: &mut TestAppContext) {
    let (view, cx) = page(cx);
    view.update(cx, |s, cx| {
        // `Connect` failed (the worker is not run here).
        s.error_at = ErrorAt::Local;
        s.connecting = Some("http://127.0.0.1:11434/v1".into());
        s.apply(Err("NO_USABLE_MODEL".into()), cx);
        assert!(s.connecting.is_none());
        assert!(s.inline_error(ErrorAt::Local, cx.palette()).is_some());
        assert!(s.inline_error(ErrorAt::Accounts, cx.palette()).is_none());
        s.navigate(PageState::ChooseProvider, cx);
        assert!(s.error.is_none());
        // Reopening the page returns to the list; a form keeps its input.
        // (Pending receivers keep `shown` from probing the network.)
        s.discover_rx = Some(std::sync::mpsc::sync_channel(1).1);
        s.managed_rx = Some(std::sync::mpsc::sync_channel(1).1);
        s.shown(cx);
        assert!(s.page == PageState::List);
        s.navigate(PageState::Add(SourceKind::Api, None, Some("openai")), cx);
        s.shown(cx);
        assert!(matches!(s.page, PageState::Add(..)));
    });
    cx.run_until_parked();
}
