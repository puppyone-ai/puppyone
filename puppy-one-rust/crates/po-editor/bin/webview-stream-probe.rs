//! An isolated native-engine fixture process, never part of the packaged app.
fn main() {
    #[cfg(target_os = "macos")]
    po_editor::web_host::run_stream_probe();
    #[cfg(not(target_os = "macos"))]
    panic!("The WebKit streaming probe requires macOS");
}
