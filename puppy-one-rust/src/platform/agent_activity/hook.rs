//! Port of `bridge/puppyone-agent-hook.mjs`: the process an Agent CLI runs
//! for each Hook event. Outside a prepared PuppyOne terminal (no endpoint in
//! the environment) it does nothing; inside one it projects the event and
//! sends one frame. It always exits successfully and within the Hook's
//! timeout, so it can never fail or slow the Agent's tool call.
use super::{env, limits, projector, transport::Envelope, valid_provider_id};
use std::io::Read;

/// The executable's argument that selects this mode (before any UI starts).
pub const FLAG: &str = "--agent-activity-hook";

pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    let lookup = |key: &str| std::env::var(key).ok();
    let cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default();
    let _ = forward(&lookup, &args, std::io::stdin(), &cwd, |endpoint, frame| {
        send(endpoint, frame)
    });
}

/// `forwardHookInput`.
pub fn forward(
    lookup: &dyn Fn(&str) -> Option<String>,
    args: &[String],
    input: impl Read,
    cwd: &str,
    send: impl FnOnce(&str, &str) -> bool,
) -> bool {
    let value = |key: &str| lookup(key).filter(|v| !v.is_empty());
    let (Some(endpoint), Some(token), Some(terminal_session_id)) = (
        value(env::ENDPOINT),
        value(env::TOKEN),
        value(env::TERMINAL_SESSION_ID),
    ) else {
        return false;
    };
    let Some(provider_id) = value(env::PROVIDER).or_else(|| provider_argument(args)) else {
        return false;
    };
    let Some(raw) = read_bounded(input, limits::FRAME_BYTES * 4) else {
        return false;
    };
    let Ok(native) = serde_json::from_slice::<serde_json::Value>(&raw) else {
        return false;
    };
    let Some(payload) = projector::project(&native, cwd) else {
        return false;
    };
    let frame = Envelope {
        terminal_session_id,
        provider_id,
        token,
        payload,
    }
    .to_frame();
    frame.len() <= limits::FRAME_BYTES && send(&endpoint, &frame)
}

fn provider_argument(args: &[String]) -> Option<String> {
    let index = args.iter().position(|a| a == "--provider")?;
    args.get(index + 1)
        .filter(|p| valid_provider_id(p))
        .cloned()
}

fn read_bounded(mut input: impl Read, limit: usize) -> Option<Vec<u8>> {
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        let n = input.read(&mut chunk).ok()?;
        if n == 0 {
            return (!bytes.is_empty()).then_some(bytes);
        }
        bytes.extend_from_slice(&chunk[..n]);
        if bytes.len() > limit {
            return None;
        }
    }
}

/// `sendFrame`: one connection, 200ms at most.
#[cfg(unix)]
fn send(endpoint: &str, frame: &str) -> bool {
    use std::io::Write as _;
    let Ok(mut stream) = std::os::unix::net::UnixStream::connect(endpoint) else {
        return false;
    };
    let _ = stream.set_write_timeout(Some(std::time::Duration::from_millis(200)));
    let sent = stream.write_all(frame.as_bytes()).is_ok();
    let _ = stream.shutdown(std::net::Shutdown::Write);
    sent
}
#[cfg(not(unix))]
fn send(_: &str, _: &str) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    use std::collections::HashMap;
    fn environment(provider: Option<&str>) -> HashMap<String, String> {
        let mut env = HashMap::from([
            (env::ENDPOINT.to_owned(), "/tmp/activity.sock".to_owned()),
            (env::TOKEN.to_owned(), "t".repeat(43)),
            (env::TERMINAL_SESSION_ID.to_owned(), "term-1".to_owned()),
        ]);
        if let Some(p) = provider {
            env.insert(env::PROVIDER.into(), p.into());
        }
        env
    }
    #[test]
    fn a_hook_event_becomes_one_authenticated_frame() {
        let env = environment(None);
        let lookup = |k: &str| env.get(k).cloned();
        let args = ["bridge".into(), "--provider".into(), "claude".into()];
        let input = br#"{"hook_event_name":"PreToolUse","tool_name":"Read","tool_input":{"file_path":"a.rs"},"cwd":"/repo"}"#;
        let mut sent = None;
        assert!(forward(
            &lookup,
            &args,
            &input[..],
            "/",
            |endpoint, frame| {
                sent = Some((endpoint.to_owned(), frame.to_owned()));
                true
            }
        ));
        let (endpoint, frame) = sent.unwrap();
        assert_eq!(endpoint, "/tmp/activity.sock");
        assert!(frame.ends_with('\n'));
        let envelope = Envelope::parse(&serde_json::from_str(frame.trim_end()).unwrap()).unwrap();
        assert_eq!(envelope.provider_id, "claude");
        assert_eq!(envelope.terminal_session_id, "term-1");
        assert_eq!(envelope.payload.input["file_path"], "a.rs");
        // The session's provider wins over the command's argument.
        let env = environment(Some("codex"));
        let lookup = |k: &str| env.get(k).cloned();
        let mut provider = None;
        forward(&lookup, &args, &input[..], "/", |_, frame| {
            provider = Envelope::parse(&serde_json::from_str(frame.trim_end()).unwrap())
                .map(|e| e.provider_id);
            true
        });
        assert_eq!(provider.as_deref(), Some("codex"));
    }
    #[test]
    fn outside_a_prepared_terminal_or_with_bad_input_nothing_is_sent() {
        let never = |_: &str, _: &str| -> bool { panic!("sent") };
        let empty = |_: &str| None;
        assert!(!forward(&empty, &[], &b"{}"[..], "/", never));
        let env = environment(None);
        let lookup = |k: &str| env.get(k).cloned();
        // No provider at all.
        assert!(!forward(
            &lookup,
            &[],
            &b"{\"event\":\"x\"}"[..],
            "/",
            never
        ));
        let args = ["--provider".into(), "Bad Id".into()];
        assert!(!forward(
            &lookup,
            &args,
            &b"{\"event\":\"x\"}"[..],
            "/",
            never
        ));
        let args = ["--provider".into(), "codex".into()];
        assert!(!forward(&lookup, &args, &b"not json"[..], "/", never));
        assert!(!forward(&lookup, &args, &b""[..], "/", never));
        let huge = vec![b' '; limits::FRAME_BYTES * 4 + 1];
        assert!(!forward(&lookup, &args, &huge[..], "/", never));
    }
}
