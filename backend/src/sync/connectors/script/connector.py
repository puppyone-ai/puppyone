"""
Script Connector — hosted script execution in sandboxed environments.

Users upload a script (Python / Node / Shell) via CLI or Web UI.
The platform stores it, triggers execution on schedule/manual/webhook,
installs dependencies, captures structured stdout, and commits the
result through CollaborationService.

Output protocol:
  The script MUST print a single JSON object to stdout:
  {
    "content": <any>,            # required — data to store
    "node_type": "json",         # optional — "json" | "markdown" | "file"
    "name": "My Data",           # optional — node display name
    "summary": "Fetched 42 rows" # optional — audit log description
  }

  If stdout is not valid JSON, the raw text is stored as markdown.

Config stored in connections.config:
  {
    "script_content": "...",     # inline script (< 64KB)
    "script_s3_key": "...",      # S3 key for larger scripts
    "runtime": "python",         # "python" | "node" | "shell"
    "timeout": 60,               # max execution time in seconds
    "requirements": "requests,beautifulsoup4",  # auto-installed deps
    "env": { "API_KEY": "..." }, # environment variables (secrets)
    "entrypoint": "main.py"      # filename override
  }
"""

import hashlib
import json
import uuid
from typing import Optional

from src.sync.connectors._base import (
    BaseConnector,
    ConnectorSpec,
    Capability,
    AuthRequirement,
    TriggerMode,
    FetchResult,
    Credentials,
    ConfigField,
)
from src.utils.logger import log_info, log_error

RUNTIME_COMMANDS = {
    "python": "python3",
    "node": "node",
    "shell": "bash",
}

RUNTIME_EXTENSIONS = {
    "python": ".py",
    "node": ".js",
    "shell": ".sh",
}

DEP_INSTALL_COMMANDS = {
    "python": "pip install -q {deps}",
    "node": "npm install --silent {deps}",
}

MAX_INLINE_SIZE = 64 * 1024  # 64KB


class ScriptConnector(BaseConnector):

    def spec(self) -> ConnectorSpec:
        return ConnectorSpec(
            provider="script",
            display_name="Custom Script",
            capabilities=Capability.PULL | Capability.INCREMENTAL,
            supported_directions=["inbound"],
            default_trigger=TriggerMode.MANUAL,
            default_node_type="json",
            auth=AuthRequirement.NONE,
            supported_sync_modes=("manual", "scheduled"),
            default_sync_mode="manual",
            config_fields=(
                ConfigField(
                    key="runtime",
                    label="Runtime",
                    type="select",
                    default="python",
                    required=True,
                    options=[
                        {"value": "python", "label": "Python 3"},
                        {"value": "node", "label": "Node.js"},
                        {"value": "shell", "label": "Shell (bash)"},
                    ],
                ),
                ConfigField(
                    key="script_content",
                    label="Script content or file path (CLI reads file automatically)",
                    type="text",
                    required=True,
                    placeholder="import requests; ...",
                ),
                ConfigField(
                    key="requirements",
                    label="Dependencies (comma-separated, auto-installed before run)",
                    type="text",
                    placeholder="requests,beautifulsoup4",
                ),
                ConfigField(
                    key="timeout",
                    label="Timeout (seconds)",
                    type="number",
                    default=60,
                ),
                ConfigField(
                    key="entrypoint",
                    label="Entry filename override",
                    type="text",
                    placeholder="main.py",
                ),
                ConfigField(
                    key="env",
                    label="Environment variables as JSON",
                    type="text",
                    placeholder='{"API_KEY": "xxx"}',
                ),
            ),
        )

    async def fetch(self, config: dict, credentials: Credentials) -> FetchResult:
        runtime = config.get("runtime", "python")
        script_content = config.get("script_content", "")
        script_s3_key = config.get("script_s3_key")
        timeout = min(int(config.get("timeout", 60)), 300)
        requirements = config.get("requirements", "")
        env_vars = config.get("env") or {}
        if isinstance(env_vars, str):
            try:
                env_vars = json.loads(env_vars)
            except json.JSONDecodeError:
                env_vars = {}
        entrypoint = config.get("entrypoint") or f"script{RUNTIME_EXTENSIONS.get(runtime, '.py')}"

        if not script_content and not script_s3_key:
            raise ValueError("No script provided. Set script_content or script_s3_key in config.")

        if script_s3_key and not script_content:
            script_content = await self._load_from_s3(script_s3_key)

        stdout = await self._execute_in_sandbox(
            script_content=script_content,
            runtime=runtime,
            entrypoint=entrypoint,
            timeout=timeout,
            env_vars=env_vars,
            requirements=requirements,
        )

        return self._parse_output(stdout)

    async def _execute_in_sandbox(
        self,
        script_content: str,
        runtime: str,
        entrypoint: str,
        timeout: int,
        env_vars: dict,
        requirements: str = "",
    ) -> str:
        from src.sandbox.service import SandboxService

        sandbox = SandboxService()
        session_id = f"script-{uuid.uuid4().hex[:12]}"

        try:
            await sandbox.start(session_id, data=None, readonly=False)

            # Install dependencies if declared
            if requirements:
                await self._install_deps(sandbox, session_id, runtime, requirements)

            write_cmd = f"cat > /workspace/{entrypoint} << 'PUPPYONE_SCRIPT_EOF'\n{script_content}\nPUPPYONE_SCRIPT_EOF"
            await sandbox.exec(session_id, write_cmd)

            if entrypoint.endswith(".sh"):
                await sandbox.exec(session_id, f"chmod +x /workspace/{entrypoint}")

            env_prefix = " ".join(f"{k}={v}" for k, v in env_vars.items()) if env_vars else ""
            run_cmd = RUNTIME_COMMANDS.get(runtime, "python3")
            full_cmd = f"cd /workspace && timeout {timeout} {env_prefix} {run_cmd} {entrypoint} 2>&1"

            result = await sandbox.exec(session_id, full_cmd)

            exit_code = result.get("exit_code", -1)
            stdout = result.get("output", "")

            if exit_code != 0:
                log_error(f"[ScriptConnector] Script exited with code {exit_code}: {stdout[-500:]}")
                raise RuntimeError(f"Script failed (exit code {exit_code}): {stdout[-200:]}")

            return stdout

        finally:
            try:
                await sandbox.stop(session_id)
            except Exception:
                pass

    async def _install_deps(
        self, sandbox, session_id: str, runtime: str, requirements: str,
    ) -> None:
        template = DEP_INSTALL_COMMANDS.get(runtime)
        if not template:
            return
        deps = " ".join(d.strip() for d in requirements.split(",") if d.strip())
        if not deps:
            return
        cmd = template.format(deps=deps)
        log_info(f"[ScriptConnector] Installing deps: {cmd}")
        result = await sandbox.exec(session_id, cmd)
        exit_code = result.get("exit_code", -1)
        if exit_code != 0:
            output = result.get("output", "")
            raise RuntimeError(f"Dependency install failed (exit {exit_code}): {output[-300:]}")

    def _parse_output(self, stdout: str) -> FetchResult:
        stdout = stdout.strip()

        if not stdout:
            raise ValueError("Script produced no output")

        try:
            data = json.loads(stdout)
        except json.JSONDecodeError:
            content_hash = hashlib.sha256(stdout.encode()).hexdigest()[:16]
            return FetchResult(
                content=stdout,
                content_hash=content_hash,
                node_type="markdown",
                node_name="Script Output",
                summary="Script produced non-JSON output, stored as markdown",
            )

        content = data.get("content", data)
        node_type = data.get("node_type", "json")
        node_name = data.get("name", "Script Output")
        summary = data.get("summary", "Script executed successfully")

        content_hash = hashlib.sha256(
            json.dumps(content, sort_keys=True, default=str).encode()
        ).hexdigest()[:16]

        return FetchResult(
            content=content,
            content_hash=content_hash,
            node_type=node_type,
            node_name=node_name,
            summary=summary,
        )

    async def _load_from_s3(self, s3_key: str) -> str:
        from src.s3.service import S3Service

        s3 = S3Service()
        data = await s3.get_object(s3_key)
        if isinstance(data, bytes):
            return data.decode("utf-8")
        return str(data)
