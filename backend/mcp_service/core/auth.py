"""
鉴权与 API_KEY 解析相关逻辑
"""

from __future__ import annotations

import base64
import json

from starlette.requests import Request


def extract_api_key(request: Request) -> str:
    """从请求中提取 API key（X-API-KEY / Bearer token）"""
    api_key = request.headers.get("X-API-KEY") or request.headers.get("x-api-key")
    if api_key:
        return api_key

    auth = request.headers.get("authorization")
    if auth and auth.lower().startswith("bearer "):
        return auth[7:].strip()

    raise Exception("缺少api_key，请在X-API-KEY header中提供")


def parse_table_scope_from_api_key(api_key: str) -> tuple[int, str]:
    """
    从 API_KEY(JWT) 的 payload 中解析 table_id 与 json_path（挂载点 JSON Pointer）。

    注意：这里不做签名校验，主服务仍会用 api_key 查询 mcp_instance 做有效性校验。
    """
    try:
        parts = api_key.split(".")
        if len(parts) < 2:
            raise ValueError("invalid jwt format")

        payload_b64 = parts[1]
        payload_b64 += "=" * (-len(payload_b64) % 4)  # base64url padding
        payload_bytes = base64.urlsafe_b64decode(payload_b64.encode("utf-8"))
        payload = json.loads(payload_bytes.decode("utf-8"))

        table_id = int(payload["table_id"])
        json_path = payload.get("json_path") or payload.get("json_pointer") or ""
        if json_path is None:
            json_path = ""
        return table_id, str(json_path)
    except Exception as e:
        raise Exception(f"API_KEY解析失败: {e}")
