// Read-only lookup for the disposable native smoke window. No activation/input.
import Foundation
import CoreGraphics
let pid = Int(CommandLine.arguments[1])!
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String:Any]] ?? []
for item in list {
    if (item[kCGWindowOwnerPID as String] as? Int) == pid,
       (item[kCGWindowLayer as String] as? Int) == 0 {
        print(item[kCGWindowNumber as String]!)
        exit(0)
    }
}
exit(1)
