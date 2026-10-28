#!/usr/bin/env python3
"""Verify the shipping native editor contracts, without opening OS windows.

Replaces the retired native-editor-probe, whose input adapter was removed
when the application adopted src/editor. This executes the production
editor's tests, not a second editor implementation. Real OS IME/visual and
cross-platform acceptance remain separate.
"""
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess

root = Path(__file__).resolve().parents[1]
out = root / 'artifacts/native-editor-verification'
out.mkdir(parents=True, exist_ok=True)
cargo = shutil.which('cargo') or str(Path.home() / '.cargo/bin/cargo')
# Require named behavior as well as a nonempty suite. A renamed/removed test
# must be reviewed here; a typo in a filter must never produce a green receipt.
suites = {
    'editor::view::ime_tests::': [
        'pinyin_commits_once_and_undoes_in_one_step',
        'a_cancelled_composition_changes_nothing_but_reports_its_end',
        'utf16_ranges_around_emoji_and_cjk',
        'the_candidate_window_anchors_on_the_marked_text',
        'read_only_commits_and_turns_text_input_off',
    ],
    'editor::csv::view::tests::': [
        'typing_replaces_the_selected_value_and_history_belongs_to_the_table',
        'an_ime_composition_in_a_cell_reaches_the_model_once',
        'source_mode_edits_the_raw_text_and_returns_it_to_the_table',
        'column_resize_clamps_cancels_and_auto_fits',
    ],
    'editor::host::tests::': [
        'a_snapshot_waits_for_the_composition_and_resumes_when_it_ends',
        'csv_contributes_view_items_and_find',
        'find_marks_and_selects_matches_in_text_editors',
    ],
}
paths = [root / p for p in ['Cargo.toml', 'Cargo.lock', 'tools/verify-native-editor.py']]
paths.extend(p for folder in ['src', 'assets'] for p in sorted((root / folder).rglob('*')) if p.is_file())
def hashes():
    return {os.path.relpath(p, root): hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
before = hashes()
# An old passing receipt must not survive a failed current run.
receipt_path = out / 'result.json'
receipt_path.unlink(missing_ok=True)
build = subprocess.run([cargo, 'test', '--locked', '--features', 'dev-capture',
                        '--no-run', '--message-format=json'], cwd=root, text=True,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
(out / 'build.log').write_text(build.stderr)
if build.returncode:
    raise SystemExit(build.stderr)
artifacts = [json.loads(line) for line in build.stdout.splitlines() if line.startswith('{')]
binary = next(a['executable'] for a in artifacts if a.get('reason') == 'compiler-artifact'
              and a.get('profile', {}).get('test') and a.get('executable')
              and a.get('target', {}).get('name') == 'puppy-one-rust')
checks = []
for prefix, required in suites.items():
    name = prefix.removeprefix('editor::').replace('::', '-').rstrip('-')
    run = subprocess.run([binary, prefix, '--test-threads=1', '--color=never'], cwd=root,
                         text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    (out / f'{name}.log').write_text(run.stdout)
    passed = re.findall(r'^test (\S+) \.\.\. ok$', run.stdout, re.M)
    missing = [prefix + t for t in required if prefix + t not in passed]
    if run.returncode or missing or not passed:
        print(run.stdout)
        raise SystemExit(f'{name} failed; required contracts not passed: {missing}')
    checks.append({'suite': prefix, 'passed': len(passed), 'tests': passed})
    print(f'{name}: {len(passed)} passed', flush=True)
if hashes() != before:
    raise SystemExit('Editor sources changed during verification; rerun a stable snapshot.')
receipt_path.write_text(json.dumps({
    'passed': True,
    'scope': 'Production native editor synthetic GPUI contracts; not OS IME, visual or cross-platform acceptance',
    'verifiedAt': datetime.now().astimezone().isoformat(),
    'platform': platform.platform(),
    'baseCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(),
    'sourceUnchangedDuringVerification': True,
    'sourceHashes': before,
    'checks': checks,
}, ensure_ascii=False, indent=2) + '\n')
print('Production native editor contracts passed.')
