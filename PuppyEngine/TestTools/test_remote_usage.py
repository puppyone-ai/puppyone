#!/usr/bin/env python3
import os
import json
import time
import requests

ENGINE_URL = os.getenv("ENGINE_URL", "http://127.0.0.1:8001")
USER_URL = os.getenv("USER_URL", "http://127.0.0.1:8000")
SERVICE_KEY = os.getenv("SERVICE_KEY", "service_123")
RUN_LLM_TEST = os.getenv("RUN_LLM_TEST", "0") == "1"
LLM_MODEL = os.getenv("LLM_MODEL", "openai/gpt-4o-mini")


def get_valid_token():
    # ensure test user & token exist
    try:
        requests.post(f"{USER_URL}/test/create-test-user", timeout=10)
    except Exception:
        pass
    r = requests.post(f"{USER_URL}/test/generate-tokens", timeout=10)
    r.raise_for_status()
    data = r.json()
    token = data["tokens"]["valid"]
    user_id = data["test_user"]["user_id"]
    print(f"✅ Got test token for user_id={user_id}")
    return token


def check_available(user_token: str, usage_type: str, amount: int = 1) -> int:
    r = requests.post(
        f"{USER_URL}/usage/external/check",
        json={"user_token": user_token, "usage_type": usage_type, "amount": amount},
        headers={"X-Service-Key": SERVICE_KEY, "Content-Type": "application/json"},
        timeout=10,
    )
    r.raise_for_status()
    body = r.json()
    print(f"[check] type={usage_type} allowed={body.get('allowed')} available={body.get('available')}")
    return int(body.get("available", 0))


def post_task(workflow: dict, user_token: str) -> str:
    r = requests.post(
        f"{ENGINE_URL}/task",
        json=workflow,
        headers={"Authorization": f"Bearer {user_token}", "Content-Type": "application/json"},
        timeout=20,
    )
    if r.status_code not in (200, 202):
        raise RuntimeError(f"create_task failed: {r.status_code}, {r.text}")
    resp = r.json()
    # success wrapper { success: true, data: {...} }
    task_id = resp.get("data", {}).get("task_id")
    if not task_id:
        # fallback
        task_id = resp.get("task_id")
    if not task_id:
        raise RuntimeError(f"No task_id in response: {resp}")
    print(f"➡️  task created: {task_id}")
    return task_id


def stream_until_terminal(task_id: str, user_token: str) -> str:
    url = f"{ENGINE_URL}/task/{task_id}/stream"
    with requests.get(url, headers={"Authorization": f"Bearer {user_token}"}, stream=True, timeout=60) as resp:
        resp.raise_for_status()
        for line in resp.iter_lines(decode_unicode=True):
            if not line or not line.startswith("data:"):
                continue
            payload = json.loads(line.replace("data: ", "", 1))
            et = payload.get("event_type")
            if et:
                print(f"  • event: {et}")
            if et in ("TASK_COMPLETED", "TASK_FAILED"):
                return et
    return "UNKNOWN"


def workflow_modify_success():
    return {
        "blocks": {
            "input": {"label": "input", "type": "text", "storage_class": "internal", "data": {"content": "Hello Engine"}},
            "output": {"label": "output", "type": "text", "storage_class": "internal", "data": {"content": ""}},
        },
        "edges": {
            "e_modify_ok": {
                "type": "modify",
                "data": {
                    "inputs": {"input": "input"},
                    "outputs": {"output": "output"},
                    "modify_type": "copy",
                    "content": "Copy OK",
                },
            }
        },
    }


def workflow_modify_fail():
    return {
        "blocks": {
            "input": {"label": "input", "type": "text", "storage_class": "internal", "data": {"content": "Will fail"}},
            "output": {"label": "output", "type": "text", "storage_class": "internal", "data": {"content": ""}},
        },
        "edges": {
            "e_modify_fail": {
                "type": "modify",
                "data": {
                    "inputs": {"input": "input"},
                    "outputs": {"output": "output"},
                    "modify_type": "unknown_strategy",  # invalid on purpose
                    "content": "N/A",
                },
            }
        },
    }


def workflow_llm_success():
    return {
        "blocks": {
            "input": {"label": "input", "type": "text", "storage_class": "internal", "data": {"content": "Say hi"}},
            "output": {"label": "output", "type": "text", "storage_class": "internal", "data": {"content": ""}},
        },
        "edges": {
            "e_llm_ok": {
                "type": "llm",
                "data": {
                    "inputs": {"input": "input"},
                    "outputs": {"output": "output"},
                    "model": LLM_MODEL,
                    "messages": [{"role": "user", "content": "Reply with OK only."}],
                },
            }
        },
    }


def main():
    token = get_valid_token()

    # Baseline
    runs_before = check_available(token, "runs", 1)
    calls_before = check_available(token, "llm_calls", 1)

    # 1) runs success (modify)
    print("\n[TEST] runs success (modify)")
    t1 = post_task(workflow_modify_success(), token)
    r1 = stream_until_terminal(t1, token)
    print(f"result: {r1}")
    runs_after1 = check_available(token, "runs", 1)
    print(f"runs delta: {runs_before - runs_after1} (expect 1)")
    runs_before = runs_after1

    # 2) runs fail (modify)
    print("\n[TEST] runs fail (modify)")
    t2 = post_task(workflow_modify_fail(), token)
    r2 = stream_until_terminal(t2, token)
    print(f"result: {r2}")
    runs_after2 = check_available(token, "runs", 1)
    print(f"runs delta: {runs_before - runs_after2} (expect 0)")
    runs_before = runs_after2

    # 3) llm success (optional)
    if RUN_LLM_TEST:
        print("\n[TEST] llm_calls success (llm)")
        t3 = post_task(workflow_llm_success(), token)
        r3 = stream_until_terminal(t3, token)
        print(f"result: {r3}")
        runs_after3 = check_available(token, "runs", 1)
        calls_after3 = check_available(token, "llm_calls", 1)
        print(f"runs delta: {runs_before - runs_after3} (expect 1)")
        print(f"llm_calls delta: {calls_before - calls_after3} (expect 1)")

    print("\nDone. Now observe DB usage_events for failure (amount=0) and per-edge records.")


if __name__ == "__main__":
    main()
