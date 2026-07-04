"""
Auth router — for CLI / external clients

POST   /auth/login           Sign in with email + password, returns access_token
POST   /auth/refresh         Refresh access_token
POST   /auth/initialize      Idempotent user initialization (profile + org)
POST   /auth/check-email     Check if email is already registered (rate-limited)
GET    /auth/config           Public Supabase config (URL + anon key) for Realtime
"""

import asyncio
import hashlib
import os
import time
from collections import defaultdict

import httpx

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr
from supabase import create_client

from src.common_schemas import ApiResponse
from src.config import settings
from src.platform.auth.dependencies import CurrentUser, get_current_user, get_initialization_service
from src.platform.auth.initialization import UserInitializationService
from src.utils.logger import log_warning

router = APIRouter(prefix="/auth", tags=["auth"])


# ── Rate limiter for check-email (sliding window, per IP) ────────────────
_CHECK_EMAIL_WINDOW = 60        # seconds
_CHECK_EMAIL_MAX_HITS = 5       # max requests per window per IP
_CHECK_EMAIL_MIN_LATENCY = 0.4  # seconds — flatten timing side-channel
_check_email_hits: dict[str, list[float]] = defaultdict(list)


def _rate_limit_check_email(ip: str) -> None:
    """Raise 429 if the IP has exceeded the allowed check-email rate."""
    now = time.monotonic()
    window = _check_email_hits[ip]
    # Trim entries outside the window
    _check_email_hits[ip] = window = [t for t in window if now - t < _CHECK_EMAIL_WINDOW]
    if len(window) >= _CHECK_EMAIL_MAX_HITS:
        raise HTTPException(status_code=429, detail="Too many requests. Please try again later.")
    window.append(now)


# ── Login brute-force throttle (ISSUE-006) ──────────────────────────────────
# Keyed by ACCOUNT (email), NOT by IP: behind a reverse proxy request.client.host
# is a shared proxy address (per-IP limiting would false-positive real users) and
# X-Forwarded-For is client-spoofable, so IP keying would be both unsafe and
# ineffective. We count FAILED logins only and evaluate the threshold AFTER the
# attempt — so a legitimate user with the correct password is never blocked (no
# victim-lockout DoS), and successful logins add ZERO overhead. Redis-backed when
# RATELIMIT_REDIS_URL is set (cross-replica-correct); otherwise a per-replica
# in-process fallback. Fail-open: any Redis error degrades to in-process, never
# blocks auth. Supabase's own throttling remains the primary backstop.
_LOGIN_FAIL_WINDOW = 600     # 10 minutes
_LOGIN_FAIL_MAX = 10         # failed attempts per account per window before 429
_rate_hits: dict[str, list[float]] = defaultdict(list)

# Atomic fixed-window counter: INCR, and set the TTL only when the key is new.
_RL_LUA = (
    "local c = redis.call('INCR', KEYS[1])\n"
    "if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end\n"
    "return c"
)
_rl_redis = None
_rl_script = None
_rl_redis_init = False


def _hash_key(value: str) -> str:
    # Hash the account so Redis never stores plaintext emails, and keys are bounded.
    return hashlib.sha256((value or "").encode("utf-8")).hexdigest()[:24]


def _get_rl_redis():
    """Lazily build a pooled sync Redis client + registered script.

    Returns (None, None) when RATELIMIT_REDIS_URL is unset or the client can't be
    built — the caller then uses the in-process fallback.
    """
    global _rl_redis, _rl_script, _rl_redis_init
    if _rl_redis_init:
        return _rl_redis, _rl_script
    _rl_redis_init = True
    url = getattr(settings, "RATELIMIT_REDIS_URL", "") or ""
    if not url:
        return None, None
    try:
        import redis as redis_sync
        _rl_redis = redis_sync.Redis.from_url(
            url, decode_responses=True,
            socket_timeout=0.15, socket_connect_timeout=0.15,
        )
        _rl_script = _rl_redis.register_script(_RL_LUA)
    except Exception as e:  # noqa: BLE001 — never break auth on redis init
        log_warning(f"[auth] rate-limit redis disabled (init failed): {e}")
        _rl_redis = None
        _rl_script = None
    return _rl_redis, _rl_script


def _over_limit(bucket: str, value: str, max_hits: int, window_s: int) -> bool:
    """Increment the (bucket, value) counter; return True if it now exceeds
    max_hits within window_s. Redis-first, fail-open to a per-replica in-process
    sliding window on any Redis error."""
    key = f"rl:{bucket}:{_hash_key(value)}"
    r, script = _get_rl_redis()
    if r is not None and script is not None:
        try:
            count = int(script(keys=[key], args=[window_s]))
            return count > max_hits
        except Exception as e:  # noqa: BLE001 — degrade to in-process
            log_warning(f"[auth] rate-limit redis error, using in-process: {e}")
    now = time.monotonic()
    kept = [t for t in _rate_hits[key] if now - t < window_s]
    kept.append(now)
    _rate_hits[key] = kept
    return len(kept) > max_hits


def _register_login_failure(email: str) -> bool:
    """Record a failed login for an account; True once the account is throttled."""
    return _over_limit(
        "login_fail", (email or "").strip().lower() or "unknown",
        _LOGIN_FAIL_MAX, _LOGIN_FAIL_WINDOW,
    )


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    expires_in: int
    user_email: str


class RefreshRequest(BaseModel):
    refresh_token: str


class CheckEmailRequest(BaseModel):
    email: EmailStr


class CheckEmailResponse(BaseModel):
    exists: bool


def _make_auth_client():
    """Create a throwaway Supabase client for auth operations only.

    This avoids contaminating the global singleton's PostgREST session
    (sign_in_with_password stores the user token, which would cause all
    subsequent DB queries to run under RLS instead of service_role).
    """
    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_KEY", "")
    return create_client(url, key)


class RealtimeConfig(BaseModel):
    supabase_url: str
    supabase_anon_key: str


@router.get("/config", response_model=ApiResponse[RealtimeConfig])
def get_public_config():
    """Return public Supabase config needed by CLI for Realtime subscriptions."""
    url = os.environ.get("SUPABASE_URL", "")
    anon_key = os.environ.get("SUPABASE_ANON_KEY", "")
    if not url or not anon_key:
        raise HTTPException(
            status_code=500,
            detail="SUPABASE_URL or SUPABASE_ANON_KEY not configured on server",
        )
    return ApiResponse.success(data=RealtimeConfig(
        supabase_url=url, supabase_anon_key=anon_key,
    ))


@router.post("/check-email", response_model=ApiResponse[CheckEmailResponse])
async def check_email(body: CheckEmailRequest, request: Request):
    """Check whether an email is already registered (for email-first login flow).

    Protected by per-IP rate limiting and constant-time response delay
    to mitigate email enumeration attacks.
    """
    client_ip = request.client.host if request.client else "unknown"
    _rate_limit_check_email(client_ip)

    start = time.monotonic()

    url = os.environ.get("SUPABASE_URL", "")
    key = os.environ.get("SUPABASE_KEY", "")
    if not url or not key:
        raise HTTPException(status_code=500, detail="Supabase not configured")

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{url}/auth/v1/admin/users",
                headers={"apikey": key, "Authorization": f"Bearer {key}"},
                params={"filter": body.email, "page": 1, "per_page": 10},
            )
            if resp.status_code != 200:
                raise HTTPException(status_code=502, detail="Auth service unavailable")

            users = resp.json().get("users", [])
            target = body.email.lower()
            exists = any(u.get("email", "").lower() == target for u in users)

        # Pad response time to a constant floor so attackers can't infer
        # existence from faster/slower responses (timing side-channel).
        elapsed = time.monotonic() - start
        if elapsed < _CHECK_EMAIL_MIN_LATENCY:
            await asyncio.sleep(_CHECK_EMAIL_MIN_LATENCY - elapsed)

        return ApiResponse.success(data=CheckEmailResponse(exists=exists))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Check email failed: {e!s}")


@router.post("/login", response_model=ApiResponse[LoginResponse])
def login(body: LoginRequest):
    try:
        auth_client = _make_auth_client()
        result = auth_client.auth.sign_in_with_password({
            "email": body.email,
            "password": body.password,
        })

        session = result.session
        if not session:
            raise HTTPException(status_code=401, detail="Login failed: unable to create session")

        return ApiResponse.success(data=LoginResponse(
            access_token=session.access_token,
            refresh_token=session.refresh_token,
            expires_in=session.expires_in,
            user_email=result.user.email if result.user else body.email,
        ))

    except HTTPException:
        raise
    except Exception as e:
        # Failed auth counts toward the per-account brute-force throttle (ISSUE-006).
        # A legitimate user with the correct password never reaches this path, so
        # this can only throttle attackers guessing an account's password.
        if _register_login_failure(body.email):
            raise HTTPException(
                status_code=429,
                detail="Too many failed login attempts. Please try again later.",
                headers={"Retry-After": str(_LOGIN_FAIL_WINDOW)},
            ) from e
        error_msg = str(e)
        if "Invalid login" in error_msg or "invalid" in error_msg.lower():
            raise HTTPException(status_code=401, detail="Invalid email or password")
        raise HTTPException(status_code=401, detail=f"Login failed: {error_msg}")


@router.post("/refresh", response_model=ApiResponse[LoginResponse])
def refresh_token(body: RefreshRequest):
    # No rate limit here: a refresh requires possession of a high-entropy refresh
    # token (not brute-forceable), and limiting it risks throttling legitimate
    # clients. Login (password guessing) is the real brute-force surface.
    try:
        auth_client = _make_auth_client()
        result = auth_client.auth.refresh_session(body.refresh_token)

        session = result.session
        if not session:
            raise HTTPException(status_code=401, detail="Refresh failed: invalid session")

        return ApiResponse.success(data=LoginResponse(
            access_token=session.access_token,
            refresh_token=session.refresh_token,
            expires_in=session.expires_in,
            user_email=result.user.email if result.user else "",
        ))

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Refresh failed: {e!s}")


class InitializeResponse(BaseModel):
    org_id: str
    is_new_org: bool
    demo_project_id: str | None = None


@router.post("/initialize", response_model=ApiResponse[InitializeResponse])
async def initialize_user(
    current_user: CurrentUser = Depends(get_current_user),
    init_service: UserInitializationService = Depends(get_initialization_service),
):
    """Idempotent user initialization: ensures profile + default org +
    membership exist, and on first sign-in seeds a "Get Started" demo
    project so the post-login redirect can land the user inside it
    instead of an empty dashboard."""
    result = init_service.ensure_initialized(
        user_id=current_user.user_id,
        email=current_user.email,
        display_name=current_user.user_metadata.get("full_name") if current_user.user_metadata else None,
    )
    demo_project_id = await init_service.maybe_seed_demo_project(
        user_id=current_user.user_id,
        org_id=result["org_id"],
    )
    return ApiResponse.success(data=InitializeResponse(
        org_id=result["org_id"],
        is_new_org=result["is_new_org"],
        demo_project_id=demo_project_id,
    ))
