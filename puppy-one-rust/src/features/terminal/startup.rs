//! Agent first-paint gate: a Shell prompt alone must not reveal the terminal.
use std::time::Duration;
const DEFAULT_TIMEOUT_MS: f64 = 2_400.;
const READY: [&str; 3] = ["\x1b[?1049h", "\x1b[?25l", "\x1b[2J"];
#[derive(Default)]
pub(super) struct Startup {
    pending: bool,
    started: bool,
    timeout: Duration,
    text: String,
    utf8_tail: Vec<u8>,
}
impl Startup {
    pub fn pending(timeout_ms: f64) -> Self {
        let milliseconds = if timeout_ms.is_finite() {
            timeout_ms.round().clamp(0., 5_000.)
        } else {
            DEFAULT_TIMEOUT_MS
        };
        Self {
            pending: true,
            timeout: Duration::from_millis(milliseconds as u64),
            ..Default::default()
        }
    }
    pub fn agent() -> Self {
        Self::pending(DEFAULT_TIMEOUT_MS)
    }
    pub fn covered(&self) -> bool {
        self.pending
    }
    /// Returns the single timer to install, only after a PTY has started.
    pub fn begin(&mut self) -> Option<Duration> {
        if !self.pending || self.started {
            return None;
        }
        self.started = true;
        if self.timeout.is_zero() {
            self.settle();
            None
        } else {
            Some(self.timeout)
        }
    }
    pub fn observe(&mut self, bytes: &[u8]) {
        if !self.pending || !self.started {
            return;
        }
        self.utf8_tail.extend_from_slice(bytes);
        let mut cursor = 0;
        while cursor < self.utf8_tail.len() {
            match std::str::from_utf8(&self.utf8_tail[cursor..]) {
                Ok(text) => {
                    self.text.push_str(text);
                    cursor = self.utf8_tail.len();
                }
                Err(error) => {
                    let valid_end = cursor + error.valid_up_to();
                    self.text.push_str(
                        std::str::from_utf8(&self.utf8_tail[cursor..valid_end])
                            .expect("validated UTF-8 prefix"),
                    );
                    cursor = valid_end;
                    if let Some(length) = error.error_len() {
                        self.text.push('\u{fffd}');
                        cursor += length;
                    } else {
                        break;
                    }
                }
            }
        }
        self.utf8_tail.drain(..cursor);
        // A pending buffer cannot exceed 383 UTF-16 units: the first substantial
        // paint settles it, releasing both buffers rather than retaining output.
        if self.text.encode_utf16().count() >= 384
            || READY.iter().any(|sequence| self.text.contains(sequence))
        {
            self.settle();
        }
    }
    pub fn settle(&mut self) {
        self.pending = false;
        self.text.clear();
        self.utf8_tail.clear();
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn prompts_stay_covered_until_split_tui_sequences_or_384_utf16_units() {
        for sequence in READY {
            for split in 0..sequence.len() {
                let mut startup = Startup::agent();
                startup.observe(sequence.as_bytes());
                assert!(startup.covered());
                assert_eq!(startup.begin(), Some(Duration::from_millis(2400)));
                assert_eq!(startup.begin(), None);
                startup.observe(b"shell prompt and echoed command");
                assert!(startup.covered());
                startup.observe(&sequence.as_bytes()[..split]);
                assert!(startup.covered());
                startup.observe(&sequence.as_bytes()[split..]);
                assert!(!startup.covered());
            }
        }
        let mut startup = Startup::agent();
        startup.begin();
        startup.observe("x".repeat(383).as_bytes());
        assert!(startup.covered());
        startup.observe(&[0xe4, 0xb8]);
        assert!(
            startup.covered(),
            "partial UTF-8 is not a replacement character yet"
        );
        startup.observe(&[0xad]);
        assert!(!startup.covered());
        let mut startup = Startup::agent();
        startup.begin();
        startup.observe("😀".repeat(191).as_bytes());
        assert!(startup.covered());
        startup.observe("😀".as_bytes());
        assert!(!startup.covered(), "JavaScript counts UTF-16 units");
    }
    #[test]
    fn timeout_is_bounded_begins_once_and_exit_or_failure_settles_pending_work() {
        for (input, expected) in [
            (f64::NAN, 2400),
            (f64::INFINITY, 2400),
            (-1., 0),
            (0., 0),
            (1.5, 2),
            (99_999., 5000),
        ] {
            let mut startup = Startup::pending(input);
            assert_eq!(
                startup.begin(),
                (expected > 0).then(|| Duration::from_millis(expected))
            );
            assert_eq!(startup.begin(), None);
            startup.settle();
            startup.settle();
            startup.observe(b"late output");
            assert!(!startup.covered());
            assert!(startup.text.is_empty());
            assert!(startup.utf8_tail.is_empty());
        }
        let mut startup = Startup::agent();
        startup.settle();
        assert_eq!(startup.begin(), None);
    }
}
