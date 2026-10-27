//! Temporary IP-loopback receiver. Only credentials from a validated, single-use
//! top-level form or a PKCE code are accepted; no CORS, token URL, or login form.
use super::{model::*, service::Broker};
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

pub(super) fn run(broker: &Arc<Broker>, environment: Environment, fence: &Fence) -> Result<()> {
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
            // Consume before exchange, even if the provider later rejects it.
            let result =
                broker.complete_login(environment.clone(), candidate.input, &verifier, fence);
            respond(
                &mut candidate.stream,
                if result.is_ok() { 200 } else { 400 },
            );
            break result;
        }
        workers.retain(|worker| !worker.is_finished());
        match listener.accept() {
            Ok((mut stream, peer)) => {
                if !peer.ip().is_loopback() || workers.len() >= 8 {
                    respond(&mut stream, 503);
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
                                respond(&mut candidate.stream, 409);
                            }
                        }
                        Err(status) => respond(&mut stream, status),
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
        respond(&mut candidate.stream, 409);
    }
    result
}
fn receive(
    stream: &mut TcpStream,
    host: &str,
    origin: &str,
    state: &str,
    fence: &Fence,
    stopped: &AtomicBool,
) -> std::result::Result<Input, u16> {
    stream.set_nonblocking(true).map_err(|_| 400u16)?;
    let deadline = Instant::now() + Duration::from_secs(5);
    let mut bytes = zeroize::Zeroizing::new(Vec::new());
    loop {
        if stopped.load(Ordering::SeqCst) || fence.check().is_err() {
            return Err(409);
        }
        if Instant::now() >= deadline {
            return Err(408);
        }
        let mut chunk = zeroize::Zeroizing::new([0u8; 2048]);
        match stream.read(chunk.as_mut()) {
            Ok(0) => return Err(400),
            Ok(n) => {
                bytes.extend_from_slice(&chunk[..n]);
                if bytes.len() > 24 * 1024 {
                    return Err(413);
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(10));
                continue;
            }
            Err(_) => return Err(400),
        }
        match parse(&bytes, host, origin, state)? {
            Some(input) => return Ok(input),
            None => continue,
        }
    }
}
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
    let query = if request.method == Some("POST") && target == "/auth/session" {
        if one_header("origin")? != Some(origin)
            || one_header("content-type")?.and_then(|v| v.split(';').next())
                != Some("application/x-www-form-urlencoded")
        {
            return Err(400);
        }
        &bytes[offset..]
    } else if request.method == Some("GET")
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
    if one("state").map(|s| s.0.as_str()) != Some(expected) {
        return Err(400);
    }
    if request.method == Some("POST") {
        if params.len() != 2 {
            return Err(400);
        }
        let token = one("refresh_token").filter(|s| s.valid()).ok_or(400u16)?;
        Ok(Some(Input::Refresh(token.clone())))
    } else {
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
fn respond(stream: &mut TcpStream, status: u16) {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_write_timeout(Some(Duration::from_millis(250)));
    let body = if status == 200 {
        "Sign-in complete. You can close this page and return to Puppyone."
    } else {
        "This sign-in request could not be completed. Return to Puppyone and start again."
    };
    let response = format!(
        "HTTP/1.1 {status} Result\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: private, no-store\r\nReferrer-Policy: no-referrer\r\nContent-Security-Policy: default-src 'none'; frame-ancestors 'none'\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
}
