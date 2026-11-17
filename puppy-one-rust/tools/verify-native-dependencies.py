#!/usr/bin/env python3
"""Required engine, PTY and OS-isolation tests; missing dependencies fail."""
from test_runner import run_gate

CHECKS = [
    ('po-platform', 'platform::terminal::tests::real_pty_input_resize_and_cleanup'),
    ('po-platform', 'platform::pdf::tests::a_document_opens_and_renders_pages_when_the_engine_is_installed'),
    ('po-editor', 'editor::viewers::pdf::tests::a_pdf_opens_fits_the_pane_and_renders_its_page'),
    ('po-workspace', 'workspace::hosts::exec::tests::a_command_in_the_seatbelt_stays_in_its_folder'),
    ('po-workspace', 'workspace::hosts::git::acceptance_tests::git_hooks_in_the_actual_sandbox_cannot_write_outside_the_shared_folder'),
]

if __name__ == '__main__':
    report = run_gate('native-dependency-verification', [
        {'package': package, 'test': name} for package, name in CHECKS
    ], metadata={'scope': 'PDFium, PTY and macOS folder isolation; no simulated engine fallback'})
    raise SystemExit(0 if report['passed'] else 1)
