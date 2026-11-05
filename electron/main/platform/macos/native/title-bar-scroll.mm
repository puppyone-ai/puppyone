#import <AppKit/AppKit.h>
#include <node_api.h>

// A title bar drawn by the page is a native drag region: AppKit hit-tests it
// to the window frame, so scrolling over it never reaches the page beneath.
// For the windows registered here, such a scroll goes on to the page instead.
// Pressing there still drags the window: only scroll wheel events are moved.
static NSHashTable<NSWindow *> *windows;
static id scrollMonitor;

static NSView *View(napi_env env, napi_value value) {
  void *data = nullptr;
  size_t size = 0;
  if (napi_get_buffer_info(env, value, &data, &size) != napi_ok || size != sizeof(void *)) return nil;
  return (__bridge NSView *)*static_cast<void **>(data);
}

static napi_value JsBoolean(napi_env env, bool value) {
  napi_value result;
  napi_get_boolean(env, value, &result);
  return result;
}

// The view Chromium draws the page in, under a point in window coordinates.
static NSView *PageAt(NSWindow *window, NSPoint point) {
  static Class pageClass = NSClassFromString(@"RenderWidgetHostViewCocoa");
  if (!pageClass || !window.contentView) return nil;
  NSMutableArray<NSView *> *pending = [NSMutableArray arrayWithObject:window.contentView];
  while (pending.count) {
    NSView *view = pending.lastObject;
    [pending removeLastObject];
    if (view.hidden) continue;
    if ([view isKindOfClass:pageClass] && NSPointInRect([view convertPoint:point fromView:nil], view.bounds)) return view;
    [pending addObjectsFromArray:view.subviews];
  }
  return nil;
}

// Hands a scroll that the window frame would take to the page under it.
static BOOL PassToPage(NSWindow *window, NSEvent *event) {
  if (!window || ![windows containsObject:window]) return NO;
  NSView *frame = window.contentView.superview ?: window.contentView;
  NSPoint point = event.locationInWindow;
  NSView *hit = [frame hitTest:frame.superview ? [frame.superview convertPoint:point fromView:nil] : point];
  NSView *page = PageAt(window, point);
  if (!page || [hit isDescendantOf:page]) return NO;
  [page scrollWheel:event];
  return YES;
}

static napi_value PassTitleBarScrollToPage(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  NSWindow *window = argc ? View(env, argv[0]).window : nil;
  if (!window) return JsBoolean(env, false);
  if (!windows) windows = [NSHashTable weakObjectsHashTable];
  [windows addObject:window];
  if (!scrollMonitor) {
    scrollMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskScrollWheel handler:^NSEvent *(NSEvent *event) {
      return PassToPage(event.window, event) ? nil : event;
    }];
  }
  return JsBoolean(env, true);
}

// Tests only: one native scroll wheel event at a point of the window's content
// (from its top left), delivered as AppKit would. Returns whether it went to
// the page past the window frame.
static napi_value ScrollForTesting(napi_env env, napi_callback_info info) {
  size_t argc = 4;
  napi_value argv[4];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  NSWindow *window = argc == 4 ? View(env, argv[0]).window : nil;
  if (!window) return JsBoolean(env, false);
  double x = 0, top = 0;
  int32_t lines = 0;
  napi_get_value_double(env, argv[1], &x);
  napi_get_value_double(env, argv[2], &top);
  napi_get_value_int32(env, argv[3], &lines);
  NSPoint point = NSMakePoint(x, NSHeight(window.contentView.frame) - top);
  CGEventRef cgEvent = CGEventCreateScrollWheelEvent(nullptr, kCGScrollEventUnitLine, 1, lines);
  // An event made here belongs to no window, so its location reads as the
  // window's own coordinates once the window has it.
  CGEventSetLocation(cgEvent, CGPointMake(point.x, NSHeight(NSScreen.screens.firstObject.frame) - point.y));
  NSEvent *event = [NSEvent eventWithCGEvent:cgEvent];
  CFRelease(cgEvent);
  if (PassToPage(window, event)) return JsBoolean(env, true);
  [window sendEvent:event];
  return JsBoolean(env, false);
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    { "passTitleBarScrollToPage", nullptr, PassTitleBarScrollToPage, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "scrollForTesting", nullptr, ScrollForTesting, nullptr, nullptr, nullptr, napi_default, nullptr },
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
