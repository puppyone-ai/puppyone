//! One bounded change stream per admitted provider, shared by document and tree
//! subscriptions. No file polling, cursor journal, wake POST or mutation replay.
use super::{
    client::{Shared, map_error},
    model,
};
use crate::{
    cloud::auth::{self as auth, Cancellation, StreamEvent},
    workspace::{contracts::*, ports::*},
};
use reqwest::Method;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex, Weak},
    time::{Duration, Instant},
};
use uuid::Uuid;

#[derive(Clone)]
struct Sink {
    path: Option<RelativePath>,
    slot: Weak<Mutex<Option<WatchEvent>>>,
    notify: Notify,
}
struct State {
    sinks: HashMap<Uuid, Sink>,
    active: Option<(Uuid, Cancellation)>,
}
pub(super) struct Hub {
    shared: Arc<Shared>,
    state: Mutex<State>,
}
impl Hub {
    pub fn new(shared: Arc<Shared>) -> Arc<Self> {
        Arc::new(Self {
            shared,
            state: Mutex::new(State {
                sinks: HashMap::new(),
                active: None,
            }),
        })
    }
    pub fn subscribe(
        self: &Arc<Self>,
        path: Option<RelativePath>,
        notify: Notify,
    ) -> Result<WatchSubscription> {
        self.shared.check()?;
        // Revalidate after registration even when another subscriber already
        // owns the stream: an event may have occurred between read and watch.
        let events = Arc::new(Mutex::new(Some(WatchEvent::Invalidated)));
        let id = Uuid::new_v4();
        let start = {
            let mut state = self.state.lock().unwrap();
            self.shared.check()?;
            if state.sinks.len() >= 128 {
                return Err(Error::new(
                    ErrorKind::Io,
                    "Cloud subscription limit reached",
                ));
            }
            state.sinks.insert(
                id,
                Sink {
                    path,
                    slot: Arc::downgrade(&events),
                    notify: notify.clone(),
                },
            );
            self.shared.retain_listings();
            if state.active.is_none() {
                let run = Uuid::new_v4();
                let cancel = self.shared.cancel.child();
                state.active = Some((run, cancel.clone()));
                Some((run, cancel))
            } else {
                None
            }
        };
        notify();
        if let Some((run, stop)) = start {
            let hub = Arc::downgrade(self);
            let shared = self.shared.clone();
            std::thread::spawn(move || run_stream(hub, shared, run, stop));
        }
        let hub = self.clone();
        Ok(WatchSubscription {
            events,
            cancel: WatchCancellation::new(move || {
                let mut state = hub.state.lock().unwrap();
                if state.sinks.remove(&id).is_some() {
                    hub.shared.release_listings();
                }
                if state.sinks.is_empty()
                    && let Some((_, cancel)) = state.active.take()
                {
                    cancel.cancel();
                }
            }),
        })
    }
    fn publish(&self, run: Uuid, event: WatchEvent) {
        let sinks = {
            let state = self.state.lock().unwrap();
            if !state.active.as_ref().is_some_and(|(id, _)| *id == run) {
                return;
            }
            match &event {
                WatchEvent::Changed(paths) => self.shared.invalidate_paths(paths, true),
                WatchEvent::Invalidated | WatchEvent::Failed(_) => self.shared.invalidate(),
            }
            state.sinks.values().cloned().collect::<Vec<_>>()
        };
        deliver(sinks, event);
    }
    fn finish(&self, run: Uuid, error: Error) {
        let sinks = {
            let mut state = self.state.lock().unwrap();
            if !state.active.as_ref().is_some_and(|(id, _)| *id == run) {
                return;
            }
            state.active = None;
            self.shared.retire();
            state.sinks.values().cloned().collect::<Vec<_>>()
        };
        deliver(sinks, WatchEvent::Failed(error));
    }
}
fn deliver(sinks: Vec<Sink>, event: WatchEvent) {
    for sink in sinks {
        if let (Some(path), WatchEvent::Changed(paths)) = (&sink.path, &event)
            && !paths
                .iter()
                .any(|changed| path.as_path().starts_with(changed.as_path()))
        {
            continue;
        }
        if let Some(slot) = sink.slot.upgrade() {
            let mut slot = slot.lock().unwrap();
            let pending = slot.take();
            let wake = pending.is_none();
            *slot = Some(pending.map_or_else(|| event.clone(), |p| p.coalesce(event.clone())));
            drop(slot);
            if wake {
                (sink.notify)();
            }
        }
    }
}
/// `cloud-workspace:watch`: identifiers a subscription may carry.
fn subscribable(value: &str) -> bool {
    (1..=100).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
}
fn run_stream(hub: Weak<Hub>, shared: Arc<Shared>, run: Uuid, stop: Cancellation) {
    if !subscribable(&shared.runtime.project_id) || !subscribable(&shared.runtime.generation) {
        if let Some(hub) = hub.upgrade() {
            hub.finish(
                run,
                Error::new(ErrorKind::InvalidInput, "Invalid Cloud file subscription."),
            );
        }
        return;
    }
    let request = shared
        .endpoint("/events", None, Method::GET, None)
        .expect("fixed endpoint");
    let mut attempts = 0;
    let error = loop {
        if stop.check().is_err() || shared.check().is_err() {
            break model::stale();
        }
        let mut parser = Parser::default();
        let result = shared
            .broker
            .stream(&shared.binding, &request, &stop, &mut |event| {
                shared.check().map_err(|_| auth::Error::SessionChanged)?;
                match event {
                    StreamEvent::Connected => {
                        parser = Parser::default();
                        if let Some(hub) = hub.upgrade() {
                            hub.publish(run, WatchEvent::Invalidated);
                        }
                    }
                    StreamEvent::Data(bytes) => {
                        parser.feed(bytes, &shared.runtime.generation, &mut |paths| {
                            if let Some(hub) = hub.upgrade() {
                                hub.publish(
                                    run,
                                    paths.map_or(WatchEvent::Invalidated, WatchEvent::Changed),
                                );
                            }
                        })?
                    }
                }
                Ok(())
            });
        let failure = result.err().unwrap_or(auth::Error::Unavailable);
        if stop.check().is_err() || shared.check().is_err() {
            break model::stale();
        }
        let delay = [250, 1000, 3000].get(attempts).copied();
        // Transport loss, server errors and 429 reconnect; any other 4xx is
        // a decision (`status >= 400 && status < 500 && status !== 429`).
        let transient = matches!(failure, auth::Error::Unavailable | auth::Error::Timeout)
            || matches!(failure, auth::Error::Response(status, _, _) | auth::Error::Http(status) if status >= 500 || status == 429);
        if !transient || delay.is_none() {
            break map_error(failure);
        }
        // `reconnecting`: what was read may have missed a change, so the
        // caches go; watchers hear nothing until the stream is back
        // (`Connected` revalidates them) or gives up (`finish`).
        shared.invalidate();
        attempts += 1;
        let until = Instant::now() + Duration::from_millis(delay.unwrap());
        while Instant::now() < until && stop.check().is_ok() {
            std::thread::sleep(Duration::from_millis(10));
        }
    };
    if let Some(hub) = hub.upgrade() {
        hub.finish(run, error);
    }
}

#[derive(Default)]
pub(super) struct Parser {
    line: Vec<u8>,
    size: usize,
    kind: String,
    data: String,
    cr: bool,
}
/// `workspaceEventPaths`: malformed hints have unknown scope, never a partial
/// list which could conceal a changed document. Length is JavaScript UTF-16.
fn event_paths(value: &serde_json::Value) -> Option<Vec<RelativePath>> {
    let items = value.as_array()?;
    if items.is_empty() || items.len() > 256 {
        return None;
    }
    let mut paths = Vec::new();
    for item in items {
        let text = item.as_str()?;
        if text.encode_utf16().count() > 4096
            || text.contains(['\\', '\0'])
            || text
                .split('/')
                .any(|s| s.is_empty() || s == "." || s == "..")
        {
            return None;
        }
        let path = RelativePath::new(std::path::Path::new(text)).ok()?;
        if !paths.contains(&path) {
            paths.push(path);
        }
    }
    Some(paths)
}
impl Parser {
    pub fn feed(
        &mut self,
        bytes: &[u8],
        generation: &str,
        reset: &mut dyn FnMut(Option<Vec<RelativePath>>),
    ) -> auth::model::Result<()> {
        for byte in bytes {
            if self.cr {
                self.cr = false;
                if *byte == b'\n' {
                    continue;
                }
            }
            if *byte == b'\r' || *byte == b'\n' {
                self.cr = *byte == b'\r';
                self.line(generation, reset)?;
            } else {
                self.size += 1;
                if self.size > 32768 {
                    return Err(auth::Error::InvalidResponse);
                }
                self.line.push(*byte);
            }
        }
        Ok(())
    }
    fn line(
        &mut self,
        generation: &str,
        reset: &mut dyn FnMut(Option<Vec<RelativePath>>),
    ) -> auth::model::Result<()> {
        let bytes = std::mem::take(&mut self.line);
        let line = std::str::from_utf8(&bytes).map_err(|_| auth::Error::InvalidResponse)?;
        if line.is_empty() {
            if matches!(self.kind.as_str(), "change" | "unavailable") {
                let value: serde_json::Value = if self.data.is_empty() {
                    serde_json::json!({})
                } else {
                    serde_json::from_str(&self.data).map_err(|_| auth::Error::InvalidResponse)?
                };
                if self.kind == "unavailable" {
                    return Err(if value["retryable"] == true {
                        auth::Error::Unavailable
                    } else {
                        auth::Error::Http(409)
                    });
                }
                let paths = event_paths(&value["paths"]);
                if value["reset"] != true && paths.is_none() {
                    return Err(auth::Error::InvalidResponse);
                }
                if value["generation"].as_str() != Some(generation) {
                    return Err(auth::Error::Service(
                        409,
                        auth::ServiceCode::GenerationChanged,
                    ));
                }
                reset(paths);
            }
            self.size = 0;
            self.data.clear();
            self.kind.clear();
        } else {
            // Count line framing too, so millions of empty data lines cannot grow memory.
            self.size += 1;
            if self.size > 32768 {
                return Err(auth::Error::InvalidResponse);
            }
            if let Some(value) = line.strip_prefix("event:") {
                self.kind = value.trim().into();
            } else if let Some(value) = line.strip_prefix("data:") {
                self.data.push_str(value.strip_prefix(' ').unwrap_or(value));
                self.data.push('\n');
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        path::Path,
        sync::atomic::{AtomicUsize, Ordering},
    };
    fn path(value: &str) -> RelativePath {
        RelativePath::new(Path::new(value)).unwrap()
    }
    fn paths(values: &[&str]) -> WatchEvent {
        WatchEvent::Changed(values.iter().map(|p| path(p)).collect())
    }

    #[test]
    fn actual_typescript_event_parser_oracle_including_fragmented_unicode() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../../fixtures/test-parity-oracle.json"))
                .unwrap();
        for (index, case) in fixture["eventCases"].as_array().unwrap().iter().enumerate() {
            let frame = case["frame"].as_str().unwrap();
            for chunk in [1, 3, 17, frame.len()] {
                let mut parser = Parser::default();
                let mut events = Vec::new();
                let mut valid = true;
                for bytes in frame.as_bytes().chunks(chunk) {
                    if parser
                        .feed(bytes, "one", &mut |paths| {
                            events.push(paths.map(|paths| {
                                paths
                                    .iter()
                                    .map(|p| p.as_path().to_str().unwrap().to_owned())
                                    .collect::<Vec<_>>()
                            }));
                        })
                        .is_err()
                    {
                        valid = false;
                        break;
                    }
                }
                assert_eq!(
                    valid,
                    case["valid"].as_bool().unwrap(),
                    "TS case {index}, chunk {chunk}"
                );
                assert_eq!(
                    serde_json::json!(events),
                    case["events"],
                    "TS case {index}, chunk {chunk}"
                );
            }
        }
    }

    /// `cloudWorkspaceEvents.test.mjs`: "decodes split UTF-8 frames and
    /// heartbeats without requiring Agent cursors", with its chunks verbatim.
    #[test]
    fn heartbeats_and_split_frames_decode_without_event_ids() {
        let mut parser = Parser::default();
        let mut events = Vec::new();
        for chunk in [
            ": keepalive\r\n\r\nevent: cha",
            "nge\ndata: {\"generation\":\"one\",\"reset\":true}\n\n",
        ] {
            parser
                .feed(chunk.as_bytes(), "one", &mut |p| events.push(p))
                .unwrap();
        }
        assert_eq!(events, vec![None]);
        // An `unavailable` the server does not call retryable is a decision
        // that ends the subscription, not an interruption to reconnect from.
        assert_eq!(
            parser.feed(
                b": keepalive\n\nevent: unavailable\ndata: {}\n\n",
                "one",
                &mut |p| events.push(p)
            ),
            Err(auth::Error::Http(409))
        );
        assert_eq!(events, vec![None]);
    }

    #[test]
    fn scoped_changes_accept_legacy_and_current_wire_shapes_and_deduplicate_paths() {
        for legacy in [true, false] {
            let data = serde_json::json!({"generation":"one","reset":legacy,"paths":["docs/你好.md","b.md","docs/你好.md"]});
            let frame = format!("event: change\r\ndata: {data}\r\n\r\n");
            let mut events = Vec::new();
            let mut parser = Parser::default();
            for byte in frame.bytes() {
                parser
                    .feed(&[byte], "one", &mut |p| events.push(p))
                    .unwrap();
            }
            assert_eq!(events, vec![Some(vec![path("docs/你好.md"), path("b.md")])]);
        }
    }

    #[test]
    fn invalid_path_hints_reset_everything_only_with_the_legacy_reset_flag() {
        use serde_json::json;
        for hints in [
            json!([]),
            json!(["docs/a.md", ""]),
            json!(["docs/../secret"]),
            json!(["./a.md"]),
            json!(["/etc/passwd"]),
            json!(["docs//a.md"]),
            json!(["docs\\a.md"]),
            json!(["a\0.md"]),
            json!([42]),
            json!(["a".repeat(4097)]),
            json!(["😀".repeat(2049)]),
            json!((0..257).map(|i| format!("{i}.md")).collect::<Vec<_>>()),
            json!(null),
        ] {
            for legacy in [true, false] {
                let frame = format!(
                    "event: change\ndata: {}\n\n",
                    json!({"generation":"one","reset":legacy,"paths":hints})
                );
                let mut events = Vec::new();
                let result =
                    Parser::default().feed(frame.as_bytes(), "one", &mut |p| events.push(p));
                assert_eq!(result.is_ok(), legacy, "{hints}");
                assert_eq!(events, if legacy { vec![None] } else { vec![] });
            }
        }
    }

    #[test]
    fn only_matching_documents_wake_and_coalescing_never_loses_an_unknown_scope() {
        let count = Arc::new(AtomicUsize::new(0));
        let slot = Arc::new(Mutex::new(None));
        let wake = count.clone();
        let sink = Sink {
            path: Some(path("docs/a.md")),
            slot: Arc::downgrade(&slot),
            notify: Arc::new(move || {
                wake.fetch_add(1, Ordering::SeqCst);
            }),
        };
        deliver(vec![sink.clone()], paths(&["other/a.md"]));
        assert!(slot.lock().unwrap().is_none());
        deliver(vec![sink.clone()], paths(&["docs"]));
        deliver(vec![sink.clone()], paths(&["docs/a.md"]));
        assert_eq!(count.load(Ordering::SeqCst), 1);
        assert!(matches!(&*slot.lock().unwrap(), Some(WatchEvent::Changed(p)) if p.len()==2));
        deliver(vec![sink.clone()], WatchEvent::Invalidated);
        deliver(vec![sink], paths(&["docs/a.md"]));
        assert!(matches!(
            &*slot.lock().unwrap(),
            Some(WatchEvent::Invalidated)
        ));
    }

    #[test]
    fn too_many_coalesced_paths_fall_back_to_a_full_revalidation() {
        let many = WatchEvent::Changed((0..256).map(|i| path(&format!("{i}.md"))).collect());
        assert!(matches!(
            many.coalesce(paths(&["last.md"])),
            WatchEvent::Invalidated
        ));
    }
}
