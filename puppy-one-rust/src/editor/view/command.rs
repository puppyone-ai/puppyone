//! Commands from block widgets and line hotspots back to the document format
//! (CodeMirror widgets dispatching through `view.dispatch`): a feature id and
//! a typed payload the feature owns. The view never interprets them; the
//! format's `EditorExtension::command` turns one into a transaction.
use std::{
    any::Any,
    fmt,
    hash::{DefaultHasher, Hash, Hasher},
    rc::Rc,
};

#[derive(Clone)]
pub struct Command {
    feature: &'static str,
    /// Payload identity (decorations compare and hash by it).
    key: u64,
    payload: Rc<dyn Any>,
}

impl Command {
    pub fn new<T: Any + Hash>(feature: &'static str, payload: T) -> Self {
        let mut h = DefaultHasher::new();
        (feature, &payload).hash(&mut h);
        Self { feature, key: h.finish(), payload: Rc::new(payload) }
    }

    pub fn feature(&self) -> &'static str {
        self.feature
    }

    /// The payload, if it is a `T`.
    pub fn payload<T: Any>(&self) -> Option<&T> {
        self.payload.downcast_ref()
    }
}

impl PartialEq for Command {
    fn eq(&self, other: &Self) -> bool {
        self.feature == other.feature && self.key == other.key
    }
}

impl fmt::Debug for Command {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Command({}, {:x})", self.feature, self.key)
    }
}

#[cfg(test)]
mod tests {
    use super::Command;

    #[test]
    fn commands_carry_typed_payloads_and_compare_by_value() {
        let a = Command::new("task", 3usize);
        assert_eq!(a.payload::<usize>(), Some(&3));
        assert_eq!(a.payload::<u32>(), None);
        assert_eq!(a, Command::new("task", 3usize));
        assert_ne!(a, Command::new("task", 4usize));
        assert_ne!(a, Command::new("table", 3usize));
    }
}
