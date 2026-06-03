from __future__ import annotations

from types import SimpleNamespace

from src.connectors.datasource.run_repository import SyncRunRepository


class FakeQuery:
    def __init__(self, rows: list[dict]):
        self.rows = rows
        self.eq_filters: list[tuple[str, object]] = []
        self.in_filters: list[tuple[str, set]] = []
        self.limit_value: int | None = None
        self.order_col: str | None = None
        self.order_desc = False

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, col, value):
        self.eq_filters.append((col, value))
        return self

    def in_(self, col, values):
        self.in_filters.append((col, set(values)))
        return self

    def order(self, col, *, desc=False, **_kwargs):
        self.order_col = col
        self.order_desc = desc
        return self

    def limit(self, value):
        self.limit_value = value
        return self

    def execute(self):
        rows = list(self.rows)
        for col, value in self.eq_filters:
            rows = [row for row in rows if row.get(col) == value]
        for col, values in self.in_filters:
            rows = [row for row in rows if row.get(col) in values]
        if self.order_col:
            rows.sort(
                key=lambda row: row.get(self.order_col) or "",
                reverse=self.order_desc,
            )
        if self.limit_value is not None:
            rows = rows[: self.limit_value]
        return SimpleNamespace(data=rows)


class FakeClient:
    def __init__(self, tables: dict[str, list[dict]]):
        self.tables = tables

    def table(self, name):
        return FakeQuery(self.tables.get(name, []))


def test_list_failed_for_access_points_reads_sync_runs_by_connection_id():
    repo = SyncRunRepository(SimpleNamespace(client=FakeClient({
        "sync_runs": [
            {
                "id": "run-newer",
                "connection_id": "conn-1",
                "status": "failed",
                "started_at": "2026-06-03T02:00:00+00:00",
            },
            {
                "id": "run-ok",
                "connection_id": "conn-1",
                "status": "completed",
                "started_at": "2026-06-03T03:00:00+00:00",
            },
            {
                "id": "run-older",
                "connection_id": "conn-2",
                "status": "failed",
                "started_at": "2026-06-03T01:00:00+00:00",
            },
            {
                "id": "run-other",
                "connection_id": "conn-3",
                "status": "failed",
                "started_at": "2026-06-03T04:00:00+00:00",
            },
        ],
    })))

    rows = repo.list_failed_for_access_points(["conn-1", "conn-2"], limit=10)

    assert [row.id for row in rows] == ["run-newer", "run-older"]
    assert [row.access_point_id for row in rows] == ["conn-1", "conn-2"]
