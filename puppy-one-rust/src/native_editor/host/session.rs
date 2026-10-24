//! One editing session per document. No GPUI, filesystem or platform ownership.
use crate::native_editor::core::{
    document::Document, history::History, selection::Selection, transaction::State,
};
pub struct Session {
    pub id: String,
    pub baseline: String,
    pub revision: u64,
    pub markdown: bool,
    pub state: State,
    pub frozen: bool,
    pub pending_ime: Option<State>,
    history: History,
}
impl Session {
    pub fn open(id: String, name: &str, text: &str, baseline: String, revision: u64) -> Self {
        let markdown = name.rsplit('.').next().is_some_and(|ext| {
            ["md", "mdx", "markdown"]
                .iter()
                .any(|s| ext.eq_ignore_ascii_case(s))
        });
        Self {
            id,
            baseline,
            revision,
            markdown,
            state: State {
                document: Document::parse(text, markdown),
                selection: Selection::default(),
                source_mode: !markdown,
            },
            frozen: false,
            pending_ime: None,
            history: History::default(),
        }
    }
    pub fn text(&self) -> String {
        self.state.document.source()
    }
    pub fn dirty(&self) -> bool {
        self.text() != self.baseline
    }
    pub(super) fn changed(&mut self, before: State) {
        if before.document != self.state.document || before.source_mode != self.state.source_mode {
            let bytes = before.document.source().len();
            self.history.record(before, bytes);
            self.revision += 1;
        }
    }
    pub fn history(&mut self, redo: bool) {
        if self.frozen || self.pending_ime.is_some() {
            return;
        }
        if let Some(mut state) = self
            .history
            .step(redo, self.state.clone(), self.text().len())
        {
            let source_mode = self.state.source_mode;
            if state.source_mode != source_mode {
                state.document =
                    Document::parse(&state.document.source(), self.markdown && !source_mode);
                state.source_mode = source_mode;
                state.selection = Selection::default();
            }
            self.state = state;
            self.revision += 1;
        }
    }
    #[cfg(test)]
    pub fn can_undo(&self) -> bool {
        self.history.can_undo()
    }
    pub fn source_mode(&mut self) {
        let source = self.text();
        self.state.source_mode = !self.state.source_mode;
        self.state.document = Document::parse(&source, self.markdown && !self.state.source_mode);
        self.state.selection = Selection::default();
    }
}
