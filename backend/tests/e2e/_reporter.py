from __future__ import annotations

import json
import traceback
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def default_report_path() -> Path:
    # 固定输出到 tests/e2e 下，方便用户直接查看
    return Path(__file__).resolve().parent / "e2e_result.md"


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _md_code_block(data: str, *, lang: str = "text") -> str:
    return f"```{lang}\n{data}\n```"


def _json_dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, indent=2, default=str)


@dataclass
class E2EReporter:
    """
    一个极轻量的 e2e 结果收集器：
    - 每个 step 同时 print 与写入 markdown 文件
    - 避免泄露敏感信息：不要写入任何环境变量/密钥
    """

    path: Path = field(default_factory=default_report_path)
    suite_name: str = "turbopuffer-e2e"
    run_id: str = field(default_factory=lambda: f"{_utc_now_iso()}")
    _lines: list[str] = field(default_factory=list)
    _started: bool = False

    def start(self) -> None:
        if self._started:
            return
        self._started = True
        self._lines = [
            f"## E2E 测试报告：{self.suite_name}",
            "",
            f"- **run_id**: `{self.run_id}`",
            f"- **generated_at**: `{_utc_now_iso()}`",
            "",
            "### 结果明细",
            "",
        ]
        self._flush()

    def log_ok(self, name: str, *, details: Any | None = None, data: Any | None = None) -> None:
        self._log(name=name, ok=True, details=details, data=data, exc=None)

    def log_fail(
        self,
        name: str,
        *,
        details: Any | None = None,
        data: Any | None = None,
        exc: BaseException | None = None,
    ) -> None:
        self._log(name=name, ok=False, details=details, data=data, exc=exc)

    def _log(
        self,
        *,
        name: str,
        ok: bool,
        details: Any | None,
        data: Any | None,
        exc: BaseException | None,
    ) -> None:
        self.start()

        status = "✅ PASS" if ok else "❌ FAIL"
        self._lines.append(f"#### {status} `{name}`")
        self._lines.append("")
        self._lines.append(f"- **time**: `{_utc_now_iso()}`")

        if details is not None:
            self._lines.append("")
            self._lines.append("**details**")
            self._lines.append("")
            self._lines.append(_md_code_block(_json_dumps(details), lang="json"))

        if data is not None:
            self._lines.append("")
            self._lines.append("**data**")
            self._lines.append("")
            self._lines.append(_md_code_block(_json_dumps(data), lang="json"))

        if exc is not None:
            tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
            self._lines.append("")
            self._lines.append("**exception**")
            self._lines.append("")
            self._lines.append(_md_code_block(tb, lang="text"))

        self._lines.append("")
        self._flush()

        # 同步到控制台（用户可用 -s 查看）
        print(f"[{status}] {name}")
        if details is not None:
            print("details:", _json_dumps(details))
        if data is not None:
            print("data:", _json_dumps(data))
        if exc is not None:
            print("exception:", tb)

    def finalize(self, *, summary: dict[str, Any] | None = None) -> None:
        self.start()
        self._lines.append("### 汇总")
        self._lines.append("")
        if summary is None:
            summary = {}
        self._lines.append(_md_code_block(_json_dumps(summary), lang="json"))
        self._lines.append("")
        self._flush()

    def _flush(self) -> None:
        self.path.write_text("\n".join(self._lines) + "\n", encoding="utf-8")
