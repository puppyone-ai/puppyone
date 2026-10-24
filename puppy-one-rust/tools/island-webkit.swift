// WebKit twin of tools/island-debug.mjs: load the assembled content island in
// an offscreen WKWebView (the engine wry embeds), replay host messages, and
// write a 2x snapshot plus element geometry for comparison with the Chromium
// product reference. Never touches a workspace; input is an HTML file and a
// JSON list of host messages.
// usage: island-webkit <page.html> <messages.json> <out.png> <out.json> [width height] [script.js]
import AppKit
import WebKit

let args = CommandLine.arguments
guard args.count >= 5 else { FileHandle.standardError.write("usage: island-webkit page.html messages.json out.png out.json [w h] [script.js]\n".data(using: .utf8)!); exit(2) }
let page = try! String(contentsOfFile: args[1], encoding: .utf8)
let messages = try! String(contentsOfFile: args[2], encoding: .utf8)
let outPNG = args[3], outJSON = args[4]
let width = args.count > 6 ? Double(args[5])! : 1059, height = args.count > 6 ? Double(args[6])! : 760
let extra = args.count > 7 ? try! String(contentsOfFile: args[7], encoding: .utf8) : ""

final class Host: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    var posted: [String] = []
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if ProcessInfo.processInfo.environment["ISLAND_WEBKIT_DEBUG"] != nil { print("didFinish") }
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { print("didFail \(error)") }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { print("didFailProvisional \(error)") }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { print("content process terminated") }
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        if let body = m.body as? String {
            if body.hasPrefix("@") { print("progress", body); return }
            posted.append(body)
            if ProcessInfo.processInfo.environment["ISLAND_WEBKIT_DEBUG"] != nil { print("posted", body.prefix(200)) }
        }
    }
}
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let host = Host()
let config = WKWebViewConfiguration()
// An offscreen window is an occluded page: disable hidden-page timer
// throttling and process suppression so replay timers run normally.
for selector in ["_setHiddenPageDOMTimerThrottlingEnabled:", "_setPageVisibilityBasedProcessSuppressionEnabled:", "_setHiddenPageDOMTimerThrottlingAutoIncreases:"] {
    let sel = NSSelectorFromString(selector)
    if config.preferences.responds(to: sel) { config.preferences.perform(sel, with: false) }
}
config.userContentController.add(host, name: "ipc")
config.userContentController.addUserScript(WKUserScript(source: "window.ipc={postMessage:m=>window.webkit.messageHandlers.ipc.postMessage(m)};", injectionTime: .atDocumentStart, forMainFrameOnly: true))
// An occluded/offscreen page is `document.hidden`: requestAnimationFrame never
// fires and CodeMirror never measures. Keep the window on screen but
// practically invisible and click-through; snapshots ignore window alpha.
let hidden = ProcessInfo.processInfo.environment["ISLAND_WEBKIT_HIDDEN"] != nil
let window = NSWindow(contentRect: NSRect(x: hidden ? -10000 : 0, y: hidden ? -10000 : 0, width: width, height: height), styleMask: [.borderless], backing: .buffered, defer: false)
window.alphaValue = 0.01
window.ignoresMouseEvents = true
window.level = .floating
let view = WKWebView(frame: NSRect(x: 0, y: 0, width: width, height: height), configuration: config)
view.setValue(false, forKey: "drawsBackground")
window.contentView = view
if hidden { window.orderBack(nil) } else { window.orderFrontRegardless() }
view.navigationDelegate = host
view.loadHTMLString(page, baseURL: nil)

func evaluate(_ script: String, _ done: @escaping (Any?) -> Void) {
    view.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
        switch result {
        case .success(let value): done(value)
        case .failure(let error): FileHandle.standardError.write("JS error: \(error)\n".data(using: .utf8)!); done(nil)
        }
    }
}
let replay = """
const wait=ms=>new Promise(r=>setTimeout(r,ms));
for(let i=0;i<200&&!window.puppyEditor;i++)await wait(25);
if(!window.puppyEditor)return JSON.stringify({error:'island did not start'});
const step=s=>window.webkit.messageHandlers.ipc.postMessage('@'+s);
step('start');
for(const m of \(messages)){step('send '+m.kind);window.puppyEditor.receive(m);}
step('opened');await wait(1200);step('settled');
\(extra)
await wait(300);
const pick=(selector,limit=400)=>[...document.querySelectorAll(selector)].slice(0,limit).map(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);
  return {selector,tag:el.tagName,display:s.display,className:typeof el.className==='string'?el.className:'',rect:[r.x,r.y,r.width,r.height].map(v=>Math.round(v*100)/100),
    font:s.fontFamily,fontSize:s.fontSize,fontWeight:s.fontWeight,lineHeight:s.lineHeight,color:s.color,background:s.backgroundColor,padding:s.padding,margin:s.margin,text:(el.textContent||'').trim().slice(0,120)}});
return JSON.stringify({probe:window.__probe??null,viewer:window.__puppySmoke?.state()?.viewer??null,dpr:devicePixelRatio,viewport:[innerWidth,innerHeight],elements:[...pick('.desktop-editor-pane,.desktop-editor-pane-content,.desktop-editor-pane-handle-shell,.desktop-editor-pane-handle,.desktop-editor-pane-menu,.desktop-editor-pane-menu *[class]'),
  ...pick('.cm-editor,.cm-scroller,.cm-content,.cm-line,.cm-line *[class]'),...pick('[class*="csv"]'),...pick('table,th,td'),...pick('[class*="cm-md-"]:not(.cm-line)',600)]});
"""
var finished = false
DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
    if ProcessInfo.processInfo.environment["ISLAND_WEBKIT_DEBUG"] != nil {
        view.evaluateJavaScript("JSON.stringify({editor:typeof window.puppyEditor,ipc:typeof window.ipc,ready:document.readyState,hidden:document.hidden,vis:document.visibilityState})") { v, e in print("probe", v ?? "nil", e ?? "") }
        evaluate("const t=performance.now();await new Promise(r=>setTimeout(r,10));return performance.now()-t;") { v in print("timer10", v ?? "nil") }
    }
    evaluate(replay) { value in
        let json = (value as? String) ?? "{}"
        let merged = "{\"posted\":[\(host.posted.joined(separator: ","))],\"state\":\(json)}"
        try! merged.write(toFile: outJSON, atomically: true, encoding: .utf8)
        let snapshot = WKSnapshotConfiguration()
        snapshot.rect = NSRect(x: 0, y: 0, width: width, height: height)
        snapshot.snapshotWidth = NSNumber(value: width)
        view.takeSnapshot(with: snapshot) { image, error in
            if let image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
               let png = rep.representation(using: .png, properties: [:]) {
                try! png.write(to: URL(fileURLWithPath: outPNG))
                print("wrote \(outPNG) \(rep.pixelsWide)x\(rep.pixelsHigh)")
            } else { print("snapshot failed: \(String(describing: error))") }
            finished = true
            exit(0)
        }
    }
}
DispatchQueue.main.asyncAfter(deadline: .now() + 30) { if !finished { print("timeout"); exit(1) } }
app.run()
