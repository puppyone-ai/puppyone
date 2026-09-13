#include <ApplicationServices/ApplicationServices.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

static volatile sig_atomic_t stopped = 0;
static void stop(int ignored) { (void)ignored; stopped = 1; }
static void post(CGEventType type, CGPoint point) {
  CGEventRef event = CGEventCreateMouseEvent(NULL, type, point, kCGMouseButtonLeft);
  CGEventPost(kCGHIDEventTap, event);
  CFRelease(event);
}

/* Real OS drag, not Chromium sendInputEvent. Always release and restore pointer. */
int main(int argc, char **argv) {
  if (argc != 5) { fprintf(stderr, "usage: native-input startX startY endX endY\n"); return 2; }
  if (!CGPreflightPostEventAccess()) { fprintf(stderr, "macOS event posting permission is required\n"); return 3; }
  signal(SIGTERM, stop); signal(SIGINT, stop);
  CGEventRef current = CGEventCreate(NULL);
  CGPoint original = CGEventGetLocation(current); CFRelease(current);
  CGPoint from = CGPointMake(atof(argv[1]), atof(argv[2]));
  CGPoint to = CGPointMake(atof(argv[3]), atof(argv[4]));
  post(kCGEventMouseMoved, from); usleep(150000);
  post(kCGEventLeftMouseDown, from); usleep(180000);
  CGPoint point = from;
  for (int step = 1; step <= 80 && !stopped; step++) {
    double fraction = step / 80.0;
    point = CGPointMake(from.x + (to.x - from.x) * fraction, from.y + (to.y - from.y) * fraction);
    post(kCGEventLeftMouseDragged, point); usleep(16000);
  }
  usleep(200000); post(kCGEventLeftMouseUp, point); usleep(200000);
  post(kCGEventMouseMoved, original);
  return stopped ? 1 : 0;
}
