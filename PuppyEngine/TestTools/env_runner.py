"""
Env runner for TestKit workflows

Usage examples:
  - Run a single workflow file:
      python env_runner.py --file ../TestKit/test_apply_template.json

  - Run multiple files (repeat flag):
      python env_runner.py --file ../TestKit/test_apply_template.json --file ../TestKit/modify.json

Notes:
  - This script stubs optional dependencies (axiom_py, dotenv) so it can run in a minimal env
  - Requires Python 3.10+ (match/case used in edit_structured)
"""

from __future__ import annotations

import os
import sys
import json
import argparse
import asyncio
import types
from typing import Any, Dict, List


def _ensure_import_stubs() -> None:
    """Provide lightweight stubs for optional deps used by engine logging/config.

    - axiom_py.Client with datasets.{get,list}
    - dotenv.load_dotenv no-op
    """
    if 'axiom_py' not in sys.modules:
        axiom = types.ModuleType('axiom_py')

        class _Datasets:
            def get(self, name: str) -> Dict[str, Any]:
                return {"name": name}

            def list(self) -> List[Dict[str, Any]]:
                return []

        class Client:
            def __init__(self, *args, **kwargs) -> None:
                self.datasets = _Datasets()

        axiom.Client = Client
        sys.modules['axiom_py'] = axiom

    if 'dotenv' not in sys.modules:
        dotenv = types.ModuleType('dotenv')

        def load_dotenv(*args, **kwargs) -> None:
            return None

        dotenv.load_dotenv = load_dotenv
        sys.modules['dotenv'] = dotenv


def _setup_paths() -> None:
    """Add PuppyEngine root directory to sys.path for relative imports."""
    current_dir = os.path.dirname(os.path.abspath(__file__))
    engine_root = os.path.dirname(current_dir)  # PuppyEngine/
    if engine_root not in sys.path:
        sys.path.append(engine_root)


async def run_env(workflow: Dict[str, Any]) -> Dict[str, Any]:
    """Execute a workflow JSON via Server.Env and return final block contents of outputs.

    Returns a mapping of block_id to content for the last batch emitted.
    """
    from Server.Env import Env  # deferred import after stubs

    # Minimal user and storage context
    user_info = {"user_id": "dev"}
    storage_client = None

    env = Env(env_id="dev_env", workflow_json=workflow, user_info=user_info, storage_client=storage_client)

    last_data: Dict[str, Any] = {}
    async for event in env.run():
        etype = event.get("event_type")
        if etype == "BLOCK_UPDATED":
            # print incremental updates if needed
            pass
        if "data" in event and isinstance(event["data"], dict):
            last_data = event["data"]
    return last_data


def load_workflow(file_path: str) -> Dict[str, Any]:
    with open(file_path, encoding="utf-8") as f:
        return json.load(f)


def _try_load_expected(file_path: str) -> Dict[str, Any] | None:
    base, ext = os.path.splitext(file_path)
    expected_path = f"{base}.expected.json"
    if os.path.exists(expected_path):
        try:
            with open(expected_path, encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Warning: failed to load expected file {expected_path}: {e}")
    return None


def _compare_results(results: Dict[str, Any], expected: Dict[str, Any]) -> bool:
    # strict deep equality compare
    return json.dumps(results, sort_keys=True, ensure_ascii=False) == json.dumps(expected, sort_keys=True, ensure_ascii=False)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Env with TestKit workflow(s)")
    parser.add_argument(
        "--file",
        dest="files",
        action="append",
        required=True,
        help="Path to a TestKit workflow JSON (repeatable)",
    )
    parser.add_argument(
        "--print-full",
        action="store_true",
        help="Print full JSON contents of outputs",
    )
    args = parser.parse_args()

    _ensure_import_stubs()
    _setup_paths()

    async def _runner():
        for file_path in args.files:
            abs_path = os.path.abspath(os.path.join(os.path.dirname(__file__), file_path)) if not os.path.isabs(file_path) else file_path
            print(f"\n=== Running workflow: {abs_path} ===")
            try:
                workflow = load_workflow(abs_path)
                results = await run_env(workflow)
                if not results:
                    print("No outputs emitted.")
                    continue

                # Always show types
                print("Outputs (block_id -> content types):")
                for bid, content in results.items():
                    print(f"  - {bid}: {type(content).__name__}")

                # Optionally print full contents
                if args.print_full:
                    print("\nFull output contents:")
                    for bid, content in results.items():
                        try:
                            pretty = json.dumps(content, ensure_ascii=False, indent=2)
                        except TypeError:
                            pretty = str(content)
                        print(f"\n[{bid}]\n{pretty}")

                # Auto-compare with expected if available
                expected = _try_load_expected(abs_path)
                if expected is not None:
                    is_match = _compare_results(results, expected)
                    print(f"\nExpectation file found: {'PASS' if is_match else 'FAIL'}")
                    if not is_match and args.print_full:
                        print("\nExpected vs Actual (sorted JSON):")
                        print("Expected:\n" + json.dumps(expected, ensure_ascii=False, indent=2, sort_keys=True))
                        print("Actual:\n" + json.dumps(results, ensure_ascii=False, indent=2, sort_keys=True))
            except Exception as e:
                print(f"Failed to run {abs_path}: {e}")

    asyncio.run(_runner())


if __name__ == "__main__":
    main()


