#import <AppKit/AppKit.h>
#include <node_api.h>
#include <string>

// Node-API is ABI stable; AppKit owns tracking and reports the real end/cancel.
static NSString *const SessionType = @"ai.puppyone.resource-drag-session";
static NSEvent *mouseDown;
static id eventMonitor;
static uint32_t gestureSequence = 0;
static uint32_t startedGesture = 0;
@class ResourceDragSource;
static ResourceDragSource *activeSource;

static napi_value String(napi_env env, const char *value) {
  napi_value result;
  napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, &result);
  return result;
}
static std::string ReadString(napi_env env, napi_value value) {
  size_t size = 0;
  napi_get_value_string_utf8(env, value, nullptr, 0, &size);
  std::string result(size, '\0');
  napi_get_value_string_utf8(env, value, result.data(), size + 1, &size);
  return result;
}
static NSView *View(napi_env env, napi_value value) {
  void *data = nullptr;
  size_t size = 0;
  if (napi_get_buffer_info(env, value, &data, &size) != napi_ok || size != sizeof(void *)) return nil;
  return (__bridge NSView *)*static_cast<void **>(data);
}

struct DragEnd { NSUInteger operation; NSInteger windowNumber; };
static void DeliverEnd(napi_env env, napi_value callback, void *, void *data) {
  auto *end = static_cast<DragEnd *>(data);
  if (env && callback) {
    napi_value value, operation, windowNumber, receiver, result;
    napi_create_object(env, &value);
    napi_create_uint32(env, (uint32_t)end->operation, &operation);
    napi_create_int64(env, end->windowNumber, &windowNumber);
    napi_set_named_property(env, value, "operation", operation);
    napi_set_named_property(env, value, "windowNumber", windowNumber);
    napi_get_undefined(env, &receiver);
    napi_call_function(env, receiver, callback, 1, &value, &result);
  }
  delete end;
}

@interface ResourceDragSource : NSObject <NSDraggingSource>
@property(nonatomic) napi_threadsafe_function callback;
@end
@implementation ResourceDragSource
- (NSDragOperation)draggingSession:(NSDraggingSession *)session sourceOperationMaskForDraggingContext:(NSDraggingContext)context {
  // External export is copy-only. Internal move is an explicit authorized command.
  return context == NSDraggingContextWithinApplication ? NSDragOperationCopy | NSDragOperationMove : NSDragOperationCopy;
}
- (BOOL)ignoreModifierKeysForDraggingSession:(NSDraggingSession *)session { return YES; }
- (void)draggingSession:(NSDraggingSession *)session endedAtPoint:(NSPoint)point operation:(NSDragOperation)operation {
  if (!self.callback) { activeSource = nil; return; }
  auto *end = new DragEnd{operation, [NSWindow windowNumberAtPoint:point belowWindowWithWindowNumber:0]};
  napi_call_threadsafe_function(self.callback, end, napi_tsfn_nonblocking);
  napi_release_threadsafe_function(self.callback, napi_tsfn_release);
  self.callback = nullptr;
  activeSource = nil;
}
@end

static napi_value Start(napi_env env, napi_callback_info info) {
  size_t argc = 5;
  napi_value args[5], result;
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  napi_get_boolean(env, false, &result);
  if (argc != 5 || ![NSThread isMainThread] || activeSource) return result;
  uint32_t gesture = 0;
  napi_get_value_uint32(env, args[4], &gesture);
  if (!gesture || gesture != gestureSequence || gesture == startedGesture) return result;
  NSView *view = View(env, args[0]);
  if (!view || !mouseDown || mouseDown.window != view.window || !([NSEvent pressedMouseButtons] & 1)) return result;
  uint32_t length = 0;
  if (napi_get_array_length(env, args[1], &length) != napi_ok || length == 0 || length > 32) return result;
  std::string token = ReadString(env, args[2]);
  if (token.empty() || token.size() > 128) return result;
  NSMutableArray<NSDraggingItem *> *items = [NSMutableArray array];
  NSPoint location = [view convertPoint:mouseDown.locationInWindow fromView:nil];
  for (uint32_t index = 0; index < length; index++) {
    napi_value element;
    napi_get_element(env, args[1], index, &element);
    std::string path = ReadString(env, element);
    NSString *file = [NSString stringWithUTF8String:path.c_str()];
    if (!file.isAbsolutePath) return result;
    NSPasteboardItem *item = [[NSPasteboardItem alloc] init];
    [item setString:[NSURL fileURLWithPath:file].absoluteString forType:NSPasteboardTypeFileURL];
    [item setString:[NSString stringWithUTF8String:token.c_str()] forType:SessionType];
    NSDraggingItem *drag = [[NSDraggingItem alloc] initWithPasteboardWriter:item];
    NSImage *icon = [[NSWorkspace sharedWorkspace] iconForFile:file];
    [drag setDraggingFrame:NSMakeRect(location.x, location.y, 32, 32) contents:icon];
    [items addObject:drag];
  }
  ResourceDragSource *source = [[ResourceDragSource alloc] init];
  napi_threadsafe_function callback;
  if (napi_create_threadsafe_function(env, args[3], nullptr, String(env, "resource-drag-end"), 0, 1,
      nullptr, nullptr, nullptr, DeliverEnd, &callback) != napi_ok) return result;
  source.callback = callback;
  activeSource = source;
  startedGesture = gesture;
  @try {
    NSDraggingSession *session = [view beginDraggingSessionWithItems:items event:mouseDown source:source];
    session.animatesToStartingPositionsOnCancelOrFail = YES;
    if (session) { napi_get_boolean(env, true, &result); return result; }
  } @catch (NSException *exception) { /* Return failure to the session owner. */ }
  activeSource = nil;
  napi_release_threadsafe_function(callback, napi_tsfn_release);
  return result;
}

static napi_value Inspect(napi_env env, napi_callback_info info) {
  NSString *token = [[NSPasteboard pasteboardWithName:NSPasteboardNameDrag] stringForType:SessionType];
  return String(env, token.UTF8String ?: "");
}
static napi_value WindowNumber(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value arg, result;
  napi_get_cb_info(env, info, &argc, &arg, nullptr, nullptr);
  NSView *view = argc == 1 ? View(env, arg) : nil;
  napi_create_int64(env, view ? view.window.windowNumber : 0, &result);
  return result;
}
static napi_value CaptureGesture(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value arg, result;
  napi_get_cb_info(env, info, &argc, &arg, nullptr, nullptr);
  NSView *view = argc == 1 ? View(env, arg) : nil;
  const bool valid = view && mouseDown && mouseDown.window == view.window && ([NSEvent pressedMouseButtons] & 1);
  napi_create_uint32(env, valid ? gestureSequence : 0, &result);
  return result;
}
static void Cleanup(void *) {
  if (eventMonitor) [NSEvent removeMonitor:eventMonitor];
  eventMonitor = nil;
  mouseDown = nil;
  if (activeSource.callback) {
    napi_release_threadsafe_function(activeSource.callback, napi_tsfn_abort);
    activeSource.callback = nullptr;
  }
}
static napi_value Init(napi_env env, napi_value exports) {
  eventMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskLeftMouseDown handler:^NSEvent *(NSEvent *event) {
    mouseDown = event;
    gestureSequence += 1;
    return event;
  }];
  napi_add_env_cleanup_hook(env, Cleanup, nullptr);
  napi_property_descriptor properties[] = {
    {"start", nullptr, Start, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"inspect", nullptr, Inspect, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"windowNumber", nullptr, WindowNumber, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"captureGesture", nullptr, CaptureGesture, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, 4, properties);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
