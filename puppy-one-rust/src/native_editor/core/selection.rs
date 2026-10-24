//! A single anchor/caret pair shared across every document feature.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Selection {
    pub anchor: usize,
    pub cursor: usize,
}
