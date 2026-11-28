//! Real local HTTP/loopback integration, with synthetic Supabase credentials.
//! No real browser, Keychain, account, or hosted endpoint is used.
use super::{
    callback,
    fixtures::MemoryStore,
    http::{Http, Remote},
    model::*,
    service::Broker,
    tests::wait,
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
            // A form without this attempt's state is not the login page; the
            // attempt keeps waiting for the real one.
            let forged = "state=wrong&refresh_token=synthetic-browser-refresh";
            let bad = format!(
                "POST /auth/session HTTP/1.1\r\nHost: {host}\r\nOrigin: http://evil.test\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: {}\r\n\r\n{forged}",
                forged.len()
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
        // N-21: the page offers to bring the app forward; the listener keeps
        // only that one-time path, and a used callback says it was used.
        let path = output
            .split(r#"action=""#)
            .nth(1)
            .and_then(|rest| rest.split('"').next())
            .unwrap()
            .to_owned();
        assert!(path.starts_with("/auth/return/"));
        let replay = send(&host, &request);
        assert!(replay.starts_with("HTTP/1.1 409") || replay.starts_with("HTTP/1.1 404"));
        let reveal = crate::cloud::auth::reveal_requests();
        let returned = send(
            &host,
            &format!("POST {path} HTTP/1.1\r\nHost: {host}\r\nContent-Length: 0\r\n\r\n"),
        );
        assert!(returned.starts_with("HTTP/1.1 204"));
        wait(|| reveal.try_recv().is_ok());
        assert_eq!(exchanges.load(Ordering::SeqCst), 1);
        broker.sign_out();
        wait(|| logged_out.load(Ordering::SeqCst) == 1 && vault.saved.lock().unwrap().is_none());
        assert_eq!(broker.subscribe().borrow().status, Status::SignedOut);
        broker.shutdown();
    }
}
#[test]
fn the_login_pages_rejected_handoff_fails_the_sign_in_at_once() {
    let server = Server::new(|origin| {
        Arc::new(move |_, path, _, _| match path {
            // The deployments answer inside their `{code, data}` envelope.
            "/api/v1/auth/config" => json(serde_json::json!({"code": 0, "message": "success",
                "data": {"supabase_url":origin,"supabase_anon_key":"sb_publishable_fixture"}})),
            "/auth/v1/settings" => json(serde_json::json!({"external":{"email":true}})),
            _ => panic!("a rejected handoff must not exchange credentials"),
        })
    });
    let (broker, browser) = Broker::new(
        server.environment(),
        Arc::new(Http::new().unwrap()),
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
    // The real page's state, from an origin this build does not pair with.
    let body = format!("state={}&refresh_token=t", params["desktop_state"]);
    let request = format!(
        "POST /auth/session HTTP/1.1\r\nHost: {host}\r\nOrigin: http://evil.test\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    );
    assert!(send(&host, &request).starts_with("HTTP/1.1 400"));
    wait(|| broker.subscribe().borrow().status == Status::SignedOut);
    assert_eq!(
        broker.subscribe().borrow().error,
        Some(Error::InvalidResponse)
    );
    wait(|| TcpStream::connect(&host).is_err());
    broker.shutdown();
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
    let remote = Arc::new(super::fixtures::FakeRemote::default());
    let (broker, browser) = Broker::new(
        super::fixtures::env(),
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
#[test]
fn managed_inference_posts_once_with_its_key_and_streams_the_reply() {
    let seen = Arc::new(Mutex::new(Vec::<(String, String, String)>::new()));
    let record = seen.clone();
    let server = Server::new(move |_| {
        Arc::new(move |method, path, headers, body| {
            let key = headers
                .iter()
                .find(|(k, _)| k.eq_ignore_ascii_case("idempotency-key"))
                .map(|(_, v)| v.to_string())
                .unwrap_or_default();
            record.lock().unwrap().push((
                format!("{method} {path}"),
                key,
                String::from_utf8_lossy(body).into_owned(),
            ));
            Response {
                status: 200,
                body: "data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\ndata: [DONE]\n\n"
                    .into(),
                extra: String::new(),
            }
        })
    });
    let env = server.environment();
    let session = Session::from_reply(
        env.clone(),
        AuthReply {
            user: Some(AuthUser {
                id: Some("u".into()),
                email: Some("u@example.test".into()),
            }),
            access_token: Secret("synthetic-access".into()),
            refresh_token: Some(Secret("synthetic-refresh".into())),
            expires_in: Some(3600.),
            user_id: None,
            user_email: None,
        },
    )
    .unwrap();
    let control = Control::new();
    let mut received = Vec::new();
    Http::new()
        .unwrap()
        .completion(
            &session,
            &serde_json::json!({"model": "m", "messages": []}),
            "11111111-1111-4111-8111-111111111111",
            &control.fence(),
            &mut |event| {
                if let super::StreamEvent::Data(bytes) = event {
                    received.extend_from_slice(bytes);
                }
                Ok(())
            },
        )
        .unwrap();
    assert!(String::from_utf8_lossy(&received).contains("[DONE]"));
    let seen = seen.lock().unwrap();
    assert_eq!(seen.len(), 1, "never retried");
    assert_eq!(seen[0].0, "POST /api/v1/ai/chat/completions");
    assert_eq!(seen[0].1, "11111111-1111-4111-8111-111111111111");
    assert!(seen[0].2.contains("\"model\":\"m\""));
}
/// `managedConnection.test.mjs` #15 (`keeps the server's protocol error and
/// reference through the Main proxy`) at the native transport: a refused
/// managed inference keeps the service's reviewed code and its reference
/// (the `X-Request-Id`), never its prose, and is sent once; a streamed one
/// names its reservation before its bytes.
#[test]
fn a_refused_inference_keeps_its_code_and_reference_and_a_reply_its_reservation() {
    let sent = Arc::new(AtomicUsize::new(0));
    let count = sent.clone();
    let server = Server::new(move |_| {
        Arc::new(move |_, _, headers, _| {
            count.fetch_add(1, Ordering::SeqCst);
            let refused = headers
                .iter()
                .any(|(k, v)| k.eq_ignore_ascii_case("x-request-id") && v.starts_with("refuse"));
            if refused {
                return Response {
                    status: 422,
                    body: serde_json::json!({"error": {
                        "code": "ai_request_invalid",
                        "message": "Invalid Agent request. Reference: reference-123",
                        "request_id": "reference-123",
                    }})
                    .to_string(),
                    extra: "X-Request-Id: reference-123\r\n".into(),
                };
            }
            Response {
                status: 200,
                body: "data: [DONE]\n\n".into(),
                extra: "X-Puppyone-Reservation-Id: 00000000-0000-4000-8000-000000000002\r\n".into(),
            }
        })
    });
    let env = server.environment();
    let session = Session::from_reply(
        env.clone(),
        AuthReply {
            user: Some(AuthUser {
                id: Some("u".into()),
                email: Some("u@example.test".into()),
            }),
            access_token: Secret("synthetic-access".into()),
            refresh_token: Some(Secret("synthetic-refresh".into())),
            expires_in: Some(3600.),
            user_id: None,
            user_email: None,
        },
    )
    .unwrap();
    let control = Control::new();
    let body = serde_json::json!({"model": "test/model"});
    let error = Http::new()
        .unwrap()
        .completion(&session, &body, "refuse-1", &control.fence(), &mut |_| {
            Ok(())
        })
        .unwrap_err();
    let Error::Response(422, Some("ai_request_invalid"), diagnostic) = error else {
        panic!("{error:?}");
    };
    assert_eq!(
        diagnostic
            .request_id
            .map(|r| r.as_str().to_owned())
            .as_deref(),
        Some("reference-123")
    );
    assert!(!format!("{error:?}").contains("Invalid Agent request"));
    assert_eq!(sent.load(Ordering::SeqCst), 1, "sent once");
    let mut events = Vec::new();
    Http::new()
        .unwrap()
        .completion(
            &session,
            &body,
            "stream-1",
            &control.fence(),
            &mut |event| {
                events.push(match event {
                    super::StreamEvent::Reservation(id) => format!("reservation {id}"),
                    super::StreamEvent::Connected => "connected".into(),
                    super::StreamEvent::Data(_) => "data".into(),
                });
                Ok(())
            },
        )
        .unwrap();
    assert_eq!(
        events[..2],
        [
            "reservation 00000000-0000-4000-8000-000000000002".to_string(),
            "connected".to_string()
        ]
    );
}
#[test]
fn billing_keys_with_scopes_reach_the_server_and_blank_keys_never_leave() {
    let seen = Arc::new(Mutex::new(Vec::<String>::new()));
    let record = seen.clone();
    let server = Server::new(move |_| {
        Arc::new(move |_, _, headers, _| {
            let header = |name: &str| {
                headers
                    .iter()
                    .find(|(k, _)| k.eq_ignore_ascii_case(name))
                    .map(|(_, v)| v.to_string())
                    .unwrap_or_default()
            };
            // Every API request names the repository contract it speaks
            // (Cloud refuses Git credential routes without it).
            assert_eq!(header("x-puppyone-repository-contract"), "2");
            record.lock().unwrap().push(header("idempotency-key"));
            json(serde_json::json!({}))
        })
    });
    let env = server.environment();
    let session = Session::from_reply(
        env.clone(),
        AuthReply {
            user: Some(AuthUser {
                id: Some("u".into()),
                email: Some("u@example.test".into()),
            }),
            access_token: Secret("synthetic-access".into()),
            refresh_token: Some(Secret("synthetic-refresh".into())),
            expires_in: Some(3600.),
            user_id: None,
            user_email: None,
        },
    )
    .unwrap();
    let control = Control::new();
    let request = |key: &str| ApiRequest {
        method: reqwest::Method::POST,
        path: "/billing/organizations/o/checkout".into(),
        query: vec![],
        body: Some(serde_json::json!({})),
        idempotency_key: Some(key.into()),
    };
    let key = "desktop:checkout:11111111-1111-4111-8111-111111111111";
    Http::new()
        .unwrap()
        .request(&session, &request(key), &control.fence())
        .unwrap();
    for bad in ["", "has space", &"k".repeat(256)] {
        assert_eq!(
            Http::new()
                .unwrap()
                .request(&session, &request(bad), &control.fence())
                .err(),
            Some(Error::Unsupported)
        );
    }
    assert_eq!(*seen.lock().unwrap(), vec![key.to_string()]);
}
/// The tunnel offers the token only as a subprotocol, takes `version.v1`
/// back, and carries bytes; a refused upgrade keeps its status.
#[allow(clippy::result_large_err)] // tungstenite's handshake callback
#[test]
fn a_host_tunnel_offers_the_token_as_a_subprotocol_and_carries_bytes() {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::{Message, handshake::server};
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let listener = runtime
        .block_on(tokio::net::TcpListener::bind("127.0.0.1:0"))
        .unwrap();
    let address = listener.local_addr().unwrap();
    let offered = Arc::new(Mutex::new(Vec::<String>::new()));
    let seen = offered.clone();
    runtime.spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            let seen = seen.clone();
            tokio::spawn(async move {
                let callback = |request: &server::Request, mut response: server::Response| {
                    let protocols = request
                        .headers()
                        .get("sec-websocket-protocol")
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or_default()
                        .to_owned();
                    seen.lock().unwrap().push(protocols.clone());
                    if !protocols.contains("version.bearer.synthetic-access") {
                        let mut refused = server::ErrorResponse::new(Some("{}".into()));
                        *refused.status_mut() = 403.try_into().unwrap();
                        return Err(refused);
                    }
                    response
                        .headers_mut()
                        .insert("sec-websocket-protocol", "version.v1".parse().unwrap());
                    Ok(response)
                };
                let Ok(mut socket) = tokio_tungstenite::accept_hdr_async(stream, callback).await
                else {
                    return;
                };
                while let Some(Ok(message)) = socket.next().await {
                    if message.is_binary() {
                        let _ = socket.send(message).await;
                    }
                }
            });
        }
    });
    let env = Environment::new(
        &format!("http://localhost:{}/api/v1", address.port()),
        "http://127.0.0.1:13000",
    )
    .unwrap();
    let session = |token: &str| {
        Session::from_reply(
            env.clone(),
            AuthReply {
                user: Some(AuthUser {
                    id: Some("u".into()),
                    email: Some("u@example.test".into()),
                }),
                access_token: Secret(token.into()),
                refresh_token: Some(Secret("synthetic-refresh".into())),
                expires_in: Some(3600.),
                user_id: None,
                user_email: None,
            },
        )
        .unwrap()
    };
    let url = url::Url::parse(&format!(
        "ws://localhost:{}/api/v1/hosts/folders/6f2c9f43-3c1b-4a8e-9c4e-1a2b3c4d5e6f/tunnel",
        address.port()
    ))
    .unwrap();
    assert!(super::service::tunnel_address(&url));
    let control = Control::new();
    let mut socket = Http::new()
        .unwrap()
        .host_tunnel(&session("synthetic-access"), &url, &control.fence())
        .unwrap();
    runtime.block_on(async {
        socket
            .send(Message::Binary(b"SSH-2.0-x\r\n".to_vec().into()))
            .await
            .unwrap();
        let echoed = socket.next().await.unwrap().unwrap();
        assert_eq!(echoed.into_data().as_ref(), b"SSH-2.0-x\r\n");
    });
    assert_eq!(
        offered.lock().unwrap()[0],
        "version.v1, version.bearer.synthetic-access"
    );
    let refused = Http::new()
        .unwrap()
        .host_tunnel(&session("someone-else"), &url, &control.fence())
        .err();
    assert_eq!(refused, Some(Error::Http(403)));
    // Only a folder's tunnel in the PuppyOne host family.
    for address in [
        "wss://api.example.com/api/v1/hosts/folders/6f2c9f43-3c1b-4a8e-9c4e-1a2b3c4d5e6f/tunnel",
        "ws://api.puppyone.ai/api/v1/hosts/folders/6f2c9f43-3c1b-4a8e-9c4e-1a2b3c4d5e6f/tunnel",
        "wss://api.puppyone.ai/api/v1/hosts/folders/../tunnel",
        "wss://api.puppyone.ai/api/v1/hosts/folders/6f2c9f43-3c1b-4a8e-9c4e-1a2b3c4d5e6f/tunnel?x=1",
        "https://api.puppyone.ai/api/v1/hosts/folders/6f2c9f43-3c1b-4a8e-9c4e-1a2b3c4d5e6f/tunnel",
    ] {
        assert!(
            !super::service::tunnel_address(&url::Url::parse(address).unwrap()),
            "{address}"
        );
    }
    assert!(super::service::tunnel_address(
        &url::Url::parse(
            "wss://gateway.puppyone.ai/api/v1/hosts/folders/6f2c9f43-3c1b-4a8e-9c4e-1a2b3c4d5e6f/tunnel"
        )
        .unwrap()
    ));
}

fn api_session(env: &Environment) -> Session {
    Session::from_reply(
        env.clone(),
        AuthReply {
            user: Some(AuthUser {
                id: Some("u".into()),
                email: Some("u@example.test".into()),
            }),
            access_token: Secret("synthetic-access".into()),
            refresh_token: Some(Secret("synthetic-refresh".into())),
            expires_in: Some(3600.),
            user_id: None,
            user_email: None,
        },
    )
    .unwrap()
}
fn get(path: &str) -> ApiRequest {
    ApiRequest {
        idempotency_key: None,
        method: reqwest::Method::GET,
        path: path.into(),
        query: Vec::new(),
        body: None,
    }
}
/// `electron.cloud-api-client.test.mjs` (error transport), through the real
/// adapter: a refusal keeps the server's allowlisted code, its retry decision
/// and a plain request id, never an id that is not a token; a 409's safe
/// `data.code` is kept rather than classified with every 409; a Cloud that
/// cannot be reached is unavailable.
#[test]
fn api_refusals_keep_their_safe_code_retry_decision_and_plain_request_id() {
    let server = Server::new(move |_| {
        Arc::new(move |_, path, _, _| {
            match path {
            "/api/v1/projects/p/workbench" => Response {
                status: 503,
                body: serde_json::json!({"code": 5000, "message": "Request failed", "data": {"code": "workbench_connection_timeout", "retryable": true}}).to_string(),
                extra: "X-Request-Id: req-123\r\n".into(),
            },
            "/api/v1/projects/p/initialization/abandon" => Response {
                status: 409,
                body: serde_json::json!({"message": "The Project already accepted its first push.", "data": {"code": "initialization_not_abandonable"}}).to_string(),
                extra: String::new(),
            },
            _ => Response {
                status: 500,
                body: "{}".into(),
                extra: "X-Request-Id: two words\r\n".into(),
            },
        }
        })
    });
    let env = server.environment();
    let session = api_session(&env);
    let control = Control::new();
    let http = Http::new().unwrap();
    let Some(Error::Response(503, Some("workbench_connection_timeout"), diagnostic)) = http
        .request(&session, &get("/projects/p/workbench"), &control.fence())
        .err()
    else {
        panic!("expected the server's code");
    };
    assert_eq!(diagnostic.retryable, Some(true));
    assert_eq!(
        diagnostic.request_id.map(|id| id.as_str().to_owned()),
        Some("req-123".into())
    );
    let Some(Error::Response(500, None, diagnostic)) = http
        .request(&session, &get("/projects/p/other"), &control.fence())
        .err()
    else {
        panic!("expected a plain server error");
    };
    assert!(diagnostic.request_id.is_none() && diagnostic.retryable.is_none());
    let abandon = ApiRequest {
        method: reqwest::Method::POST,
        ..get("/projects/p/initialization/abandon")
    };
    assert!(matches!(
        http.request(&session, &abandon, &control.fence()).err(),
        Some(Error::Response(
            409,
            Some("initialization_not_abandonable"),
            _
        ))
    ));
    // Nothing listens on a port just given back: Cloud cannot be reached.
    let closed = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap();
    let unreachable =
        Environment::new(&format!("http://{closed}/api/v1"), "http://127.0.0.1:13000").unwrap();
    assert_eq!(
        http.request(
            &api_session(&unreachable),
            &get("/projects/p/workbench"),
            &control.fence()
        )
        .err(),
        Some(Error::Unavailable)
    );
}
/// `electron.cloud-api-client.test.mjs`: "preserves timeout semantics when
/// the response body aborts after headers" — a reply whose body stops after
/// its headers times out like one that never answers (the 15 s budget).
#[test]
fn a_body_that_stalls_after_its_headers_times_out() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let stop = Arc::new(AtomicBool::new(false));
    let flag = stop.clone();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut bytes = [0u8; 4096];
        let _ = stream.read(&mut bytes);
        let _ = stream.write_all(
            b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 64\r\n\r\n{\"data\":",
        );
        while !flag.load(Ordering::SeqCst) {
            std::thread::sleep(Duration::from_millis(20));
        }
    });
    let env = Environment::new(
        &format!("http://{address}/api/v1"),
        "http://127.0.0.1:13000",
    )
    .unwrap();
    let control = Control::new();
    let result = Http::new().unwrap().request(
        &api_session(&env),
        &get("/projects/p/repository-context"),
        &control.fence(),
    );
    stop.store(true, Ordering::SeqCst);
    server.join().unwrap();
    assert_eq!(result.err(), Some(Error::Timeout));
}
/// `electron.cloud-auth-service.test.mjs`: "preserves the caller's
/// cancellation signal on an authenticated wallet request" — cancelling a
/// request that is still waiting for its answer ends it at once.
#[test]
fn a_caller_cancellation_ends_an_authenticated_request_at_once() {
    let arrived = Arc::new(AtomicBool::new(false));
    let observed = arrived.clone();
    let server = Server::new(move |_| {
        Arc::new(move |_, _, _, _| {
            observed.store(true, Ordering::SeqCst);
            std::thread::sleep(Duration::from_millis(1500));
            json(serde_json::json!({"balance": 1}))
        })
    });
    let env = server.environment();
    let control = Control::new();
    let cancel = super::Cancellation::default();
    let mut fence = control.fence();
    fence.cancel = Some(cancel.clone());
    let session = api_session(&env);
    let started = std::time::Instant::now();
    let worker = std::thread::spawn(move || {
        Http::new()
            .unwrap()
            .request(&session, &get("/ai/balance"), &fence)
    });
    wait(|| arrived.load(Ordering::SeqCst));
    cancel.cancel();
    assert_eq!(worker.join().unwrap().err(), Some(Error::Cancelled));
    assert!(started.elapsed() < Duration::from_millis(1200));
}
/// `electron.cloud-auth-service.test.mjs`: "keeps Agent bearer auth in Main
/// and aborts the open stream on sign-out" — the inference stream carries
/// the bearer and its request id as idempotency key and request id, and a
/// change of account ends the open stream.
#[test]
fn an_open_inference_stream_carries_its_ids_and_ends_when_the_account_changes() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let headers = Arc::new(Mutex::new(String::new()));
    let seen = headers.clone();
    let stop = Arc::new(AtomicBool::new(false));
    let flag = stop.clone();
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut bytes = [0u8; 8192];
        let n = stream.read(&mut bytes).unwrap();
        *seen.lock().unwrap() = String::from_utf8_lossy(&bytes[..n]).into_owned();
        let _ = stream.write_all(
            b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\ndata: started\n\n",
        );
        while !flag.load(Ordering::SeqCst) {
            std::thread::sleep(Duration::from_millis(20));
        }
    });
    let env = Environment::new(
        &format!("http://{address}/api/v1"),
        "http://127.0.0.1:13000",
    )
    .unwrap();
    let control = Control::new();
    let fence = control.fence();
    let session = api_session(&env);
    let started = Arc::new(AtomicBool::new(false));
    let opened = started.clone();
    let worker = std::thread::spawn(move || {
        Http::new().unwrap().completion(
            &session,
            &serde_json::json!({"model": "test/model"}),
            "test-inference-001",
            &fence,
            &mut |event| {
                if let super::StreamEvent::Data(_) = event {
                    opened.store(true, Ordering::SeqCst);
                }
                Ok(())
            },
        )
    });
    wait(|| started.load(Ordering::SeqCst));
    control.advance();
    assert_eq!(worker.join().unwrap().err(), Some(Error::SessionChanged));
    stop.store(true, Ordering::SeqCst);
    server.join().unwrap();
    let request = headers.lock().unwrap().to_ascii_lowercase();
    assert!(request.starts_with("post /api/v1/ai/chat/completions "));
    assert!(request.contains("authorization: bearer synthetic-access"));
    assert!(request.contains("idempotency-key: test-inference-001"));
    assert!(request.contains("x-request-id: test-inference-001"));
}
