#!/usr/bin/env python3
"""Compatibility entry point for the retired prototype's verification command."""
from pathlib import Path
import runpy

root = Path(__file__).resolve().parents[2]
print('The standalone prototype is retired; verifying the production src/editor contracts.', flush=True)
runpy.run_path(str(root / 'tools/verify-native-editor.py'), run_name='__main__')
