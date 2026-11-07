//! Port of `terminalActivity.ts` (`TerminalActivityController`): title
//! protocols and PTY output bursts of an Agent CLI terminal become one
//! low-frequency activity signal. Plain shells never report activity.
use std::time::{Duration, Instant};

pub const OUTPUT_IDLE: Duration = Duration::from_millis(700);
pub const PRESENTATION_REFRESH: Duration = Duration::from_millis(250);

const BRAILLE_SPINNER: [char; 10] = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const CURSOR_BUSY_LABELS: [&str; 8] = [
    "Moving to cloud",
    "Loading conversation",
    "Reconnecting",
    "Running shell command",
    "Planning",
    "Working",
    "Queued",
    "Reviewing changes",
];

#[derive(Default)]
pub struct TerminalActivity {
    enabled: bool,
    title_active: bool,
    last_output: Option<Instant>,
    refresh_until: Option<Instant>,
}

impl TerminalActivity {
    pub fn new(agent: bool) -> Self {
        Self {
            enabled: agent,
            ..Self::default()
        }
    }
    pub fn active(&self, now: Instant) -> bool {
        self.title_active || self.last_output.is_some_and(|at| now < at + OUTPUT_IDLE)
    }
    pub fn note_title(&mut self, title: &str) {
        if self.enabled {
            self.title_active = is_title_active(title);
        }
    }
    /// A host-owned fit/resize repaints the PTY; that burst is not work.
    pub fn begin_presentation_refresh(&mut self, now: Instant) {
        if self.enabled {
            self.refresh_until = Some(now + PRESENTATION_REFRESH);
        }
    }
    /// Returns true when output (re)started the idle window.
    pub fn note_output(&mut self, now: Instant, len: usize) -> bool {
        if !self.enabled || len == 0 || self.refresh_until.is_some_and(|until| now < until) {
            return false;
        }
        self.last_output = Some(now);
        true
    }
    /// When the output signal lapses, if it is still pending.
    pub fn output_deadline(&self) -> Option<Instant> {
        self.last_output.map(|at| at + OUTPUT_IDLE)
    }
    pub fn reset(&mut self) {
        *self = Self::new(self.enabled);
    }
}

/// `isTerminalTitleActive`: a braille spinner frame, or a Cursor-style
/// `… - <status>` suffix naming a busy state.
pub fn is_title_active(title: &str) -> bool {
    let normalized = title.trim();
    if normalized
        .chars()
        .next()
        .is_some_and(|c| BRAILLE_SPINNER.contains(&c))
    {
        return true;
    }
    let Some(separator) = normalized.rfind(" - ") else {
        return false;
    };
    let mut status = &normalized[separator + 3..];
    if let Some(first) = status.chars().next()
        && pictographic(first)
    {
        status = status[first.len_utf8()..]
            .trim_start_matches('\u{FE0F}')
            .trim_start();
    }
    CURSOR_BUSY_LABELS.iter().any(|label| {
        status == *label
            || status
                .strip_prefix(label)
                .is_some_and(|rest| rest.starts_with(' '))
    })
}

/// `\p{Extended_Pictographic}` for the emoji blocks titles actually use.
fn pictographic(c: char) -> bool {
    matches!(c as u32,
        0x00A9 | 0x00AE | 0x203C | 0x2049 | 0x2122 | 0x2139
        | 0x2194..=0x21FF | 0x2300..=0x23FF | 0x25A0..=0x27BF | 0x2900..=0x297F
        | 0x2B00..=0x2BFF | 0x3030 | 0x303D | 0x3297 | 0x3299 | 0x1F000..=0x1FAFF)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn titles_follow_the_product_protocols() {
        assert!(is_title_active("⠙ claude"));
        assert!(is_title_active("  ⠏ Working"));
        assert!(is_title_active("repo - Working"));
        assert!(is_title_active("repo - 🔧 Running shell command now"));
        assert!(is_title_active("repo - ⏳\u{FE0F} Planning"));
        assert!(!is_title_active("repo - Workingman"));
        assert!(!is_title_active("Working"));
        assert!(!is_title_active("zsh"));
    }

    #[test]
    fn output_lapses_and_refresh_bursts_are_ignored() {
        let start = Instant::now();
        let mut shell = TerminalActivity::new(false);
        assert!(!shell.note_output(start, 10));
        let mut agent = TerminalActivity::new(true);
        agent.begin_presentation_refresh(start);
        assert!(!agent.note_output(start + Duration::from_millis(100), 10));
        assert!(!agent.active(start + Duration::from_millis(100)));
        assert!(agent.note_output(start + Duration::from_millis(300), 10));
        assert!(agent.active(start + Duration::from_millis(900)));
        assert!(!agent.active(start + Duration::from_millis(1000)));
        agent.note_title("⠋ work");
        assert!(agent.active(start + Duration::from_secs(5)));
        agent.reset();
        assert!(!agent.active(start + Duration::from_secs(5)));
    }
}
