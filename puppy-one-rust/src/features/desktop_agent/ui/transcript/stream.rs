//! `useAgentStreamPresentation`: a streaming answer catches up with the
//! provider's text a bounded step per frame, and only the transcript redraws.
use super::view::TranscriptView;
use gpui::*;
use std::collections::HashMap;

/// `STREAM_FRAME_MS`: live text commits align to paint.
const STREAM_FRAME_MS: u64 = 16;

impl TranscriptView {
    /// `useAgentStreamPresentation(text, streaming)`: the provider text stays
    /// authoritative; a streaming answer catches up a bounded step per frame,
    /// and anything else shows at once.
    pub(super) fn presented_text(&self, id: &str, text: &str, streaming: bool) -> String {
        match self.stream_text.get(id) {
            Some(displayed) if streaming && text.starts_with(displayed.as_str()) => {
                displayed.clone()
            }
            _ => text.to_string(),
        }
    }

    /// Tracks the streaming answers and drives their frames while one lags.
    pub(super) fn sync_stream_presentation(&mut self, cx: &mut Context<Self>) {
        let streaming: HashMap<String, String> = self
            .parts
            .iter()
            .filter(|(_, part)| part.kind == "assistant" && part.streaming)
            .map(|(id, part)| (id.clone(), part.text.clone()))
            .collect();
        // A new answer shows its text as it first arrives (`useState(text)`).
        self.stream_text.retain(|id, displayed| {
            streaming
                .get(id)
                .is_some_and(|text| text.starts_with(displayed.as_str()))
        });
        for (id, text) in &streaming {
            self.stream_text
                .entry(id.clone())
                .or_insert_with(|| text.clone());
        }
        let lagging = self
            .stream_text
            .iter()
            .any(|(id, displayed)| streaming.get(id) != Some(displayed));
        if !lagging || self.stream_frames.is_some() {
            return;
        }
        self.stream_frames = Some(cx.spawn(async move |this, cx| {
            loop {
                cx.background_executor()
                    .timer(std::time::Duration::from_millis(STREAM_FRAME_MS))
                    .await;
                let more = this.update(cx, |s, cx| s.advance_stream_frame(cx));
                if !matches!(more, Ok(true)) {
                    break;
                }
            }
        }));
    }

    /// One frame: every lagging answer takes its next step (`nextAgentStreamText`).
    fn advance_stream_frame(&mut self, cx: &mut Context<Self>) -> bool {
        use crate::features::desktop_agent::domain::agent_stream_presentation::next_agent_stream_text;
        let mut stepped = Vec::new();
        let mut lagging = false;
        for (id, displayed) in self.stream_text.iter_mut() {
            let Some(part) = self.parts.get(id) else {
                continue;
            };
            let text = part.text.clone();
            if *displayed == text {
                continue;
            }
            *displayed = next_agent_stream_text(displayed, &text);
            lagging |= *displayed != text;
            stepped.push(id.clone());
        }
        for id in stepped {
            if let Some(row) = self
                .rows
                .iter()
                .find(|row| row.part_ids.contains(&id))
                .map(|row| row.row.id.clone())
            {
                self.splice_row(&row);
            }
        }
        cx.notify();
        if !lagging {
            self.stream_frames = None;
        }
        lagging
    }
}
