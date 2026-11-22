//! The bounded server-sent-events framer every protocol parser reads
//! through: a turn's whole stream, one pending frame and the number of tool
//! calls are capped, and a stream that is not UTF-8 is refused.
use super::Completion;

/// The most bytes one model response may stream.
pub const TOTAL_LIMIT: usize = 16 * 1024 * 1024;
/// The longest incomplete line held while waiting for its end.
pub const FRAME_LIMIT: usize = 2 * 1024 * 1024;
/// The most tool calls one model response may make.
pub const MAX_CALLS: usize = 32;

/// A protocol's event handler.
pub trait Events {
    /// One `data:` payload, with the `event:` name that preceded it (empty
    /// when the stream names none). `Ok(true)` once the stream is complete.
    fn data(
        &mut self,
        event: &str,
        data: &str,
        delta: &mut dyn FnMut(&str, &str),
    ) -> Result<bool, String>;
    /// The completion, or an error when the stream gave no receipt.
    fn finish(self) -> Result<Completion, String>;
}

/// Splits bytes into SSE lines within the limits above.
#[derive(Default)]
struct Framer {
    buffer: Vec<u8>,
    /// How much of `buffer` is known to hold no line break: a long line
    /// arriving in many chunks is searched once, not again per chunk.
    scanned: usize,
    total: usize,
    event: String,
}

impl Framer {
    fn feed(
        &mut self,
        chunk: &[u8],
        mut on: impl FnMut(&str, &str) -> Result<bool, String>,
    ) -> Result<bool, String> {
        self.total += chunk.len();
        if self.total > TOTAL_LIMIT {
            return Err("Model output exceeded the turn limit".into());
        }
        self.buffer.extend_from_slice(chunk);
        let mut start = 0;
        let mut from = self.scanned;
        while let Some(offset) = self.buffer[from..].iter().position(|c| *c == b'\n') {
            let end = from + offset;
            let line = std::str::from_utf8(&self.buffer[start..end])
                .map_err(|_| "Invalid UTF-8 model stream")?
                .trim();
            start = end + 1;
            from = start;
            if line.is_empty() {
                // A blank line ends the event: its name does not carry over.
                self.event.clear();
                continue;
            }
            if let Some(name) = line.strip_prefix("event:") {
                self.event = name.trim().to_owned();
                continue;
            }
            let Some(data) = line.strip_prefix("data:").map(str::trim) else {
                continue;
            };
            if on(&self.event, data)? {
                self.buffer.drain(..start);
                self.scanned = 0;
                return Ok(true);
            }
        }
        self.buffer.drain(..start);
        self.scanned = self.buffer.len();
        if self.buffer.len() > FRAME_LIMIT {
            return Err("Model event exceeded its frame limit".into());
        }
        Ok(false)
    }
}

/// A protocol parser behind the framer.
pub struct Stream<P> {
    framer: Framer,
    parser: P,
}

impl<P: Events> Stream<P> {
    pub fn new(parser: P) -> Self {
        Self {
            framer: Framer::default(),
            parser,
        }
    }
    /// `Ok(true)` once the stream is complete.
    pub fn feed(
        &mut self,
        chunk: &[u8],
        delta: &mut dyn FnMut(&str, &str),
    ) -> Result<bool, String> {
        let parser = &mut self.parser;
        self.framer
            .feed(chunk, |event, data| parser.data(event, data, delta))
    }
    pub fn finish(self) -> Result<Completion, String> {
        self.parser.finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct Seen(Vec<(String, String)>);
    impl Events for Seen {
        fn data(
            &mut self,
            event: &str,
            data: &str,
            _: &mut dyn FnMut(&str, &str),
        ) -> Result<bool, String> {
            self.0.push((event.to_owned(), data.to_owned()));
            Ok(data == "stop")
        }
        fn finish(self) -> Result<Completion, String> {
            Ok(Completion::default())
        }
    }

    #[test]
    fn lines_split_at_any_byte_keep_their_event_names() {
        let input = "event: one\r\ndata: {\"a\":1}\r\n\r\n: comment\ndata: plain\n\nevent: two\ndata: stop\ndata: after\n";
        for split in 0..input.len() {
            let mut stream = Stream::new(Seen::default());
            let (a, b) = input.as_bytes().split_at(split);
            let mut sink = |_: &str, _: &str| {};
            let first = stream.feed(a, &mut sink).unwrap();
            if !first {
                assert!(stream.feed(b, &mut sink).unwrap());
            }
            assert_eq!(
                stream.parser.0,
                [
                    ("one".to_owned(), "{\"a\":1}".to_owned()),
                    (String::new(), "plain".to_owned()),
                    ("two".to_owned(), "stop".to_owned()),
                ]
            );
        }
    }

    /// A stream arriving one byte at a time reads the same lines: what was
    /// searched before is not searched again, and not skipped either.
    #[test]
    fn a_stream_fed_byte_by_byte_reads_the_same_lines() {
        let input = "event: one\r\ndata: {\"a\":1}\r\n\r\n: comment\ndata: plain\n\nevent: two\ndata: stop\n";
        let mut stream = Stream::new(Seen::default());
        let mut sink = |_: &str, _: &str| {};
        let mut done = false;
        for byte in input.as_bytes() {
            done = stream.feed(std::slice::from_ref(byte), &mut sink).unwrap();
        }
        assert!(done);
        assert_eq!(
            stream.parser.0,
            [
                ("one".to_owned(), "{\"a\":1}".to_owned()),
                (String::new(), "plain".to_owned()),
                ("two".to_owned(), "stop".to_owned()),
            ]
        );
    }

    #[test]
    fn oversized_frames_streams_and_invalid_utf8_are_refused() {
        let mut sink = |_: &str, _: &str| {};
        let mut stream = Stream::new(Seen::default());
        let long = vec![b'x'; FRAME_LIMIT + 1];
        assert_eq!(
            stream.feed(&long, &mut sink).unwrap_err(),
            "Model event exceeded its frame limit"
        );
        // Many complete lines in one chunk are not one oversized frame.
        let mut stream = Stream::new(Seen::default());
        let lines = ": keep-alive\n".repeat(FRAME_LIMIT / 10);
        assert!(!stream.feed(lines.as_bytes(), &mut sink).unwrap());
        let mut stream = Stream::new(Seen::default());
        let line = vec![b'\n'; 1024 * 1024];
        let mut result = Ok(false);
        for _ in 0..17 {
            result = stream.feed(&line, &mut sink);
            if result.is_err() {
                break;
            }
        }
        assert_eq!(result.unwrap_err(), "Model output exceeded the turn limit");
        let mut stream = Stream::new(Seen::default());
        assert_eq!(
            stream.feed(b"data: \xff\n", &mut sink).unwrap_err(),
            "Invalid UTF-8 model stream"
        );
    }
}
