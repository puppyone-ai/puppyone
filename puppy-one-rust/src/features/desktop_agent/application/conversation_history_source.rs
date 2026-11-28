//! `useAgentConversationHistory`'s source: where a History browser's
//! conversations come from. The project's Agent service history is one;
//! a hosted target's locators (the Cloud Agent's) are another.
use super::conversation_history_controller::{
    ConversationHistoryController, ConversationHistoryState,
};
use crate::wake::Wake;
use std::rc::Rc;

pub trait ConversationHistorySource {
    fn snapshot(&self) -> ConversationHistoryState;
    /// Discovery has the user's permission (`active`).
    fn activate(&self);
    fn refresh(&self);
    /// The next page, where the source pages.
    fn load_more(&self) {}
    /// Rings `wake` after every change until the returned cleanup runs.
    fn watch(&self, wake: Wake) -> Box<dyn FnOnce()>;
}

impl ConversationHistorySource for ConversationHistoryController {
    fn snapshot(&self) -> ConversationHistoryState {
        self.get_snapshot()
    }
    fn activate(&self) {
        ConversationHistoryController::activate(self)
    }
    fn refresh(&self) {
        drop(ConversationHistoryController::refresh(self))
    }
    fn load_more(&self) {
        drop(ConversationHistoryController::load_more(self))
    }
    fn watch(&self, wake: Wake) -> Box<dyn FnOnce()> {
        Box::new(self.subscribe(Rc::new(move || wake.notify())))
    }
}
