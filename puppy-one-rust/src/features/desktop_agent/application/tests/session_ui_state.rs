//! `tests/unit/agent/sessions/desktop-agent.session-ui-state.test.ts`.
use crate::features::desktop_agent::application::session_ui_state_store::{
    SessionUiPatch, SessionUiStateStore,
};
use crate::features::desktop_agent::domain::agent_ui_state::{
    AgentTimelineScrollAnchor, AgentViewportGeometry,
};

fn draft(text: &str) -> SessionUiPatch {
    SessionUiPatch {
        draft: Some(text.into()),
        ..Default::default()
    }
}

#[test]
fn bounds_reconstructible_caches_without_evicting_unsent_drafts() {
    let mut store = SessionUiStateStore::new(2, 10).expect("store");
    store.patch("old", draft("old"));
    store.patch(
        "kept",
        SessionUiPatch {
            draft: Some("kept".into()),
            measurements: Some(vec![("row".into(), 100.)]),
            ..Default::default()
        },
    );
    store.read("old");
    store.patch("new", draft("new"));
    assert_eq!(store.read("old").draft, "old");
    assert_eq!(store.read("kept").draft, "kept");
    assert!(store.read("kept").measurements.is_empty());
    assert_eq!(store.read("new").draft, "new");
    store.delete("kept");
    assert_eq!(store.read("kept").draft, "");
}

#[test]
fn retains_only_the_newest_bounded_measurements_and_returns_copies() {
    let mut store = SessionUiStateStore::new(2, 2).expect("store");
    store.patch(
        "session",
        SessionUiPatch {
            measurements: Some(vec![
                ("first".into(), 1.),
                ("second".into(), 2.),
                ("third".into(), 3.),
            ]),
            ..Default::default()
        },
    );
    let mut snapshot = store.read("session");
    assert_eq!(
        snapshot.measurements,
        vec![("second".to_string(), 2.), ("third".to_string(), 3.)]
    );
    snapshot.measurements[1].1 = 99.;
    assert_eq!(store.read("session").measurements[1].1, 3.);
}

#[test]
fn keeps_geometry_provenance_and_reading_anchors_as_renderer_memory() {
    let mut store = SessionUiStateStore::default();
    let mut geometry = AgentViewportGeometry {
        layout_signature: "420|font-a|14|20".into(),
        anchor: Some(AgentTimelineScrollAnchor::Row {
            row_id: "one".into(),
            offset: 12.,
        }),
    };
    store.patch(
        "session",
        SessionUiPatch {
            measurements: Some(vec![("one".into(), 40.)]),
            geometry: Some(geometry.clone()),
            ..Default::default()
        },
    );
    geometry.anchor = Some(AgentTimelineScrollAnchor::Row {
        row_id: "one".into(),
        offset: 99.,
    });
    let mut restored = store.read("session");
    assert_eq!(
        restored.geometry.as_ref().and_then(|g| g.anchor.clone()),
        Some(AgentTimelineScrollAnchor::Row {
            row_id: "one".into(),
            offset: 12.
        })
    );
    if let Some(geometry) = restored.geometry.as_mut() {
        geometry.layout_signature = "different".into();
    }
    assert_eq!(
        store.read("session").geometry.map(|g| g.layout_signature),
        Some("420|font-a|14|20".into())
    );
}

#[test]
fn rejects_invalid_cache_limits() {
    let error = SessionUiStateStore::new(0, 10).err().expect("invalid");
    assert!(error.to_lowercase().contains("positive integer"));
    let error = SessionUiStateStore::new(1, 0).err().expect("invalid");
    assert!(error.to_lowercase().contains("positive integer"));
}
