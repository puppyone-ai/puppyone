#![cfg(all(target_os = "macos", feature = "dev-capture"))]

#[test]
#[ignore = "requires the macOS WebKit processes; run the native-stream acceptance gate"]
fn real_webkit_streams_ranges_and_retires_cancelled_or_closed_tasks() {
    let profile = tempfile::tempdir().unwrap();
    let output = po_platform::platform::process::run_output(
        std::path::Path::new(env!("CARGO_BIN_EXE_webview-stream-probe")),
        &[],
        profile.path(),
        None,
        std::time::Duration::from_secs(60),
        &std::sync::atomic::AtomicBool::new(false),
        po_platform::platform::process::OutputLimits {
            stdout: 32 * 1024,
            stderr: 128 * 1024,
        },
    )
    .unwrap();
    let receipt: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(receipt["passed"], true, "{receipt}");
    for key in [
        "ephemeral",
        "range",
        "head",
        "firstChunkBeforeEof",
        "cancel",
        "revoke",
        "close",
        "generationFence",
        "shortReadFails",
    ] {
        assert_eq!(
            receipt[key], true,
            "missing native acceptance: {key}: {receipt}"
        );
    }
}
