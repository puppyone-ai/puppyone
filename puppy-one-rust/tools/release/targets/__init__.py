"""Per-target release packagers sharing one Release Identity and feed schema."""
from . import linux, macos, windows

TARGETS = {
    'macos': macos,
    'mac': macos,
    'windows': windows,
    'win': windows,
    'linux': linux,
}


def for_target(name):
    key = (name or '').strip().lower()
    if key not in TARGETS:
        raise ValueError(f'Unsupported release target: {name}; expected one of macos, windows, linux')
    return TARGETS[key]
