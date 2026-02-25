from types import SimpleNamespace

from src.collaboration.version_service import VersionService


class FakeNodeRepo:
    def __init__(self, node):
        self._node = node
        self.update_calls: list[dict] = []

    def get_by_id(self, node_id: str):
        if node_id == self._node.id:
            return self._node
        return None

    def update(self, **kwargs):
        self.update_calls.append(kwargs)
        return self._node


class FakeVersionRepo:
    def __init__(self, old_version):
        self._old_version = old_version
        self.create_calls: list[dict] = []

    def get_by_node_and_version(self, node_id: str, version: int):
        if node_id == "node-1" and version == 3:
            return self._old_version
        return None

    def create(self, **kwargs):
        self.create_calls.append(kwargs)
        return SimpleNamespace(**kwargs)


class FakeSnapshotRepo:
    pass


class FakeChangelogRepo:
    def __init__(self):
        self.append_calls: list[dict] = []

    def append(self, **kwargs):
        self.append_calls.append(kwargs)
        return SimpleNamespace(id=1, **kwargs)


class FakeNotifier:
    def __init__(self):
        self.notify_calls: list[str] = []

    def notify(self, project_id: str):
        self.notify_calls.append(project_id)


def test_rollback_file_emits_sync_changelog(monkeypatch):
    node = SimpleNamespace(
        id="node-1",
        current_version=5,
        project_id="project-1",
        parent_id="folder-1",
        type="markdown",
        name="release-notes",
    )
    old_version = SimpleNamespace(
        content_json=None,
        content_text="# restored",
        s3_key=None,
        content_hash="hash-restored",
        size_bytes=42,
    )

    changelog_repo = FakeChangelogRepo()
    fake_notifier = FakeNotifier()
    monkeypatch.setattr(
        "src.sync.notifier.ChangeNotifier.get_instance",
        classmethod(lambda cls: fake_notifier),
    )

    svc = VersionService(
        node_repo=FakeNodeRepo(node),
        version_repo=FakeVersionRepo(old_version),
        snapshot_repo=FakeSnapshotRepo(),
        s3_service=SimpleNamespace(),
        changelog_repo=changelog_repo,
    )

    result = svc.rollback_file(node_id="node-1", target_version=3, operator_id="u-1")

    assert result.new_version == 6
    assert result.rolled_back_to == 3
    assert len(changelog_repo.append_calls) == 1

    call = changelog_repo.append_calls[0]
    assert call["project_id"] == "project-1"
    assert call["node_id"] == "node-1"
    assert call["action"] == "update"
    assert call["node_type"] == "markdown"
    assert call["version"] == 6
    assert call["hash"] == "hash-restored"
    assert call["folder_id"] == "folder-1"
    assert call["filename"] == "release-notes.md"
    assert fake_notifier.notify_calls == ["project-1"]
