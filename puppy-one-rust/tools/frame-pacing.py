#!/usr/bin/env python3
"""Frame pacing of the sidebars' motion in a real window.

Replays a live capture scenario (`PUPPYONE_CAPTURE_LIVE`: an ordinary
foreground window on the display link, not the capture's background frame
pump) that opens a large tree and toggles the Explorer and the right
sidebar, while GPUI prints each frame's duration (`ZED_MEASUREMENTS`) and
`sample` records the main thread. Build the binary first with symbols:

  CARGO_PROFILE_RELEASE_STRIP=false CARGO_PROFILE_RELEASE_DEBUG=line-tables-only \\
    cargo build --release --features dev-capture --target-dir target/profiling

A frame's duration includes the wait for the next drawable, so it reads
about one display period when the window keeps up; the intervals between
frames show missed periods.
"""
import argparse
import os
import re
import statistics
import subprocess
import tempfile
import threading
import time
from pathlib import Path

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument('workspace', help='a large folder to open')
parser.add_argument('--binary', default=str(root / 'target/profiling/release/puppy-one-rust'))
parser.add_argument('--expand', default='src,src/features,electron', help='folders to expand first')
parser.add_argument('--cycles', type=int, default=3)
parser.add_argument('--sample', help='write the main thread sample here')
args = parser.parse_args()

steps = [f'expand:{path}' for path in args.expand.split(',') if path] + ['wait:2000']
for _ in range(args.cycles):
    steps += ['toggle-explorer', 'wait:700', 'toggle-explorer', 'wait:700']
for _ in range(args.cycles):
    steps += ['agent', 'wait:700', 'agent', 'wait:700']
data = Path(tempfile.mkdtemp(prefix='puppyone-frames-'))
(data / 'preferences.json').write_text('{"header_coachmarks":{"agent":true,"changes":true}}')
env = {
    'HOME': os.environ['HOME'], 'PATH': os.environ['PATH'],
    'PUPPYONE_RUST_DATA_DIR': str(data), 'PUPPYONE_WIDTH': '1280', 'PUPPYONE_HEIGHT': '800',
    'PUPPYONE_RIGHT': '1', 'PUPPYONE_WORKSPACE': args.workspace, 'PUPPYONE_CAPTURE_LIVE': '1',
    'PUPPYONE_SCREENSHOT': str(data / 'end.png'), 'PUPPYONE_CAPTURE_SCENARIO': ';'.join(steps),
    'ZED_MEASUREMENTS': '1',
}
process = subprocess.Popen([args.binary], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
frames = []
def read():
    for line in process.stderr:
        m = re.match(r'frame duration: ([\d.]+)(ms|µs|s)$', line.strip())
        if m:
            value = float(m.group(1))
            frames.append((time.time(), {'ms': value, 'µs': value / 1000, 's': value * 1000}[m.group(2)]))
reader = threading.Thread(target=read, daemon=True)
reader.start()
time.sleep(2)
if args.sample:
    subprocess.run(['sample', str(process.pid), '14', '1', '-file', args.sample], stdout=subprocess.DEVNULL)
else:
    time.sleep(14)
time.sleep(3)
process.terminate()
process.wait()
reader.join(timeout=2)

start = frames[0][0]
motion = [(t, ms) for t, ms in frames if t - start >= 3.0]
times = [t for t, _ in motion]
intervals = sorted((b - a) * 1000 for a, b in zip(times, times[1:]))
durations = sorted(ms for _, ms in motion)
pct = lambda xs, p: xs[min(len(xs) - 1, int(len(xs) * p))]
period = statistics.median(intervals)
print(f'frames {len(motion)} over {times[-1] - times[0]:.1f}s ({len(motion) / (times[-1] - times[0]):.0f} fps)')
print(f'interval p50 {period:.2f} p95 {pct(intervals, .95):.2f} p99 {pct(intervals, .99):.2f} max {intervals[-1]:.2f} ms')
print(f'missed one period: {sum(i > period * 1.5 for i in intervals)}, two: {sum(i > period * 2.5 for i in intervals)}')
print(f'duration p50 {statistics.median(durations):.2f} p99 {pct(durations, .99):.2f} max {durations[-1]:.2f} ms')
stalls = data / 'diagnostics/main-thread-stalls.jsonl'
print('main-thread stalls:', stalls.read_text().count('\n') if stalls.exists() else 0)
