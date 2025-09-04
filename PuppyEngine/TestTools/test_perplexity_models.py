"""
Test all referenced Perplexity models using .env credentials.
- Direct OpenRouter IDs via remote_llm_chat
- UI aliases via LLMQASearchStrategy (qa_search.py mapping)
"""
import os
import sys
import time
from typing import List, Tuple

# Ensure we can import from PuppyEngine
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
ENGINE_DIR = os.path.dirname(CURRENT_DIR)
REPO_ROOT = os.path.dirname(ENGINE_DIR)
sys.path.append(ENGINE_DIR)

from ModularEdges.LLMEdge.llm_edge import remote_llm_chat
from ModularEdges.LLMEdge.llm_settings import open_router_supported_models
from ModularEdges.SearchEdge.qa_search import LLMQASearchStrategy


def load_env_from_file(path: str) -> None:
    if not path or not os.path.exists(path):
        return
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip("'\"")
                if key and value and key not in os.environ:
                    os.environ[key] = value
    except Exception:
        pass


# Load potential .env files (repo root and engine)
load_env_from_file(os.path.join(REPO_ROOT, ".env"))
load_env_from_file(os.path.join(ENGINE_DIR, ".env"))


def mask_key(key: str, show: int = 6) -> str:
    if not key:
        return "<missing>"
    if len(key) <= show:
        return "*" * len(key)
    return key[:show] + "…" + "*" * 6


def test_openrouter_ids(models: List[str]) -> List[Tuple[str, bool, str]]:
    results = []
    for model in models:
        try:
            resp = remote_llm_chat(
                model=model,
                messages=[
                    {"role": "system", "content": "You are a terse assistant."},
                    {"role": "user", "content": "Reply with OK only."},
                ],
                max_tokens=8,
                hoster="openrouter",
                temperature=0.1,
                stream=False,
            )
            ok = isinstance(resp, str) and len(resp.strip()) > 0
            results.append((model, ok, ""))
        except Exception as e:
            results.append((model, False, str(e)))
        time.sleep(0.6)  # be gentle with rate limits
    return results


def test_ui_aliases(aliases: List[str]) -> List[Tuple[str, bool, str]]:
    results = []
    for alias in aliases:
        try:
            s = LLMQASearchStrategy(
                query="Reply with OK only.",
                extra_configs={"model": alias, "sub_search_type": "perplexity"},
            )
            resp_list = s.search()
            ok = isinstance(resp_list, list) and len(resp_list) == 1 and isinstance(resp_list[0], str)
            results.append((alias, ok, ""))
        except Exception as e:
            results.append((alias, False, str(e)))
        time.sleep(0.6)
    return results


if __name__ == "__main__":
    openrouter_key = os.environ.get("OPENROUTER_API_KEY")
    openrouter_base = os.environ.get("OPENROUTER_BASE_URL")

    print("Env:")
    print("  OPENROUTER_API_KEY:", mask_key(openrouter_key))
    print("  OPENROUTER_BASE_URL:", openrouter_base or "<default>")

    # Collect referenced Perplexity OpenRouter IDs from settings
    perplexity_ids = [m for m in open_router_supported_models if m.startswith("perplexity/")]
    print("\nTesting Perplexity OpenRouter IDs (remote_llm_chat):")
    id_results = test_openrouter_ids(perplexity_ids)
    for model, ok, err in id_results:
        status = "PASS" if ok else "FAIL"
        print(f"  [{status}] {model}" + (f"  -> {err}" if not ok else ""))

    # UI aliases defined/handled by qa_search.py
    ui_aliases = [
        # Three primary UI aliases supported across frontend/backed
        "sonar",
        "sonar-pro",
        "sonar-reasoning-pro",
        # Keep this alias for backward compatibility mapping
        "llama-3.1-sonar-huge-128k-online",
    ]
    print("\nTesting Perplexity UI aliases (qa_search mapping):")
    alias_results = test_ui_aliases(ui_aliases)
    for alias, ok, err in alias_results:
        status = "PASS" if ok else "FAIL"
        print(f"  [{status}] {alias}" + (f"  -> {err}" if not ok else ""))

    total = len(id_results) + len(alias_results)
    passed = sum(1 for _, ok, _ in id_results + alias_results if ok)
    print(f"\nSummary: {passed}/{total} succeeded")
