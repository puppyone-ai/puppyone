//! An isolated native-engine fixture process, never part of the packaged app.
fn main() {
    #[cfg(target_os = "macos")]
    po_editor::web_host::run_document_pages_probe();
    #[cfg(not(target_os = "macos"))]
    panic!("The WebKit document pages probe requires macOS");
}
