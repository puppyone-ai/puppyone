#!/usr/bin/env python3
"""Run named native acceptance tests. --live permits small real CLI inference turns."""
import argparse
import os
import tempfile
from test_runner import run_gate

NATIVE = 'agent::runtimes::puppyone_agent::native_kernel::tests::'
LIVE = 'agent::runtimes::live_tests::'
CHECKS = {
    'puppyone-native': ('po-agent', NATIVE + 'native_puppyone_http_approval_resume_stop_and_binding'),
    'handshakes': ('po-agent', LIVE + 'live_installed_runtime_handshakes'),
    'pty': ('po-platform', 'platform::terminal::tests::real_pty_input_resize_and_cleanup'),
    'codex': ('po-agent', LIVE + 'live_codex_roundtrip_resume_and_stop'),
    'claude': ('po-agent', LIVE + 'live_claude_stream_and_resume'),
    'cursor': ('po-agent', LIVE + 'live_cursor_stream_and_resume'),
    'pi': ('po-agent', LIVE + 'live_pi_stream_and_resume'),
}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live', action='store_true')
    parser.add_argument('--only', action='append', choices=CHECKS)
    args = parser.parse_args()
    scope = args.only or list(CHECKS)[:(7 if args.live else 3)]
    if not args.live and any(name in ('codex', 'claude', 'cursor', 'pi') for name in scope):
        parser.error('Inference checks require --live')
    with tempfile.TemporaryDirectory(prefix='puppyone-runtime-verification-') as data:
        env = dict(os.environ, PUPPYONE_RUST_DATA_DIR=data,
                   PUPPYONE_LIVE_INFERENCE='1' if args.live else '0')
        report = run_gate('agent-runtime-verification', [
            {'name': name, 'package': CHECKS[name][0], 'test': CHECKS[name][1]} for name in scope
        ], env=env, metadata={
            'liveInference': args.live, 'scope': scope,
            'omittedChecks': sorted(set(CHECKS) - set(scope)),
            'qualification': 'Built-in Agent uses real loopback HTTP with a scripted server. CLI inference uses installed runtimes and existing login. Neither is GUI acceptance. Fork is not advertised by the Built-in Agent adapter.',
        })
    raise SystemExit(0 if report['passed'] else 1)
