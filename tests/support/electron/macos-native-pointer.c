#include <ApplicationServices/ApplicationServices.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

/* Targeted OS click/wheel for the disposable acceptance window; restore cursor. */
int main(int argc, char **argv) {
  if (argc != 4 || (strcmp(argv[1], "click") && strcmp(argv[1], "scroll"))) return 2;
  if (!CGPreflightPostEventAccess()) { fprintf(stderr, "macOS event posting permission is required\n"); return 3; }
  CGEventRef event = CGEventCreate(NULL);
  CGPoint original = CGEventGetLocation(event); CFRelease(event);
  CGPoint point = CGPointMake(atof(argv[2]), atof(argv[3]));
  event = CGEventCreateMouseEvent(NULL, kCGEventMouseMoved, point, kCGMouseButtonLeft);
  CGEventPost(kCGHIDEventTap, event); CFRelease(event); usleep(60000);
  if (!strcmp(argv[1], "click")) {
    event = CGEventCreateMouseEvent(NULL, kCGEventLeftMouseDown, point, kCGMouseButtonLeft);
    CGEventPost(kCGHIDEventTap, event); CFRelease(event); usleep(40000);
    event = CGEventCreateMouseEvent(NULL, kCGEventLeftMouseUp, point, kCGMouseButtonLeft);
  } else {
    event = CGEventCreateScrollWheelEvent(NULL, kCGScrollEventUnitPixel, 1, -180);
    CGEventSetLocation(event, point);
  }
  CGEventPost(kCGHIDEventTap, event); CFRelease(event); usleep(100000);
  event = CGEventCreateMouseEvent(NULL, kCGEventMouseMoved, original, kCGMouseButtonLeft);
  CGEventPost(kCGHIDEventTap, event); CFRelease(event);
  return 0;
}
