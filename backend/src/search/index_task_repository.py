from __future__ import annotations

from typing import Any, Optional

from src.search.index_task import SearchIndexTask, SearchIndexTaskUpsert
from src.supabase.exceptions import handle_supabase_error


class SearchIndexTaskRepository:
    """
    Low-level repository for table: public.search_index_task
    """

    def __init__(self, client: Any):
        self._client = client

    def get_by_tool_id(self, tool_id: int) -> Optional[SearchIndexTask]:
        resp = (
            self._client.table("search_index_task")
            .select("*")
            .eq("tool_id", int(tool_id))
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            return None
        return SearchIndexTask(**rows[0])

    def upsert(self, task: SearchIndexTaskUpsert) -> SearchIndexTask:
        try:
            payload = task.to_db()
            # One task per tool_id
            resp = (
                self._client.table("search_index_task")
                .upsert(payload, on_conflict="tool_id")
                .execute()
            )
            rows = resp.data or []
            if not rows:
                # Supabase may return empty data depending on settings; re-read
                got = self.get_by_tool_id(task.tool_id)
                if got is None:
                    raise ValueError("search_index_task upsert returned empty result")
                return got
            return SearchIndexTask(**rows[0])
        except Exception as e:
            raise handle_supabase_error(e, "写入 search_index_task")
