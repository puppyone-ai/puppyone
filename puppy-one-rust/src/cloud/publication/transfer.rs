//! `cloud-publish-transfer.mjs`: how far the first send has got, read from
//! Git's own progress output.
//!
//! `git push --progress` reports "Writing objects: 45% (555/1234), 12.34 MiB |
//! 1.02 MiB/s" on stderr, redrawn in place with carriage returns. That line is
//! the only honest measure there is: Git counts the share of objects written,
//! the bytes sent so far and the current rate. The total size is not known
//! until Git has finished, so nothing here claims one, and no time remaining
//! is derived from a total that does not exist. Git runs with `LC_ALL=C`, so
//! the English line shape is stable.
//!
//! Reporting is observational: a malformed line is ignored, and a listener
//! that panics never reaches the push.
use regex::Regex;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

/// `CloudPublishTransfer`: the share of objects written, and the bytes sent
/// and current rate once Git has measured them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Transfer {
    pub percent: u8,
    pub sent_bytes: Option<u64>,
    pub bytes_per_second: Option<u64>,
}

/// `CLOUD_PUBLISH_TRANSFER_INTERVAL_MS`: at most this often, so a fast
/// redraw does not flood the window.
pub const INTERVAL: Duration = Duration::from_millis(250);

const UNIT: &str = r"(bytes|KiB|MiB|GiB)";
static WRITING_LINE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(&format!(
        r"^Writing objects:\s+(\d{{1,3}})%\s+\((\d+)/(\d+)\)(?:,\s+([\d.]+)\s+{UNIT}(?:\s+\|\s+([\d.]+)\s+{UNIT}/s)?)?"
    ))
    .expect("valid pattern")
});
/// Progress redraws from Git and from the receiving server, never
/// diagnostics.
static PROGRESS_LINE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"^(?:remote:\s+)?(?:Enumerating objects|Counting objects|Delta compression using|Compressing objects|Writing objects|Resolving deltas|Total \d+ \(delta)",
    )
    .expect("valid pattern")
});

/// `createGitPushProgressReader`: fed stderr in whatever chunks the pipe
/// delivers, it reports each new reading to `listener`, at most once per
/// [`INTERVAL`] except the first and the finish.
pub struct ProgressReader<L, C> {
    listener: L,
    now: C,
    interval: Duration,
    partial: Vec<u8>,
    last: Option<Transfer>,
    reported_at: Option<Instant>,
}
impl<L: FnMut(Transfer), C: FnMut() -> Instant> ProgressReader<L, C> {
    pub fn new(listener: L, now: C) -> Self {
        Self {
            listener,
            now,
            interval: INTERVAL,
            partial: Vec::new(),
            last: None,
            reported_at: None,
        }
    }
    /// Raw stderr, in any chunking.
    pub fn write(&mut self, chunk: &[u8]) {
        self.partial.extend_from_slice(chunk);
        while let Some(end) = self.partial.iter().position(|b| matches!(b, b'\r' | b'\n')) {
            let segment: Vec<u8> = self.partial.drain(..=end).collect();
            self.read_segment(&String::from_utf8_lossy(&segment[..end]));
        }
    }
    fn read_segment(&mut self, segment: &str) {
        let Some(found) = WRITING_LINE.captures(segment.trim()) else {
            return;
        };
        let number = |index: usize| found.get(index).map(|m| m.as_str());
        let Some(percent) = number(1).and_then(|p| p.parse::<u16>().ok()) else {
            return;
        };
        // Git prints bytes and rate only once it has measured them; keep the
        // last known reading rather than letting the numbers blink out.
        let last = self.last;
        self.report(Transfer {
            percent: percent.min(100) as u8,
            sent_bytes: to_bytes(number(4), number(5)).or(last.and_then(|l| l.sent_bytes)),
            bytes_per_second: to_bytes(number(6), number(7))
                .or(last.and_then(|l| l.bytes_per_second)),
        });
    }
    fn report(&mut self, transfer: Transfer) {
        let at = (self.now)();
        let finished = transfer.percent >= 100;
        // The first reading and the last always go through; between them the
        // interval holds, and a reading identical to the last says nothing.
        if let (Some(_), Some(reported)) = (self.last, self.reported_at)
            && !finished
            && at.saturating_duration_since(reported) < self.interval
        {
            return;
        }
        if self.last == Some(transfer) {
            return;
        }
        self.last = Some(transfer);
        self.reported_at = Some(at);
        let listener = &mut self.listener;
        // Progress cannot take part in the push.
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| listener(transfer)));
    }
}

/// `stripGitProgressOutput`: captured stderr without Git's progress
/// redraws, so a failure's diagnostic is the error Git printed.
pub fn strip_progress_output(text: &str) -> String {
    text.split(['\r', '\n'])
        .filter(|segment| !segment.trim().is_empty() && !PROGRESS_LINE.is_match(segment.trim()))
        .collect::<Vec<_>>()
        .join("\n")
}

fn to_bytes(value: Option<&str>, unit: Option<&str>) -> Option<u64> {
    let amount: f64 = value?.parse().ok()?;
    let scale = match unit? {
        "bytes" => 1.,
        "KiB" => 1024.,
        "MiB" => 1024f64.powi(2),
        "GiB" => 1024f64.powi(3),
        _ => return None,
    };
    amount.is_finite().then(|| (amount * scale).round() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;

    const MIB: f64 = 1024. * 1024.;

    /// Shaped exactly like `LC_ALL=C git push --progress` stderr, captured
    /// from Git 2.50: preparation lines, then "Writing objects" redrawn in
    /// place with `\r`, bytes and rate appearing once Git has measured them.
    pub(crate) const PUSH_STDERR: &str = concat!(
        "Enumerating objects: 42, done.\n",
        "Counting objects:  50% (21/42)\rCounting objects: 100% (42/42), done.\n",
        "Delta compression using up to 10 threads\n",
        "Compressing objects: 100% (42/42), done.\n",
        "Writing objects:   2% (1/42)\r",
        "Writing objects:  45% (19/42), 4.50 MiB | 1.02 MiB/s\r",
        "Writing objects:  97% (41/42), 10.95 MiB | 1.01 MiB/s\r",
        "Writing objects: 100% (42/42), 11.45 MiB | 1.00 MiB/s, done.\n",
        "Total 42 (delta 0), reused 0 (delta 0), pack-reused 0 (from 0)\n",
        "To https://api.puppyone.test/git/project-1.git\n",
        " * [new branch]      0123456 -> main\n",
    );

    fn mib(value: f64) -> Option<u64> {
        Some((value * MIB).round() as u64)
    }

    /// A clock that moves a second each time it is read.
    fn ticking() -> impl FnMut() -> Instant {
        let base = Instant::now();
        let mut ticks = 0;
        move || {
            ticks += 1;
            base + Duration::from_secs(ticks)
        }
    }

    fn read(stderr: &[&[u8]], now: impl FnMut() -> Instant) -> Vec<Transfer> {
        let mut readings = Vec::new();
        let mut reader = ProgressReader::new(|t| readings.push(t), now);
        for chunk in stderr {
            reader.write(chunk);
        }
        drop(reader);
        readings
    }

    /// `reads how much is sent and how fast from Git's own progress line`.
    #[test]
    fn reads_the_share_bytes_and_rate_from_gits_progress_line() {
        let readings = read(&[PUSH_STDERR.as_bytes()], ticking());
        assert_eq!(
            readings,
            [
                // Before Git has measured anything there is only the share.
                Transfer {
                    percent: 2,
                    sent_bytes: None,
                    bytes_per_second: None
                },
                Transfer {
                    percent: 45,
                    sent_bytes: mib(4.5),
                    bytes_per_second: mib(1.02)
                },
                Transfer {
                    percent: 97,
                    sent_bytes: mib(10.95),
                    bytes_per_second: mib(1.01)
                },
                Transfer {
                    percent: 100,
                    sent_bytes: mib(11.45),
                    bytes_per_second: mib(1.)
                },
            ]
        );
    }

    /// `survives a progress line split across pipe chunks`.
    #[test]
    fn a_line_split_across_pipe_chunks_still_reads() {
        let bytes: Vec<&[u8]> = PUSH_STDERR.as_bytes().chunks(1).collect();
        let readings = read(&bytes, ticking());
        let shares: Vec<u8> = readings.iter().map(|r| r.percent).collect();
        assert_eq!(shares, [2, 45, 97, 100]);
    }

    /// `holds redraws to the interval, but never drops the finish`.
    #[test]
    fn redraws_wait_for_the_interval_but_the_finish_never_does() {
        let base = Instant::now();
        let readings = read(&[PUSH_STDERR.as_bytes()], move || base);
        let shares: Vec<u8> = readings.iter().map(|r| r.percent).collect();
        assert_eq!(shares, [2, 100]);
    }

    /// `keeps the last measured bytes and rate when a redraw omits them`.
    #[test]
    fn a_redraw_without_numbers_keeps_the_last_measured_ones() {
        let readings = read(
            &[b"Writing objects:  40% (4/10), 2.00 MiB | 1.00 MiB/s\rWriting objects:  50% (5/10)\r"],
            ticking(),
        );
        assert_eq!(
            readings.last(),
            Some(&Transfer {
                percent: 50,
                sent_bytes: mib(2.),
                bytes_per_second: mib(1.)
            })
        );
    }

    /// `never lets a failing listener reach the push`.
    #[test]
    fn a_failing_listener_never_reaches_the_push() {
        let mut reader = ProgressReader::new(|_| panic!("window gone"), ticking());
        reader.write(PUSH_STDERR.as_bytes());
    }

    /// `leaves only Git's diagnostic once the progress redraws are removed`.
    #[test]
    fn only_gits_diagnostic_is_left_without_the_redraws() {
        let before = PUSH_STDERR.split("Total").next().unwrap();
        let stderr = format!(
            "{before}remote: Resolving deltas: 100% (3/3)\r\n\
             error: RPC failed; HTTP 413 curl 22 The requested URL returned error: 413\n\
             fatal: the remote end hung up unexpectedly\n"
        );
        assert_eq!(
            strip_progress_output(&stderr),
            "error: RPC failed; HTTP 413 curl 22 The requested URL returned error: 413\n\
             fatal: the remote end hung up unexpectedly"
        );
    }
}
