"""GitHub webhook receiver.

Validates the ``X-Hub-Signature-256`` HMAC against the integration's
``webhook_secret``, then enqueues an import job. We never run the
import synchronously — GitHub gives webhook receivers a 5-second
budget, and a real branch import involves N+1 GitHub API round-trips
plus an S3 upload pass; missing the budget makes GitHub mark the
delivery as failed and start retrying, which we then dedupe via
``github_sync_log``. Cleaner: 200 fast, run async.

References
----------
* GitHub webhook docs: https://docs.github.com/en/webhooks
* Signature verification: HMAC-SHA256 hex of the raw request body
  using ``webhook_secret`` as the key.
"""
from __future__ import annotations

import hmac
from hashlib import sha256
from typing import Optional

from src.repo.github_integration.repository import GithubIntegrationRepository
from src.utils.logger import log_error, log_info, log_warning


class WebhookRejection(Exception):
    """Raised when a webhook delivery is rejected (signature mismatch,
    no integration found, unsupported event, etc.). HTTP layer turns
    this into 4xx with the supplied message.
    """

    def __init__(self, status: int, message: str):
        self.status = status
        super().__init__(message)


def verify_signature(secret: str, raw_body: bytes, signature_header: str) -> bool:
    """Constant-time HMAC verify of ``X-Hub-Signature-256``.

    Header format is ``sha256=<hex>``. Returns False on any malformed
    input — the caller should refuse.
    """
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    expected = signature_header[len("sha256="):].strip()
    if not expected:
        return False
    mac = hmac.new(secret.encode("utf-8"), raw_body, sha256).hexdigest()
    return hmac.compare_digest(mac, expected)


async def handle_webhook(
    raw_body: bytes,
    headers: dict,
    json_payload: dict,
) -> dict:
    """Top-level webhook entry. Returns a small ack dict that the
    router serialises as JSON.

    Steps:
        1. Parse the event type. We only act on ``push`` events.
        2. Look up the integration by ``(owner, repo_name)``. If none
           is bound, we 200 the delivery to keep GitHub happy but log
           the orphan for ops to review.
        3. Verify HMAC. Reject 401 on mismatch.
        4. If the push was for the wrong branch, ack-and-skip.
        5. Idempotency on ``git_sha``: if already imported, ack.
        6. Schedule the import (fire-and-forget asyncio task — same
           process can run it; production deployments should switch
           to the ARQ job in ``infra.scheduler.jobs.github_import_job``).
    """
    event_type = headers.get("x-github-event", "").lower()
    delivery_id = headers.get("x-github-delivery", "?")
    log_info(f"[GithubWebhook] event={event_type} delivery={delivery_id}")

    if event_type == "ping":
        return {"status": "ok", "event": "ping"}

    if event_type != "push":
        # Silently accept other events so GitHub stops retrying. Logs
        # so we know to add handling later.
        log_info(f"[GithubWebhook] ignoring unsupported event={event_type}")
        return {"status": "ignored", "event": event_type}

    repo_obj = json_payload.get("repository") or {}
    owner = (repo_obj.get("owner") or {}).get("login")
    repo_name = repo_obj.get("name")
    pushed_ref = json_payload.get("ref", "")  # e.g. "refs/heads/main"
    pushed_sha = json_payload.get("after")

    if not owner or not repo_name:
        raise WebhookRejection(400, "missing repository.owner.login / repository.name")

    pushed_branch = pushed_ref.removeprefix("refs/heads/") if pushed_ref else ""
    integ_repo = GithubIntegrationRepository()
    rows = await integ_repo.find_by_repo(owner, repo_name)
    if not rows:
        log_warning(
            f"[GithubWebhook] no integration bound to {owner}/{repo_name}; "
            f"acking delivery"
        )
        return {"status": "no_integration", "delivery_id": delivery_id}

    # One repo can be bound to multiple PuppyOne projects (different
    # users / orgs). Handle each independently.
    results: list[dict] = []
    for integration in rows:
        result = await _maybe_dispatch(integration, pushed_branch, pushed_sha,
                                       raw_body, headers)
        results.append(result)
    return {"status": "ok", "delivery_id": delivery_id, "results": results}


async def _maybe_dispatch(
    integration: dict, pushed_branch: str, pushed_sha: Optional[str],
    raw_body: bytes, headers: dict,
) -> dict:
    """Validate signature + branch + idempotency for one integration,
    then schedule the import job."""
    integ_id = integration["id"]
    secret = integration.get("webhook_secret")

    if not secret:
        log_warning(
            f"[GithubWebhook] integration={integ_id} has no webhook_secret; "
            f"refusing delivery"
        )
        return {"integration_id": integ_id, "status": "skipped",
                "reason": "no_webhook_secret"}

    sig_header = headers.get("x-hub-signature-256", "")
    if not verify_signature(secret, raw_body, sig_header):
        log_error(f"[GithubWebhook] HMAC mismatch for integration={integ_id}")
        raise WebhookRejection(401, "signature mismatch")

    if integration.get("default_branch") and pushed_branch != integration["default_branch"]:
        return {"integration_id": integ_id, "status": "skipped",
                "reason": f"branch_mismatch ({pushed_branch} vs {integration['default_branch']})"}

    if not integration.get("auto_import"):
        return {"integration_id": integ_id, "status": "skipped",
                "reason": "auto_import_disabled"}

    if pushed_sha and integration.get("last_imported_sha") == pushed_sha:
        return {"integration_id": integ_id, "status": "skipped",
                "reason": "already_imported"}

    # Schedule the import. We don't block the webhook ack on it.
    import asyncio

    from src.repo.github_integration.importer import import_branch
    coro = import_branch(integration, branch=pushed_branch,
                         force=False, triggered_by="webhook")

    def _on_done(task: "asyncio.Task") -> None:
        # Without this callback, exceptions raised inside the import
        # coroutine die silently in ``Task.__del__`` (asyncio reports
        # "Task exception was never retrieved" but the message is easy
        # to miss in production logs and there is no surface in the
        # github_sync_log table). Promote the exception to a real log
        # line keyed by integration so ops can correlate against the
        # GitHub webhook delivery id (``X-GitHub-Delivery``).
        if task.cancelled():
            return
        exc = task.exception()
        if exc is not None:
            log_error(
                f"[GithubWebhook] background import failed "
                f"integration={integ_id}: {exc!r}"
            )

    try:
        loop = asyncio.get_running_loop()
        task = loop.create_task(coro)
        task.add_done_callback(_on_done)
    except RuntimeError:
        # No running loop — sync caller. Run to completion. ``asyncio.run``
        # raises any exception directly so the caller sees the failure;
        # no extra wrapping needed.
        asyncio.run(coro)

    return {"integration_id": integ_id, "status": "queued"}
