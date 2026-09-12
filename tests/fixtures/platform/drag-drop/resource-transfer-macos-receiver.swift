import AppKit
class DropView: NSView {
  override init(frame: NSRect) { super.init(frame: frame); registerForDraggedTypes([.fileURL, .string]); wantsLayer = true; layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor }
  required init?(coder: NSCoder) { fatalError() }
  override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation { return .copy }
  override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
    let board = sender.draggingPasteboard
    let urls = (board.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL]) ?? []
    let result: [String: Any] = ["types": board.types?.map { $0.rawValue } ?? [], "paths": urls.map { $0.path }, "text": board.string(forType: .string) ?? ""]
    if let data = try? JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]), let value = String(data: data, encoding: .utf8) { print(value); fflush(stdout) }
    return true
  }
}
let application = NSApplication.shared
application.setActivationPolicy(.regular)
let window = NSWindow(contentRect: NSRect(x: 580, y: 350, width: 460, height: 490), styleMask: [.titled, .closable], backing: .buffered, defer: false)
window.title = "Native macOS file receiver"
window.level = .floating
window.setFrameTopLeftPoint(NSPoint(x: 580, y: NSScreen.main!.frame.height - 100))
window.contentView = DropView(frame: NSRect(x: 0, y: 0, width: 460, height: 490))
let label = NSTextField(labelWithString: "Drop test files here. See JSON log.")
label.frame = NSRect(x: 20, y: 380, width: 400, height: 40)
window.contentView!.addSubview(label)
window.makeKeyAndOrderFront(nil)
application.activate(ignoringOtherApps: true)
application.run()
