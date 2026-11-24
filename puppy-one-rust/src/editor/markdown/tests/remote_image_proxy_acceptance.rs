//! Remote Markdown images through a system proxy whose DNS answers with
//! fake-IP addresses (Clash, Surge): the image loads through the proxy, and
//! without the proxy the same answer stays blocked.
//!
//! A local HTTP CONNECT proxy stub tunnels to a local HTTPS server holding
//! a test-only certificate for `img.example`.
use super::setup_with_focus;
use crate::editor::markdown::platform::{
    brokers::assets::{self, AssetState},
    policy::{AssetFailure, network::fake},
};
use crate::editor::markdown::shared::media::MediaSource;
use gpui::TestAppContext;
use image::RgbaImage;
use rustls::pki_types::{CertificateDer, PrivateKeyDer, pem::PemObject};
use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    sync::{Arc, Mutex},
    thread,
};

// A self-signed P-256 certificate and key for the fictional host
// `img.example` (valid until 2046). Test-only: they secure nothing.
const CERT: &[u8] = b"-----BEGIN CERTIFICATE-----
MIIBvTCCAWOgAwIBAgIUTCjpGJDgyZOwHv6/J5P+Cox9NNAwCgYIKoZIzj0EAwIw
FjEUMBIGA1UEAwwLaW1nLmV4YW1wbGUwHhcNMjYxMTIzMTIzMTMwWhcNNDYxMTE4
MTIzMTMwWjAWMRQwEgYDVQQDDAtpbWcuZXhhbXBsZTBZMBMGByqGSM49AgEGCCqG
SM49AwEHA0IABD/Wzzr4VRDOiyXTGoU8zrQM4gRVyXfDfIVEsVECgnu4ta9W1Iaz
80VQSPLTQ1kZ4HKZ/7hNTlojtYuThIjZ/tGjgY4wgYswHQYDVR0OBBYEFG1Eofob
5q1DlUqpQFH4VEFsxpmyMB8GA1UdIwQYMBaAFG1Eofob5q1DlUqpQFH4VEFsxpmy
MBYGA1UdEQQPMA2CC2ltZy5leGFtcGxlMAwGA1UdEwEB/wQCMAAwDgYDVR0PAQH/
BAQDAgeAMBMGA1UdJQQMMAoGCCsGAQUFBwMBMAoGCCqGSM49BAMCA0gAMEUCIFfK
qtBeO7jqpo1+faCQH4S8aRh6ZN5LplZCgs0E9Z7QAiEA8DMVV3diU8gS29syX1Tt
BvteYIlbteuO8JrgWJ5cmx8=
-----END CERTIFICATE-----
";
const KEY: &[u8] = b"-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgYrEHpCksle1KjyKC
EJJM2QzPg1bqrWorQXVEfOIOWtyhRANCAAQ/1s86+FUQzosl0xqFPM60DOIEVcl3
w3yFRLFRAoJ7uLWvVtSGs/NFUEjy00NZGeBymf+4TU5aI7WLk4SI2f7R
-----END PRIVATE KEY-----
";

fn red_png(width: u32, height: u32) -> Vec<u8> {
    let mut buf = Vec::new();
    RgbaImage::from_pixel(width, height, image::Rgba([255, 0, 0, 255]))
        .write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png)
        .unwrap();
    buf
}

/// Reads one request head (through the blank line).
fn read_head(stream: &mut impl Read) -> String {
    let mut head = Vec::new();
    let mut byte = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") {
        if stream.read(&mut byte).unwrap_or(0) == 0 {
            break;
        }
        head.push(byte[0]);
    }
    String::from_utf8_lossy(&head).into_owned()
}

/// An HTTPS server for `img.example` answering every request with `png`.
fn serve_https(png: Vec<u8>) -> SocketAddr {
    let certs = vec![CertificateDer::from_pem_slice(CERT).unwrap()];
    let key = PrivateKeyDer::from_pem_slice(KEY).unwrap();
    let config = Arc::new(
        rustls::ServerConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(certs, key)
        .unwrap(),
    );
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    thread::spawn(move || {
        for tcp in listener.incoming().flatten() {
            let config = config.clone();
            let png = png.clone();
            thread::spawn(move || {
                let Ok(conn) = rustls::ServerConnection::new(config) else {
                    return;
                };
                let mut tls = rustls::StreamOwned::new(conn, tcp);
                let _ = read_head(&mut tls);
                let head = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    png.len()
                );
                let _ = tls.write_all(head.as_bytes());
                let _ = tls.write_all(&png);
                let _ = tls.flush();
                tls.conn.send_close_notify();
                let _ = tls.flush();
            });
        }
    });
    addr
}

/// An HTTP CONNECT proxy that records each tunnel's target and connects it
/// to `upstream`: it resolves names itself, as a fake-IP proxy does.
fn serve_connect_proxy(upstream: SocketAddr) -> (SocketAddr, Arc<Mutex<Vec<String>>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let targets = Arc::new(Mutex::new(Vec::new()));
    let seen = targets.clone();
    thread::spawn(move || {
        for mut client in listener.incoming().flatten() {
            let seen = seen.clone();
            thread::spawn(move || {
                let head = read_head(&mut client);
                let request = head.lines().next().unwrap_or_default().to_owned();
                seen.lock().unwrap().push(request.clone());
                if !request.starts_with("CONNECT ") {
                    let _ = client.write_all(b"HTTP/1.1 405 Method Not Allowed\r\n\r\n");
                    return;
                }
                let Ok(server) = TcpStream::connect(upstream) else {
                    return;
                };
                let _ = client.write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n");
                let (mut client_read, mut server_write) =
                    (client.try_clone().unwrap(), server.try_clone().unwrap());
                let pump = thread::spawn(move || {
                    let _ = std::io::copy(&mut client_read, &mut server_write);
                    let _ = server_write.shutdown(std::net::Shutdown::Write);
                });
                let (mut server_read, mut client_write) = (server, client);
                let _ = std::io::copy(&mut server_read, &mut client_write);
                let _ = client_write.shutdown(std::net::Shutdown::Write);
                let _ = pump.join();
            });
        }
    });
    (addr, targets)
}

fn state_name<I>(state: &AssetState<I>) -> String {
    match state {
        AssetState::Loading => "Loading".into(),
        AssetState::Ready { .. } => "Ready".into(),
        AssetState::Failed(failure) => format!("Failed({failure:?})"),
    }
}

/// P0 #6: with the system proxy set and DNS answering `198.18.0.37`, a remote
/// Markdown image loads through the proxy and is drawn at its own size; the
/// same answer without a proxy stays blocked and never reaches the proxy.
#[gpui::test]
fn remote_markdown_image_loads_through_a_proxy_with_fake_ip_dns(cx: &mut TestAppContext) {
    cx.executor().allow_parking();
    let https = serve_https(red_png(40, 20));
    let (proxy, targets) = serve_connect_proxy(https);
    fake::trust(CERT);
    fake::set_host(
        "img.example",
        Some(&format!("http://{proxy}")),
        &["198.18.0.37"],
    );
    // Control: the same fake-IP answer without a proxy.
    fake::set_host("direct.example", None, &["198.18.0.38"]);

    let proxied = "https://img.example/badge.png";
    let direct = "https://direct.example/badge.png";
    let markdown = format!("![badge]({proxied}) ![direct]({direct})\n\nend");
    let (_view, visual) = setup_with_focus(cx, &markdown, false);
    let get = |visual: &mut gpui::VisualTestContext, href: &str| {
        visual.update(|_, cx| assets::get(&MediaSource::Remote(href.into()), None, cx))
    };
    for _ in 0..40 {
        visual.update(|w, cx| w.draw(cx).clear(cx));
        visual.run_until_parked();
        if !matches!(get(visual, proxied), AssetState::Loading)
            && !matches!(get(visual, direct), AssetState::Loading)
        {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
    visual.update(|w, cx| w.draw(cx).clear(cx));

    match get(visual, proxied) {
        AssetState::Ready {
            image,
            width,
            height,
        } => {
            assert_eq!((width, height), (40., 20.));
            let red = image
                .as_bytes(0)
                .unwrap()
                .chunks_exact(4)
                .filter(|px| px[0] < 20 && px[1] < 20 && px[2] > 200 && px[3] > 200)
                .count();
            assert_eq!(red, 40 * 20, "the proxied image decodes to its red pixels");
        }
        other => panic!("the proxied image must load, got {}", state_name(&other)),
    }
    let drawn = visual
        .debug_bounds("md-image-0")
        .expect("the proxied image is drawn");
    assert_eq!(f32::from(drawn.size.height), 20., "drawn at its own height");

    match get(visual, direct) {
        AssetState::Failed(AssetFailure::Network(reason)) => {
            assert_eq!(reason.as_ref(), "Blocked private or loopback address");
        }
        other => panic!(
            "without a proxy the fake-IP answer must block, got {}",
            state_name(&other)
        ),
    }
    let chip = visual
        .debug_bounds("md-image-1")
        .expect("the blocked image keeps its place as a failure chip");
    assert_ne!(
        (f32::from(chip.size.width), f32::from(chip.size.height)),
        (40., 20.),
        "the blocked image is not drawn"
    );
    assert_eq!(
        *targets.lock().unwrap(),
        vec!["CONNECT img.example:443 HTTP/1.1".to_owned()],
        "only the proxied image went through the proxy, by name"
    );
}
