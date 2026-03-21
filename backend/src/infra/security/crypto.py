"""Application-layer encryption helpers for db_connector configs."""

import base64
import json
import os
from typing import Any
from urllib.parse import urlparse

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from src.config import settings

_ENVELOPE_VERSION = 1
_ENVELOPE_ALGORITHM = "AES-256-GCM"
_ENVELOPE_ROOT = "_enc"
_MASKED_ROOT = "_masked"


def is_encrypted_db_connection_config(config: dict[str, Any]) -> bool:
    if not isinstance(config, dict):
        return False
    envelope = config.get(_ENVELOPE_ROOT)
    if not isinstance(envelope, dict):
        return False
    return all(k in envelope for k in ("v", "alg", "kid", "nonce", "ciphertext"))


def encrypt_db_connection_config(plain: dict[str, Any]) -> dict[str, Any]:
    payload = json.dumps(plain, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    aesgcm = AESGCM(_load_encryption_key())
    nonce = os.urandom(12)
    ciphertext = aesgcm.encrypt(nonce, payload, None)

    return {
        _ENVELOPE_ROOT: {
            "v": _ENVELOPE_VERSION,
            "alg": _ENVELOPE_ALGORITHM,
            "kid": settings.DB_CONNECTOR_ENCRYPTION_KID,
            "nonce": _b64encode(nonce),
            "ciphertext": _b64encode(ciphertext),
        },
        _MASKED_ROOT: mask_db_connection_config(plain),
    }


def decrypt_db_connection_config(stored: dict[str, Any]) -> dict[str, Any]:
    if not is_encrypted_db_connection_config(stored):
        return stored

    envelope = stored[_ENVELOPE_ROOT]
    if envelope.get("v") != _ENVELOPE_VERSION:
        raise ValueError("Unsupported db_connection config encryption version")
    if envelope.get("alg") != _ENVELOPE_ALGORITHM:
        raise ValueError("Unsupported db_connection config encryption algorithm")

    nonce = _b64decode(envelope["nonce"])
    ciphertext = _b64decode(envelope["ciphertext"])
    aesgcm = AESGCM(_load_encryption_key())
    plaintext = aesgcm.decrypt(nonce, ciphertext, None)
    payload = json.loads(plaintext.decode("utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Decrypted db_connection config must be an object")
    return payload


def mask_db_connection_config(plain: dict[str, Any]) -> dict[str, Any]:
    return {
        "project_url": _mask_project_url(str(plain.get("project_url", ""))),
        "api_key": _mask_api_key(str(plain.get("api_key", ""))),
        "key_type": str(plain.get("key_type", "")),
    }


def _load_encryption_key() -> bytes:
    encoded_key = settings.DB_CONNECTOR_ENCRYPTION_KEY.strip()
    if not encoded_key:
        raise ValueError("DB_CONNECTOR_ENCRYPTION_KEY is required for db_connector encryption")

    try:
        key = base64.b64decode(encoded_key, validate=True)
    except Exception as exc:
        raise ValueError("DB_CONNECTOR_ENCRYPTION_KEY must be valid base64") from exc

    if len(key) != 32:
        raise ValueError("DB_CONNECTOR_ENCRYPTION_KEY must decode to 32 bytes")
    return key


def _b64encode(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def _b64decode(raw: str) -> bytes:
    return base64.b64decode(raw.encode("ascii"))


def _mask_project_url(project_url: str) -> str:
    if not project_url:
        return ""
    parsed = urlparse(project_url)
    host = parsed.netloc or ""
    if host.endswith(".supabase.co"):
        project_ref = host[: -len(".supabase.co")]
        if len(project_ref) <= 2:
            masked_ref = "***"
        else:
            masked_ref = f"{project_ref[:2]}***"
        scheme = parsed.scheme or "https"
        return f"{scheme}://{masked_ref}.supabase.co"
    if parsed.scheme and host:
        return f"{parsed.scheme}://***"
    return "***"


def _mask_api_key(api_key: str) -> str:
    if not api_key:
        return ""

    tail = api_key[-4:] if len(api_key) >= 4 else ""
    if api_key.startswith("sb_publishable_"):
        return f"sb_publishable_***{tail}"
    if api_key.startswith("sb_secret_"):
        return f"sb_secret_***{tail}"

    if len(api_key) <= 8:
        return "***"
    return f"{api_key[:4]}***{tail}"
