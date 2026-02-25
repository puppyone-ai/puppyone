from types import SimpleNamespace

from src.sync.folder_sync import FolderSyncService


class FakeS3Client:
    def generate_presigned_url(self, ClientMethod, Params, ExpiresIn):  # noqa: N803
        return f"https://example.test/{Params['Key']}"


class FakeS3Service:
    bucket_name = "bucket"

    def __init__(self):
        self.client = FakeS3Client()


class FakeNodeRepo:
    def __init__(self, existing=None):
        self._existing = dict(existing or {})
        self.lookup_names: list[str] = []
        self.created: list[dict] = []

    def get_child_by_name(self, project_id: str, parent_id: str, name: str):
        self.lookup_names.append(name)
        return self._existing.get((project_id, parent_id, name))

    def create(
        self,
        *,
        project_id: str,
        name: str,
        node_type: str,
        id_path: str,
        parent_id: str,
        created_by: str,
        s3_key: str,
        mime_type: str,
        size_bytes: int,
        **kwargs,
    ):
        node_id = id_path.split("/")[-1]
        node = SimpleNamespace(
            id=node_id,
            name=name,
            type=node_type,
            s3_key=s3_key,
            current_version=0,
        )
        self.created.append(
            {
                "project_id": project_id,
                "parent_id": parent_id,
                "name": name,
                "node_type": node_type,
                "s3_key": s3_key,
                "mime_type": mime_type,
                "size_bytes": size_bytes,
            }
        )
        self._existing[(project_id, parent_id, name)] = node
        return node


def _build_service(node_repo: FakeNodeRepo) -> FolderSyncService:
    svc = object.__new__(FolderSyncService)
    svc._node_repo = node_repo
    svc._s3 = FakeS3Service()
    svc._get_project_owner = lambda project_id: "owner-1"
    return svc


def test_request_upload_url_keeps_binary_extension():
    repo = FakeNodeRepo()
    svc = _build_service(repo)

    result = svc.request_upload_url(
        project_id="project-1",
        folder_id="folder-1",
        filename="report.pdf",
        content_type="application/pdf",
        size_bytes=12,
        operator_id="sync:1",
    )

    assert result["ok"] is True
    assert repo.created[0]["name"] == "report.pdf"
    assert "report.pdf" in repo.created[0]["s3_key"]


def test_request_upload_url_reuses_existing_binary_node():
    existing = SimpleNamespace(
        id="node-report",
        name="report.pdf",
        type="file",
        s3_key="projects/project-1/openclaw/node-report/report.pdf",
    )
    repo = FakeNodeRepo(existing={
        ("project-1", "folder-1", "report.pdf"): existing,
    })
    svc = _build_service(repo)

    result = svc.request_upload_url(
        project_id="project-1",
        folder_id="folder-1",
        filename="report.pdf",
        content_type="application/pdf",
        size_bytes=24,
        operator_id="sync:1",
    )

    assert result["ok"] is True
    assert repo.created == []
    assert repo.lookup_names[0] == "report.pdf"


def test_find_node_by_path_prefers_exact_binary_name():
    binary = SimpleNamespace(id="file-1", name="report.pdf", type="file")
    inline = SimpleNamespace(id="md-1", name="report", type="markdown")
    repo = FakeNodeRepo(existing={
        ("project-1", "folder-1", "report.pdf"): binary,
        ("project-1", "folder-1", "report"): inline,
    })
    svc = _build_service(repo)

    found = svc._find_node_by_path("project-1", "folder-1", "report.pdf")
    assert found is binary


def test_find_node_by_path_falls_back_for_markdown_legacy_name():
    inline = SimpleNamespace(id="md-1", name="note", type="markdown")
    repo = FakeNodeRepo(existing={
        ("project-1", "folder-1", "note"): inline,
    })
    svc = _build_service(repo)

    found = svc._find_node_by_path("project-1", "folder-1", "note.md")
    assert found is inline
