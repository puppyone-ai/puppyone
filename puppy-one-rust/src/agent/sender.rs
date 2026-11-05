//! The window a request came from (Electron's `event.sender`, a
//! `WebContents`): its id owns sessions, frames are sent to it, and its
//! destruction releases what it owned.
use serde_json::Value;
use std::cell::{Cell, RefCell};
use std::rc::Rc;

/// Delivers one `agent:session-frame` to the window.
pub type FrameSink = Rc<dyn Fn(&str, Value)>;

type Listeners = RefCell<Vec<(u64, Rc<dyn Fn()>)>>;

struct SenderState {
    id: u64,
    sink: FrameSink,
    destroyed: Cell<bool>,
    listeners: Listeners,
    next: Cell<u64>,
}

#[derive(Clone)]
pub struct Sender(Rc<SenderState>);

impl Sender {
    pub fn new(id: u64, sink: FrameSink) -> Self {
        Self(Rc::new(SenderState {
            id,
            sink,
            destroyed: Cell::new(false),
            listeners: RefCell::default(),
            next: Cell::new(0),
        }))
    }

    /// `sender.id`.
    pub fn id(&self) -> u64 {
        self.0.id
    }

    /// `sender.isDestroyed()`.
    pub fn is_destroyed(&self) -> bool {
        self.0.destroyed.get()
    }

    /// `sender.send(channel, payload)`.
    pub fn send(&self, channel: &str, payload: Value) {
        if !self.is_destroyed() {
            (self.0.sink)(channel, payload);
        }
    }

    /// `sender.once("destroyed", listener)`.
    pub fn once_destroyed(&self, listener: impl Fn() + 'static) -> u64 {
        let id = self.0.next.get() + 1;
        self.0.next.set(id);
        self.0.listeners.borrow_mut().push((id, Rc::new(listener)));
        id
    }

    /// `sender.removeListener("destroyed", listener)`.
    pub fn remove_destroyed_listener(&self, id: u64) {
        self.0
            .listeners
            .borrow_mut()
            .retain(|(listener, _)| *listener != id);
    }

    /// The window closed.
    pub fn destroy(&self) {
        if self.0.destroyed.replace(true) {
            return;
        }
        let listeners: Vec<Rc<dyn Fn()>> = self
            .0
            .listeners
            .borrow_mut()
            .drain(..)
            .map(|(_, l)| l)
            .collect();
        for listener in listeners {
            listener();
        }
    }
}
