from __future__ import annotations

import pytest
from fastapi import HTTPException

from src.platform.auth.models import CurrentUser
from src.version_engine.domain.intents import ProjectWriteState
from src.version_engine.entrypoints.http import content_write
from src.version_engine.entrypoints.http.schemas import MoveRequest


class _FakeOps:
    def get_project_write_state(
        self,
        project_id: str,
        user_id: str,
    ) -> ProjectWriteState:
        return ProjectWriteState(
            project_id=project_id,
            project_name="Test Project",
            role="editor",
            can_write=True,
        )


class _FakeCommands:
    def __init__(self):
        self.ops = _FakeOps()
        self.move_args: tuple[str, str, str] | None = None

    def normalize_path(self, path: str) -> str:
        return path.strip("/")

    async def move(self, project_id: str, old_path: str, new_path: str, **kwargs):
        self.move_args = (project_id, old_path, new_path)
        raise ValueError("cannot move 'old' into its own subtree: 'old/sub/old'")


@pytest.mark.asyncio
async def test_move_route_returns_400_for_invalid_move_destination():
    commands = _FakeCommands()

    with pytest.raises(HTTPException) as exc:
        await content_write.move(
            "test-proj",
            MoveRequest(old_path="old", new_path="old/sub/old"),
            commands=commands,
            current_user=CurrentUser(user_id="u1", role="authenticated"),
        )

    assert exc.value.status_code == 400
    assert "own subtree" in exc.value.detail
    assert commands.move_args == ("test-proj", "old", "old/sub/old")
