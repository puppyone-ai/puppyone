import pytest

from src.config import settings
from src.security.crypto import (
    decrypt_db_connection_config,
    encrypt_db_connection_config,
    is_encrypted_db_connection_config,
    mask_db_connection_config,
)


KEY_1 = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
KEY_2 = "ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA="


@pytest.fixture(autouse=True)
def _set_encryption_key():
    old_key = settings.DB_CONNECTOR_ENCRYPTION_KEY
    old_kid = settings.DB_CONNECTOR_ENCRYPTION_KID
    settings.DB_CONNECTOR_ENCRYPTION_KEY = KEY_1
    settings.DB_CONNECTOR_ENCRYPTION_KID = "test-k1"
    try:
        yield
    finally:
        settings.DB_CONNECTOR_ENCRYPTION_KEY = old_key
        settings.DB_CONNECTOR_ENCRYPTION_KID = old_kid


def test_encrypt_decrypt_roundtrip():
    plain = {
        "project_url": "https://abcdefghijkl.supabase.co",
        "api_key": "sb_publishable_abcdefghijklmnopqrstuvwxyz",
        "key_type": "anon",
    }

    encrypted = encrypt_db_connection_config(plain)
    assert is_encrypted_db_connection_config(encrypted)
    assert encrypted["_enc"]["kid"] == "test-k1"
    assert encrypted["_masked"]["api_key"] != plain["api_key"]

    decrypted = decrypt_db_connection_config(encrypted)
    assert decrypted == plain


def test_decrypt_plaintext_config_compat():
    plain = {
        "project_url": "https://legacy.supabase.co",
        "api_key": "legacy-token",
        "key_type": "service_role",
    }
    assert is_encrypted_db_connection_config(plain) is False
    assert decrypt_db_connection_config(plain) == plain


def test_mask_config_hides_sensitive_values():
    plain = {
        "project_url": "https://abcdefghijkl.supabase.co",
        "api_key": "sb_secret_abcdefghijklmnopqrstuvwxyz",
        "key_type": "service_role",
    }
    masked = mask_db_connection_config(plain)

    assert masked["project_url"] == "https://ab***.supabase.co"
    assert masked["api_key"].startswith("sb_secret_***")
    assert "abcdefghijklmnopqrstuvwxyz" not in masked["api_key"]
    assert masked["key_type"] == "service_role"


def test_decrypt_with_wrong_key_fails():
    plain = {
        "project_url": "https://abcdefghijkl.supabase.co",
        "api_key": "sb_publishable_abcdefghijklmnopqrstuvwxyz",
        "key_type": "anon",
    }
    encrypted = encrypt_db_connection_config(plain)

    settings.DB_CONNECTOR_ENCRYPTION_KEY = KEY_2
    with pytest.raises(Exception):
        decrypt_db_connection_config(encrypted)
