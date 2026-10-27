//! Real local HTTP/loopback integration, with synthetic Supabase credentials.
//! No real browser, Keychain, account, or hosted endpoint is used.
use super::{
    callback,
    http::{Http, Remote},
    model::*,
    service::Broker,
    tests::{MemoryStore, wait},
};
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::Duration,
};

struct Response {
    status: u16,
    body: String,
    extra: String,
}
fn json(value: serde_json::Value) -> Response {
    Response {
        status: 200,
        body: value.to_string(),
        extra: String::new(),
    }
}
type Handler = Arc<dyn Fn(&str, &str, &[(&str, &str)], &[u8]) -> Response + Send + Sync>;
struct Server {
    address: std::net::SocketAddr,
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}
impl Server {
    fn new(factory: impl FnOnce(String) -> Handler) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        listener.set_nonblocking(true).unwrap();
        let handler = factory(format!("http://{address}"));
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let thread = std::thread::spawn(move || {
            while !flag.load(Ordering::SeqCst) {
                let Ok((mut stream, _)) = listener.accept() else {
                    std::thread::sleep(Duration::from_millis(5));
                    continue;
                };
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut raw = Vec::new();
                loop {
                    let mut bytes = [0u8; 2048];
                    let Ok(n) = stream.read(&mut bytes) else {
                        break;
                    };
                    if n == 0 {
                        break;
                    }
                    raw.extend_from_slice(&bytes[..n]);
                    if raw.len() > 128 * 1024 {
                        break;
                    }
                    let mut headers = [httparse::EMPTY_HEADER; 32];
                    let mut request = httparse::Request::new(&mut headers);
                    let Ok(httparse::Status::Complete(offset)) = request.parse(&raw) else {
                        continue;
                    };
                    let headers: Vec<_> = request
                        .headers
                        .iter()
                        .map(|h| (h.name, std::str::from_utf8(h.value).unwrap()))
                        .collect();
                    let length = headers
                        .iter()
                        .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
                        .map(|(_, v)| v.parse::<usize>().unwrap())
                        .unwrap_or(0);
                    if raw.len() < offset + length {
                        continue;
                    }
                    let response = handler(
                        request.method.unwrap(),
                        request.path.unwrap(),
                        &headers,
                        &raw[offset..offset + length],
                    );
                    let output = format!(
                        "HTTP/1.1 {} Result\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n{}\r\n{}",
                        response.status,
                        response.body.len(),
                        response.extra,
                        response.body
                    );
                    let _ = stream.write_all(output.as_bytes());
                    break;
                }
            }
        });
        Self {
            address,
            stop,
            thread: Some(thread),
        }
    }
    fn environment(&self) -> Environment {
        Environment::new(
            &format!("http://{}/api/v1", self.address),
            "http://127.0.0.1:13000",
        )
        .unwrap()
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = self.thread.take().unwrap().join();
    }
}
fn auth_reply() -> serde_json::Value {
    serde_json::json!({"access_token":"synthetic-access", "refresh_token":"synthetic-rotated-refresh", "expires_in":3600, "user":{"id":"fixture-user", "email":"fixture@example.test"}})
}
fn send(address: &str, request: &str) -> String {
    let mut stream = TcpStream::connect(address).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(4)))
        .unwrap();
    stream.write_all(request.as_bytes()).unwrap();
    let mut output = String::new();
    stream.read_to_string(&mut output).unwrap();
    output
}
fn browser_event(receiver: &async_channel::Receiver<super::service::BrowserEvent>) -> url::Url {
    let mut event = None;
    wait(|| {
        event = receiver.try_recv().ok();
        event.is_some()
    });
    url::Url::parse(&event.unwrap().url).unwrap()
}
#[test]
fn native_pkce_and_email_handoffs_use_the_real_http_adapter_once() {
    for email in [false, true] {
        let expected = Arc::new(Mutex::new(String::new()));
        let challenge = expected.clone();
        let exchanges = Arc::new(AtomicUsize::new(0));
        let count = exchanges.clone();
        let initialized = Arc::new(AtomicUsize::new(0));
        let init = initialized.clone();
        let logged_out = Arc::new(AtomicUsize::new(0));
        let logout_count = logged_out.clone();
        let server = Server::new(move |origin| {
            Arc::new(move |method, path, headers, body| {
                assert!(
                    headers
                        .iter()
                        .any(|(k, v)| k.eq_ignore_ascii_case("cache-control") && *v == "no-store")
                );
                match path {
                    "/api/v1/auth/config" => json(
                        serde_json::json!({"supabase_url":origin, "supabase_anon_key":"sb_publishable_fixture"}),
                    ),
                    "/auth/v1/settings" => {
                        json(serde_json::json!({"external":{"email":true,"google":true}}))
                    }
                    "/auth/v1/token?grant_type=pkce"
                    | "/auth/v1/token?grant_type=refresh_token" => {
                        assert_eq!(method, "POST");
                        count.fetch_add(1, Ordering::SeqCst);
                        assert!(headers.iter().any(|(k, v)| k.eq_ignore_ascii_case("apikey")
                            && *v == "sb_publishable_fixture"));
                        let value: serde_json::Value = serde_json::from_slice(body).unwrap();
                        if email {
                            assert_eq!(value["refresh_token"], "synthetic-browser-refresh");
                        } else {
                            assert_eq!(value["auth_code"], "synthetic-code");
                            assert_eq!(
                                callback::challenge(value["code_verifier"].as_str().unwrap()),
                                *challenge.lock().unwrap()
                            );
                        }
                        json(auth_reply())
                    }
                    "/api/v1/auth/initialize" => {
                        init.fetch_add(1, Ordering::SeqCst);
                        assert!(
                            headers
                                .iter()
                                .any(|(k, v)| k.eq_ignore_ascii_case("authorization")
                                    && *v == "Bearer synthetic-access")
                        );
                        json(serde_json::json!({"ok":true}))
                    }
                    "/auth/v1/logout?scope=local" => {
                        assert_eq!(method, "POST");
                        assert!(
                            headers
                                .iter()
                                .any(|(k, v)| k.eq_ignore_ascii_case("authorization")
                                    && *v == "Bearer synthetic-access")
                        );
                        logout_count.fetch_add(1, Ordering::SeqCst);
                        Response {
                            status: 204,
                            body: String::new(),
                            extra: String::new(),
                        }
                    }
                    _ => panic!("unexpected fixture route"),
                }
            })
        });
        let vault = Arc::new(MemoryStore::default());
        let (broker, browser) = Broker::new(
            server.environment(),
            Arc::new(Http::new().unwrap()),
            vault.clone(),
        );
        broker.sign_in();
        let url = browser_event(&browser);
        let params: std::collections::HashMap<_, _> = url
            .query_pairs()
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect();
        assert_eq!(url.path(), "/login");
        assert!(!params.contains_key("code_verifier"));
        assert!(!params.contains_key("refresh_token"));
        *expected.lock().unwrap() = params["code_challenge"].clone();
        let callback = url::Url::parse(&params["desktop_callback"]).unwrap();
        let host = format!("127.0.0.1:{}", callback.port().unwrap());
        let invalid =
            format!("GET /auth/callback?state=wrong&code=bad HTTP/1.1\r\nHost: {host}\r\n\r\n");
        assert!(send(&host, &invalid).starts_with("HTTP/1.1 400"));
        assert_eq!(exchanges.load(Ordering::SeqCst), 0);
        let request = if email {
            let body = format!(
                "state={}&refresh_token=synthetic-browser-refresh",
                params["desktop_state"]
            );
            let bad = format!(
                "POST /auth/session HTTP/1.1\r\nHost: {host}\r\nOrigin: http://evil.test\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: {}\r\n\r\n{body}",
                body.len()
            );
            assert!(send(&host, &bad).starts_with("HTTP/1.1 400"));
            format!(
                "POST /auth/session HTTP/1.1\r\nHost: {host}\r\nOrigin: http://127.0.0.1:13000\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: {}\r\n\r\n{body}",
                body.len()
            )
        } else {
            format!(
                "GET /auth/callback?state={}&code=synthetic-code HTTP/1.1\r\nHost: {host}\r\n\r\n",
                params["desktop_state"]
            )
        };
        let output = send(&host, &request);
        assert!(output.starts_with("HTTP/1.1 200"));
        assert!(output.contains("no-store"));
        assert!(output.contains("no-referrer"));
        assert!(!output.contains("synthetic-access"));
        wait(|| broker.subscribe().borrow().status == Status::Authenticated);
        assert_eq!(exchanges.load(Ordering::SeqCst), 1);
        assert_eq!(initialized.load(Ordering::SeqCst), 1);
        assert_eq!(
            vault.saved.lock().unwrap().as_ref().unwrap().user,
            "fixture-user"
        );
        // A completed callback either rejects at the receiver or finds its port closed.
        wait(|| TcpStream::connect(&host).is_err());
        assert_eq!(exchanges.load(Ordering::SeqCst), 1);
        broker.sign_out();
        wait(|| logged_out.load(Ordering::SeqCst) == 1 && vault.saved.lock().unwrap().is_none());
        assert_eq!(broker.subscribe().borrow().status, Status::SignedOut);
        broker.shutdown();
    }
}
#[test]
fn cancelling_a_native_attempt_closes_the_listener_and_fences_late_callbacks() {
    let server = Server::new(|origin| {
        Arc::new(move |_, path, _, _| match path {
            "/api/v1/auth/config" => json(
                serde_json::json!({"supabase_url":origin,"supabase_anon_key":"sb_publishable_fixture"}),
            ),
            "/auth/v1/settings" => json(serde_json::json!({"external":{"email":true}})),
            _ => panic!("cancelled attempt must not exchange credentials"),
        })
    });
    let (broker, browser) = Broker::new(
        server.environment(),
        Arc::new(Http::new().unwrap()),
        Arc::new(MemoryStore::default()),
    );
    broker.sign_in();
    let url = browser_event(&browser);
    broker.reopen();
    let again = browser_event(&browser);
    assert_eq!(again, url);
    let callback = url
        .query_pairs()
        .find(|(k, _)| k == "desktop_callback")
        .unwrap()
        .1
        .into_owned();
    let callback = url::Url::parse(&callback).unwrap();
    let address = format!("127.0.0.1:{}", callback.port().unwrap());
    broker.cancel();
    wait(|| TcpStream::connect(&address).is_err());
    assert!(broker.subscribe().borrow().account.is_none());
    broker.shutdown();
}
#[test]
fn concurrent_callbacks_dispatch_only_one_exchange() {
    let remote = Arc::new(super::tests::FakeRemote::default());
    let (broker, browser) = Broker::new(
        super::tests::env(),
        remote.clone(),
        Arc::new(MemoryStore::default()),
    );
    broker.sign_in();
    let url = browser_event(&browser);
    let params: std::collections::HashMap<_, _> = url
        .query_pairs()
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    let callback = url::Url::parse(&params["desktop_callback"]).unwrap();
    let host = format!("127.0.0.1:{}", callback.port().unwrap());
    let request = format!(
        "GET /auth/callback?state={}&code=alice HTTP/1.1\r\nHost: {host}\r\n\r\n",
        params["desktop_state"]
    );
    let start = Arc::new(std::sync::Barrier::new(9));
    let threads: Vec<_> = (0..8)
        .map(|_| {
            let (host, request, start) = (host.clone(), request.clone(), start.clone());
            std::thread::spawn(move || {
                start.wait();
                TcpStream::connect(host).and_then(|mut stream| {
                    stream.set_read_timeout(Some(Duration::from_secs(3)))?;
                    stream.write_all(request.as_bytes())?;
                    let mut response = String::new();
                    stream.read_to_string(&mut response)?;
                    Ok(response)
                })
            })
        })
        .collect();
    start.wait();
    let replies: Vec<_> = threads.into_iter().map(|t| t.join().unwrap()).collect();
    assert_eq!(
        replies
            .iter()
            .filter(|r| r.as_ref().is_ok_and(|r| r.starts_with("HTTP/1.1 200")))
            .count(),
        1
    );
    assert_eq!(remote.exchanges.load(Ordering::SeqCst), 1);
    broker.shutdown();
}

#[test]
fn transport_rejects_redirects_and_privileged_or_oversized_configurations() {
    let leaked = Arc::new(AtomicUsize::new(0));
    let count = leaked.clone();
    let destination = Server::new(move |_| {
        Arc::new(move |_, _, _, _| {
            count.fetch_add(1, Ordering::SeqCst);
            json(auth_reply())
        })
    });
    let address = destination.address;
    let server = Server::new(move |_| {
        Arc::new(move |_, _, _, _| Response {
            status: 307,
            body: "{}".into(),
            extra: format!("Location: http://{address}/leak\r\n"),
        })
    });
    let control = Control::new();
    assert!(
        Http::new()
            .unwrap()
            .providers(&server.environment(), &control.fence())
            .is_err()
    );
    assert_eq!(leaked.load(Ordering::SeqCst), 0);
    for key in ["service_role_secret".to_owned(), "a".repeat(70 * 1024)] {
        let server = Server::new(move |origin| {
            Arc::new(move |_, _, _, _| {
                json(serde_json::json!({"supabase_url":origin,"supabase_anon_key":key}))
            })
        });
        assert!(
            Http::new()
                .unwrap()
                .providers(&server.environment(), &control.fence())
                .is_err()
        );
    }
}
#[test]
fn disabled_providers_and_rejected_pkce_never_publish_or_persist_a_session() {
    for enabled in [false, true] {
        let server = Server::new(move |origin| {
            Arc::new(move |_, path, _, _| {
                match path {
            "/api/v1/auth/config" => json(serde_json::json!({"supabase_url":origin,"supabase_anon_key":"sb_publishable_fixture"})),
            "/auth/v1/settings" => json(serde_json::json!({"external":{"google":enabled}})),
            "/auth/v1/token?grant_type=pkce" => Response { status: 400, body: r#"{"error_code":"invalid_grant","message":"upstream-secret-must-not-be-displayed"}"#.into(), extra: String::new() },
            _ => panic!("failed sign-in must not initialize an account"),
        }
            })
        });
        let store = Arc::new(MemoryStore::default());
        let (broker, browser) = Broker::new(
            server.environment(),
            Arc::new(Http::new().unwrap()),
            store.clone(),
        );
        broker.sign_in();
        if enabled {
            let url = browser_event(&browser);
            let params: std::collections::HashMap<_, _> = url
                .query_pairs()
                .map(|(k, v)| (k.into_owned(), v.into_owned()))
                .collect();
            let callback = url::Url::parse(&params["desktop_callback"]).unwrap();
            let host = format!("127.0.0.1:{}", callback.port().unwrap());
            let response = send(
                &host,
                &format!(
                    "GET /auth/callback?state={}&code=invalid-code HTTP/1.1\r\nHost: {host}\r\n\r\n",
                    params["desktop_state"]
                ),
            );
            assert!(response.starts_with("HTTP/1.1 400") && !response.contains("upstream-secret"));
        }
        wait(|| broker.subscribe().borrow().error.is_some());
        let public = broker.subscribe().borrow().clone();
        assert_eq!(public.status, Status::SignedOut);
        assert!(public.account.is_none());
        assert_eq!(
            public.error,
            Some(if enabled {
                Error::InvalidCredentials
            } else {
                Error::NoProviders
            })
        );
        assert!(store.saved.lock().unwrap().is_none());
        assert!(browser.try_recv().is_err());
        broker.shutdown();
    }
}

#[test]
fn revocation_interrupts_http_wait_and_deadline_fails_closed() {
    let arrived = Arc::new(AtomicBool::new(false));
    let observed = arrived.clone();
    let server = Server::new(move |_| {
        Arc::new(move |_, _, _, _| {
            observed.store(true, Ordering::SeqCst);
            std::thread::sleep(Duration::from_millis(500));
            json(serde_json::json!({}))
        })
    });
    let control = Control::new();
    let fence = control.fence();
    let env = server.environment();
    let worker = std::thread::spawn(move || Http::new().unwrap().providers(&env, &fence));
    wait(|| arrived.load(Ordering::SeqCst));
    control.advance();
    assert_eq!(worker.join().unwrap().err(), Some(Error::SessionChanged));
    let mut expired = control.fence();
    expired.deadline = Some(std::time::Instant::now());
    assert_eq!(
        Http::new()
            .unwrap()
            .providers(&server.environment(), &expired)
            .err(),
        Some(Error::Expired)
    );
}
