#![cfg(all(target_os = "macos", feature = "dev-capture"))]

#[test]
#[ignore = "requires the macOS WebKit processes; run the structured viewer acceptance gate"]
fn real_webkit_structured_viewers_follow_resets_edits_and_history() {
    let profile = tempfile::tempdir().unwrap();
    let output = po_platform::platform::process::run_output(
        std::path::Path::new(env!("CARGO_BIN_EXE_webview-structured-probe")),
        &[],
        profile.path(),
        None,
        std::time::Duration::from_secs(120),
        &std::sync::atomic::AtomicBool::new(false),
        po_platform::platform::process::OutputLimits {
            stdout: 32 * 1024,
            stderr: 128 * 1024,
        },
    )
    .unwrap();
    let stderr = String::from_utf8_lossy(&output.stderr);
    let receipt: serde_json::Value = serde_json::from_slice(&output.stdout)
        .unwrap_or_else(|error| panic!("no receipt ({error}): {stderr}"));
    assert_eq!(receipt["passed"], true, "{receipt}");
    for kind in ["contextMap", "puppyflow"] {
        for key in [
            "cleanReset",
            "editGeneration",
            "dirtyReset",
            "editAfterAdoption",
            "undoRedo",
            "hiddenAndShown",
            "readOnly",
            "resetClearsHistory",
            "recreated",
        ] {
            assert_eq!(
                receipt[kind][key], true,
                "missing native acceptance: {kind}.{key}: {receipt}"
            );
        }
    }
}
