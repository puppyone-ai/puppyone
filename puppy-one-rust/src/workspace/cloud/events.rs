//! One bounded reset stream per admitted provider, shared by document and tree
//! subscriptions. No file polling, cursor journal, wake POST or mutation replay.
use super::{
    client::{Shared, map_error},
    model,
};
use crate::{
    cloud_auth::{self as auth, Cancellation, StreamEvent},
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
    pub fn subscribe(self: &Arc<Self>, notify: Notify) -> Result<WatchSubscription> {
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
                    slot: Arc::downgrade(&events),
                    notify: notify.clone(),
                },
            );
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
                state.sinks.remove(&id);
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
            if matches!(event, WatchEvent::Invalidated) {
                self.shared.invalidate();
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
        if let Some(slot) = sink.slot.upgrade() {
            let wake = slot.lock().unwrap().replace(event.clone()).is_none();
            if wake {
                (sink.notify)();
            }
        }
    }
}
fn run_stream(hub: Weak<Hub>, shared: Arc<Shared>, run: Uuid, stop: Cancellation) {
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
                        parser.feed(bytes, &shared.runtime.generation, &mut || {
                            if let Some(hub) = hub.upgrade() {
                                hub.publish(run, WatchEvent::Invalidated);
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
        if failure != auth::Error::Unavailable || delay.is_none() {
            break map_error(failure);
        }
        if let Some(hub) = hub.upgrade() {
            hub.publish(run, WatchEvent::Failed(map_error(failure)));
        }
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
impl Parser {
    pub fn feed(
        &mut self,
        bytes: &[u8],
        generation: &str,
        reset: &mut dyn FnMut(),
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
    fn line(&mut self, generation: &str, reset: &mut dyn FnMut()) -> auth::model::Result<()> {
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
                if value["reset"] != true {
                    return Err(auth::Error::InvalidResponse);
                }
                if value["generation"].as_str() != Some(generation) {
                    return Err(auth::Error::Service(
                        409,
                        auth::ServiceCode::GenerationChanged,
                    ));
                }
                reset();
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
