#![cfg(test)]
use super::protocol_response;
use crate::platform::webview::{Content, ENTRY_ORIGIN, Entry, local_url_for};

#[test]
fn wry_adapter_emits_exact_range_head_cors_and_security_headers() {
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("video.mp4"), b"0123456789").unwrap();
    let content = Content {
        root: Some(root.path().into()),
        source: None,
        entry: Entry::Html("entry".into()),
        max_bytes: 10,
        assets: vec![],
        ipc: None,
        policy: Some("default-src 'none'"),
        frames: None,
        disk_assets: None,
        locked: true,
    }
    .prepare();
    let request = |method: &str, range: &str, origin: &str| {
        wry::http::Request::builder()
            .method(method)
            .uri(local_url_for("video.mp4"))
            .header("origin", origin)
            .header("range", range)
            .body(Vec::new())
            .unwrap()
    };
    let reply = protocol_response(&content, true, &request("GET", "bytes=2-4", ENTRY_ORIGIN));
    assert_eq!(reply.status(), 206);
    assert_eq!(reply.body().as_ref(), b"234");
    for (header, expected) in [
        ("content-type", "video/mp4"),
        ("content-length", "3"),
        ("content-range", "bytes 2-4/10"),
        ("accept-ranges", "bytes"),
        ("access-control-allow-origin", ENTRY_ORIGIN),
        ("vary", "Origin"),
        ("cache-control", "no-store"),
        ("x-content-type-options", "nosniff"),
        ("content-security-policy", "default-src 'none'"),
    ] {
        assert_eq!(reply.headers()[header], expected, "{header}");
    }
    let head = protocol_response(&content, true, &request("HEAD", "bytes=2-4", ENTRY_ORIGIN));
    assert_eq!(head.status(), 200);
    assert_eq!(head.headers()["content-length"], "10");
    assert!(head.body().is_empty());
    assert!(!head.headers().contains_key("content-range"));
    let empty = protocol_response(&content, true, &request("GET", "bytes=10-", ENTRY_ORIGIN));
    assert_eq!(empty.status(), 416);
    assert_eq!(empty.headers()["content-range"], "bytes */10");
    assert!(empty.body().is_empty());
    let foreign = protocol_response(
        &content,
        true,
        &request("GET", "bytes=0-0", "https://attacker.test"),
    );
    assert_eq!(foreign.status(), 403);
    assert!(
        !foreign
            .headers()
            .contains_key("access-control-allow-origin")
    );
    let preflight = protocol_response(&content, true, &request("OPTIONS", "", ENTRY_ORIGIN));
    assert_eq!(preflight.status(), 204);
    assert!(preflight.body().is_empty());
    assert!(!preflight.headers().contains_key("content-length"));
    assert_eq!(
        preflight.headers()["access-control-allow-methods"],
        "GET, HEAD, OPTIONS"
    );
    let denied = protocol_response(&content, true, &request("POST", "", ENTRY_ORIGIN));
    assert_eq!(denied.status(), 405);
    assert_eq!(denied.headers()["allow"], "GET, HEAD, OPTIONS");
    let mut duplicate = request("GET", "bytes=0-0", ENTRY_ORIGIN);
    duplicate
        .headers_mut()
        .append("range", "bytes=1-1".parse().unwrap());
    assert_eq!(protocol_response(&content, true, &duplicate).status(), 416);
    let mut duplicate = request("GET", "bytes=0-0", ENTRY_ORIGIN);
    duplicate
        .headers_mut()
        .append("origin", ENTRY_ORIGIN.parse().unwrap());
    assert_eq!(protocol_response(&content, true, &duplicate).status(), 403);
    content.revoke();
    assert_eq!(
        protocol_response(&content, true, &request("GET", "", ENTRY_ORIGIN)).status(),
        403
    );
}
