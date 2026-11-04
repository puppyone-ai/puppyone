//! Temporary IP-loopback receiver. Only credentials from a validated, single-use
//! top-level form or a PKCE code are accepted; no CORS, token URL, or login form.
use super::{
    model::*,
    result_page::{self, Outcome},
    service::Broker,
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    time::{Duration, Instant},
};

pub(super) enum Input {
    Code(Secret),
    Refresh(Secret),
    Cancelled,
    /// The login page's form carried this attempt's state but failed the
    /// origin or token check (`onRejected` with `matchedState`). Its handoff
    /// cannot be repeated, so the sign-in fails now instead of waiting.
    Rejected(&'static str),
}
fn random() -> Result<Secret> {
    let mut bytes = zeroize::Zeroizing::new([0u8; 32]);
    getrandom::fill(bytes.as_mut()).map_err(|_| Error::Unavailable)?;
    Ok(Secret(URL_SAFE_NO_PAD.encode(*bytes)))
}
pub(super) fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}
struct Candidate {
    stream: TcpStream,
    input: Input,
}
struct Stop(Arc<AtomicBool>);
impl Drop for Stop {
    fn drop(&mut self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

/// `RETURN_ACTION_TTL_MS`: how long "Return to PuppyOne Desktop" works.
const RETURN_FOR: Duration = Duration::from_secs(10 * 60);
/// A refused request: its status and the page that says why.
pub(super) type Refusal = (u16, Outcome);
fn refusal(status: u16) -> Refusal {
    (
        status,
        match status {
            409 => Outcome::AlreadyUsed,
            503 => Outcome::NotReady,
            _ => Outcome::Unrecognized,
        },
    )
}

pub(super) fn run(
    broker: &Arc<Broker>,
    environment: Environment,
    locale: &'static str,
    fence: &Fence,
) -> Result<()> {
    fence.check()?;
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|_| Error::Unavailable)?;
    listener
        .set_nonblocking(true)
        .map_err(|_| Error::Unavailable)?;
    let host = listener
        .local_addr()
        .map_err(|_| Error::Unavailable)?
        .to_string();
    let callback = format!("http://{host}/auth/callback");
    let state = Arc::new(random()?);
    let verifier = random()?;
    let mut url =
        url::Url::parse(&format!("{}/login", environment.web)).map_err(|_| Error::Configuration)?;
    url.query_pairs_mut()
        .append_pair("client", "desktop")
        .append_pair("desktop_state", &state.0)
        .append_pair("desktop_callback", &callback)
        .append_pair("code_challenge", &challenge(&verifier.0));
    let stop = Stop(Arc::new(AtomicBool::new(false)));
    let (tx, rx) = mpsc::sync_channel::<Candidate>(8);
    let mut workers: Vec<std::thread::JoinHandle<()>> = Vec::new();
    broker.browser_ready(fence, url.into())?;
    let result = loop {
        if let Err(error) = fence.check() {
            break Err(error);
        }
        if let Ok(mut candidate) = rx.try_recv() {
            if let Input::Rejected(reason) = candidate.input {
                // `describeHandoffRejection`: the reason, never the form.
                eprintln!("Cloud sign-in handoff was rejected: {reason}");
                respond(&mut candidate.stream, (400, Outcome::Failed), locale, None);
                break Err(Error::InvalidResponse);
            }
            // Consume before exchange, even if the provider later rejects it.
            let result =
                broker.complete_login(environment.clone(), candidate.input, &verifier, fence);
            if result.is_ok() {
                // `finish`: the page offers to bring the app forward, through
                // a one-time path this listener keeps for a while.
                let path = format!("/auth/return/{}", random()?.0);
                respond(
                    &mut candidate.stream,
                    (200, Outcome::Success),
                    locale,
                    Some(&path),
                );
                let listener = listener.try_clone().map_err(|_| Error::Unavailable)?;
                let host = host.clone();
                std::thread::spawn(move || keep_return(listener, host, path, locale));
            } else {
                respond(&mut candidate.stream, (400, Outcome::Failed), locale, None);
            }
            break result;
        }
        workers.retain(|worker| !worker.is_finished());
        match listener.accept() {
            Ok((mut stream, peer)) => {
                if !peer.ip().is_loopback() || workers.len() >= 8 {
                    respond(&mut stream, refusal(503), locale, None);
                    continue;
                }
                let (state, host, origin, stopped, fence, tx) = (
                    state.clone(),
                    host.clone(),
                    environment.web.clone(),
                    stop.0.clone(),
                    fence.clone(),
                    tx.clone(),
                );
                workers.push(std::thread::spawn(move || {
                    match receive(&mut stream, &host, &origin, &state.0, &fence, &stopped) {
                        Ok(input) => {
                            if let Err(
                                mpsc::TrySendError::Full(mut candidate)
                                | mpsc::TrySendError::Disconnected(mut candidate),
                            ) = tx.try_send(Candidate { stream, input })
                            {
                                respond(&mut candidate.stream, refusal(409), locale, None);
                            }
                        }
                        Err(refused) => respond(&mut stream, refused, locale, None),
                    }
                }));
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(20))
            }
            Err(_) => break Err(Error::Unavailable),
        }
    };
    stop.0.store(true, Ordering::SeqCst);
    drop(listener);
    for worker in workers {
        let _ = worker.join();
    }
    while let Ok(mut candidate) = rx.try_recv() {
        respond(&mut candidate.stream, refusal(409), locale, None);
    }
    result
}
/// After a sign-in: the listener answers "Return to PuppyOne Desktop" (a
/// POST to `path`) for a while, says a used link was used, and closes.
fn keep_return(listener: TcpListener, host: String, path: String, locale: &'static str) {
    let until = Instant::now() + RETURN_FOR;
    while Instant::now() < until {
        let Ok((mut stream, peer)) = listener.accept() else {
            std::thread::sleep(Duration::from_millis(50));
            continue;
        };
        if !peer.ip().is_loopback() {
            continue;
        }
        let _ = stream.set_nonblocking(false);
        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
        let mut bytes = [0u8; 4096];
        let n = stream.read(&mut bytes).unwrap_or(0);
        let mut headers = [httparse::EMPTY_HEADER; 32];
        let mut request = httparse::Request::new(&mut headers);
        if request.parse(&bytes[..n]).is_err() {
            continue;
        }
        let host_ok = request
            .headers
            .iter()
            .find(|h| h.name.eq_ignore_ascii_case("host"))
            .is_some_and(|h| h.value == host.as_bytes());
        match (request.method, request.path) {
            (Some("POST"), Some(target)) if host_ok && target == path => {
                let _ = stream.write_all(result_page::returned());
                super::reveal_app();
            }
            (Some("GET"), Some(target)) if host_ok && target.starts_with("/auth/callback") => {
                respond(&mut stream, refusal(409), locale, None)
            }
            _ => respond(&mut stream, refusal(404), locale, None),
        }
    }
}
fn receive(
    stream: &mut TcpStream,
    host: &str,
    origin: &str,
    state: &str,
    fence: &Fence,
    stopped: &AtomicBool,
) -> std::result::Result<Input, Refusal> {
    stream.set_nonblocking(true).map_err(|_| refusal(400))?;
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut bytes = zeroize::Zeroizing::new(Vec::new());
    loop {
        if stopped.load(Ordering::SeqCst) || fence.check().is_err() {
            return Err(refusal(409));
        }
        if Instant::now() >= deadline {
            return Err(refusal(408));
        }
        let mut chunk = zeroize::Zeroizing::new([0u8; 2048]);
        match stream.read(chunk.as_mut()) {
            Ok(0) => return Err(refusal(400)),
            Ok(n) => {
                bytes.extend_from_slice(&chunk[..n]);
                if bytes.len() > 24 * 1024 {
                    return Err(refusal(413));
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(10));
                continue;
            }
            Err(_) => return Err(refusal(400)),
        }
        match parse(&bytes, host, origin, state).map_err(|status| {
            // `stateMismatch`: a well-formed request for another attempt.
            if status == STATE_MISMATCH {
                (400, Outcome::StateMismatch)
            } else {
                refusal(status)
            }
        })? {
            Some(input) => return Ok(input),
            None => continue,
        }
    }
}
/// `parse`'s status for a request carrying another attempt's state.
const STATE_MISMATCH: u16 = 4000;
pub(super) fn parse(
    bytes: &[u8],
    host: &str,
    origin: &str,
    expected: &str,
) -> std::result::Result<Option<Input>, u16> {
    let mut headers = [httparse::EMPTY_HEADER; 32];
    let mut request = httparse::Request::new(&mut headers);
    let offset = match request.parse(bytes).map_err(|_| 400u16)? {
        httparse::Status::Partial => {
            return if bytes.len() > 8192 {
                Err(413)
            } else {
                Ok(None)
            };
        }
        httparse::Status::Complete(n) => n,
    };
    if offset > 8192 {
        return Err(413);
    }
    let one_header = |name: &str| -> std::result::Result<Option<&str>, u16> {
        let values: Vec<_> = request
            .headers
            .iter()
            .filter(|h| h.name.eq_ignore_ascii_case(name))
            .collect();
        if values.len() > 1 {
            return Err(400);
        }
        values
            .first()
            .map(|h| std::str::from_utf8(h.value).map_err(|_| 400u16))
            .transpose()
    };
    if one_header("host")? != Some(host) || one_header("transfer-encoding")?.is_some() {
        return Err(400);
    }
    let length = one_header("content-length")?
        .map(|s| {
            if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
                return Err(400);
            }
            s.parse::<usize>().map_err(|_| 413u16)
        })
        .transpose()?
        .unwrap_or(0);
    if length > 16384 {
        return Err(413);
    }
    if bytes.len() < offset + length {
        return Ok(None);
    }
    if bytes.len() != offset + length {
        return Err(400);
    }
    let target = request.path.ok_or(400u16)?;
    if request.method == Some("POST") && target == "/auth/session" {
        if one_header("content-type")?.and_then(|v| v.split(';').next())
            != Some("application/x-www-form-urlencoded")
        {
            return Err(400);
        }
        // `createBrowserSessionReceiver`: the state first, so a rejection
        // from the real login page is told apart from any other request.
        let form: Vec<_> = url::form_urlencoded::parse(&bytes[offset..])
            .map(|(k, v)| (k.into_owned(), Secret(v.into_owned())))
            .collect();
        let all = |key: &'static str| -> Vec<&Secret> {
            form.iter()
                .filter(|(k, _)| k == key)
                .map(|(_, v)| v)
                .collect()
        };
        let states = all("state");
        if states.len() != 1 {
            return Err(400);
        }
        if states[0].0 != expected {
            return Err(STATE_MISMATCH);
        }
        if one_header("origin")? != Some(origin) {
            return Ok(Some(Input::Rejected("origin")));
        }
        let tokens = all("refresh_token");
        return match tokens.as_slice() {
            [token] if token.valid() => Ok(Some(Input::Refresh((*token).clone()))),
            _ => Ok(Some(Input::Rejected("refresh-token"))),
        };
    }
    let query = if request.method == Some("GET")
        && target.starts_with("/auth/callback?")
        && length == 0
        && !target.contains('#')
    {
        target
            .strip_prefix("/auth/callback?")
            .ok_or(404u16)?
            .as_bytes()
    } else {
        return Err(404);
    };
    let params: Vec<_> = url::form_urlencoded::parse(query)
        .map(|(k, v)| (k.into_owned(), Secret(v.into_owned())))
        .collect();
    if params
        .iter()
        .map(|(key, _)| key)
        .collect::<std::collections::HashSet<_>>()
        .len()
        != params.len()
    {
        return Err(400);
    }
    let one = |key: &str| -> Option<&Secret> {
        let mut values = params.iter().filter(|(k, _)| k == key).map(|(_, v)| v);
        let first = values.next()?;
        if values.next().is_some() {
            None
        } else {
            Some(first)
        }
    };
    match one("state") {
        None => return Err(400),
        Some(state) if state.0 != expected => return Err(STATE_MISMATCH),
        Some(_) => {}
    }
    {
        if params
            .iter()
            .any(|(k, _)| !matches!(k.as_str(), "state" | "code" | "error" | "error_description"))
        {
            return Err(400);
        }
        if one("error").is_some() && one("code").is_none() {
            return Ok(Some(Input::Cancelled));
        }
        let code = one("code").filter(|s| s.valid()).ok_or(400u16)?;
        if params.len() != 2 {
            return Err(400);
        }
        Ok(Some(Input::Code(code.clone())))
    }
}
fn respond(
    stream: &mut TcpStream,
    (status, outcome): Refusal,
    locale: &str,
    return_path: Option<&str>,
) {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_write_timeout(Some(Duration::from_millis(250)));
    let _ = stream.write_all(&result_page::response(status, outcome, locale, return_path));
}
