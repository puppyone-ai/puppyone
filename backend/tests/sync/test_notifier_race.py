import asyncio

import pytest

from src.sync.notifier import ChangeNotifier


@pytest.mark.asyncio
async def test_wait_for_changes_handles_notify_before_wait():
    notifier = ChangeNotifier()
    notifier.notify("project-1")

    changed = await notifier.wait_for_changes("project-1", timeout=0.05)
    assert changed is True


@pytest.mark.asyncio
async def test_wait_for_changes_wakes_all_concurrent_waiters():
    notifier = ChangeNotifier()

    waiter1 = asyncio.create_task(notifier.wait_for_changes("project-1", timeout=0.5))
    waiter2 = asyncio.create_task(notifier.wait_for_changes("project-1", timeout=0.5))

    await asyncio.sleep(0.01)
    notifier.notify("project-1")

    changed1, changed2 = await asyncio.gather(waiter1, waiter2)
    assert changed1 is True
    assert changed2 is True


@pytest.mark.asyncio
async def test_wait_for_changes_times_out_without_notify():
    notifier = ChangeNotifier()
    changed = await notifier.wait_for_changes("project-1", timeout=0.01)
    assert changed is False
