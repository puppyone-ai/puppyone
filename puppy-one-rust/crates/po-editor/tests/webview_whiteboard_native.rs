#![cfg(all(target_os = "macos", feature = "dev-capture"))]

#[test]
#[ignore = "requires macOS WebKit and the pinned pack; run verify-viewer-pack.py"]
fn real_webkit_whiteboard_draws_and_preserves_document_boundaries() {
    use po_platform::platform::{process, viewer_packs};
    let profile = tempfile::tempdir().unwrap();
    let archive = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!(
        "../../artifacts/viewer-packs/puppyone.excalidraw-{}.tar.gz",
        viewer_packs::excalidraw_spec().version
    ));
    viewer_packs::install_excalidraw_bytes(profile.path(), &std::fs::read(&archive).unwrap())
        .unwrap();
    let output = process::run_output(
        std::path::Path::new(env!("CARGO_BIN_EXE_webview-whiteboard-probe")),
        &[profile.path().to_str().unwrap()],
        profile.path(),
        None,
        std::time::Duration::from_secs(90),
        &std::sync::atomic::AtomicBool::new(false),
        process::OutputLimits {
            stdout: 32 * 1024,
            stderr: 128 * 1024,
        },
    )
    .unwrap();
    let receipt: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    for key in [
        "passed",
        "ephemeral",
        "initialBytes",
        "nativeDrawing",
        "drawingDefaults",
        "readOnly",
        "replacement",
        "theme",
        "undoRedo",
        "resize",
        "invalidPreserved",
        "offlineFonts",
    ] {
        assert_eq!(
            receipt[key], true,
            "missing native acceptance: {key}: {receipt}"
        );
    }
}
