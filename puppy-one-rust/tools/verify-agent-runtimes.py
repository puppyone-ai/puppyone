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
    'handshake-codex': ('po-agent', LIVE + 'live_codex_handshake'),
    'handshake-claude': ('po-agent', LIVE + 'live_claude_handshake'),
    'handshake-cursor': ('po-agent', LIVE + 'live_cursor_handshake'),
    'handshake-pi': ('po-agent', LIVE + 'live_pi_handshake'),
    'pty': ('po-platform', 'platform::terminal::tests::real_pty_input_resize_and_cleanup'),
    'codex': ('po-agent', LIVE + 'live_codex_roundtrip_resume_and_stop'),
    'claude': ('po-agent', LIVE + 'live_claude_stream_and_resume'),
    'cursor': ('po-agent', LIVE + 'live_cursor_stream_and_resume'),
    'pi': ('po-agent', LIVE + 'live_pi_stream_and_resume'),
}
INFERENCE = ('codex', 'claude', 'cursor', 'pi')
HANDSHAKES = [f'handshake-{runtime}' for runtime in INFERENCE]


def select_checks(names=None, *, live=False):
    names = names or [name for name in CHECKS if live or name not in INFERENCE]
    scope = list(dict.fromkeys(check for name in names
                              for check in (HANDSHAKES if name == 'handshakes' else [name])))
    if any(name not in CHECKS for name in scope):
        raise ValueError('Unknown runtime check')
    if not live and any(name in INFERENCE for name in scope):
        raise ValueError('Inference checks require --live')
    return scope

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live', action='store_true')
    parser.add_argument('--only', action='append', choices=[*CHECKS, 'handshakes'])
    args = parser.parse_args()
    try:
        scope = select_checks(args.only, live=args.live)
    except ValueError as error:
        parser.error(str(error))
    with tempfile.TemporaryDirectory(prefix='puppyone-runtime-verification-') as data:
        env = dict(os.environ, PUPPYONE_RUST_DATA_DIR=data,
                   PUPPYONE_LIVE_INFERENCE='1' if args.live else '0')
        report = run_gate('agent-runtime-verification', [
            {'name': name, 'package': CHECKS[name][0], 'test': CHECKS[name][1]} for name in scope
        ], env=env, metadata={
            'liveInference': args.live, 'scope': scope,
            'sessionModels': {runtime: os.environ.get(f'PUPPYONE_LIVE_{runtime.upper()}_MODEL', 'runtime default') for runtime in INFERENCE if runtime in scope},
            'omittedChecks': sorted(set(CHECKS) - set(scope)),
            'qualification': 'Built-in Agent uses real loopback HTTP with a scripted server. CLI inference uses installed runtimes and existing login. Neither is GUI acceptance. Fork is not advertised by the Built-in Agent adapter.',
        })
    raise SystemExit(0 if report['passed'] else 1)
