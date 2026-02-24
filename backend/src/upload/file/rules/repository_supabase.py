"""
ETL Rule Repository - Supabase Implementation

管理 ETL 转换规则的存储和检索 (Supabase 数据库实现)。
"""

import logging
import uuid
from datetime import datetime, UTC
from typing import Optional

from src.upload.file.rules.schemas import (
    ETLRule,
    RuleCreateRequest,
    RuleUpdateRequest,
    build_rule_payload,
    parse_rule_payload,
)
from src.supabase.exceptions import handle_supabase_error

logger = logging.getLogger(__name__)


def _parse_timestamp(
    timestamp_str: str | None, fallback: str | None = None
) -> datetime:
    """
    安全地解析时间戳字符串。

    Args:
        timestamp_str: 时间戳字符串
        fallback: 备用时间戳字符串

    Returns:
        解析后的 datetime 对象
    """
    ts = timestamp_str or fallback
    if ts is None:
        return datetime.now(UTC)

    # 处理 Supabase 返回的时间戳格式（可能带 Z 后缀）
    if isinstance(ts, str):
        ts = ts.replace("Z", "+00:00")
    return datetime.fromisoformat(ts)


class RuleRepositorySupabase:
    """Repository for ETL transformation rules (Supabase storage)."""

    TABLE_NAME = "etl_rule"

    def __init__(self, supabase_client, user_id: Optional[str] = None):
        """
        初始化 Supabase rule repository.

        Args:
            supabase_client: Supabase client 实例
            user_id: 用户 ID，用于过滤和关联规则
        """
        self.supabase = supabase_client
        self.user_id = user_id
        logger.info(f"RuleRepositorySupabase initialized for user_id: {user_id}")

    def create_rule(self, request: RuleCreateRequest) -> ETLRule:
        """
        创建新的 ETL 规则。

        Args:
            request: 规则创建请求

        Returns:
            创建的 ETLRule

        Raises:
            SupabaseException: 数据库操作失败时
        """
        # 生成唯一规则 ID（历史遗留：Supabase 使用 bigint 主键，这里仅用于追踪/兼容）
        _ = str(uuid.uuid4())
        now = datetime.now(UTC)

        payload = build_rule_payload(
            json_schema=request.json_schema,
            postprocess_mode=request.postprocess_mode,
            postprocess_strategy=request.postprocess_strategy,
        )

        # 准备插入数据
        insert_data = {
            "name": request.name,
            "description": request.description,
            "json_schema": payload,
            "system_prompt": request.system_prompt or "",
            "user_id": self.user_id,
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
        }

        try:
            # 插入到数据库
            response = (
                self.supabase.table(self.TABLE_NAME).insert(insert_data).execute()
            )

            if not response.data or len(response.data) == 0:
                raise Exception("Failed to create rule: no data returned")

            # 获取插入的记录
            row = response.data[0]
            mode, strategy, schema = parse_rule_payload(row["json_schema"])

            rule = ETLRule(
                rule_id=str(row["id"]),
                name=row["name"],
                description=row["description"],
                json_schema=schema,
                postprocess_mode=mode,
                postprocess_strategy=strategy,
                system_prompt=row["system_prompt"],
                created_at=_parse_timestamp(row.get("created_at")),
                updated_at=_parse_timestamp(
                    row.get("updated_at"), row.get("created_at")
                ),
            )

            logger.info(f"Created rule: {rule.name} (id: {row['id']})")
            return rule

        except Exception as e:
            handle_supabase_error(e, "创建 ETL 规则")

    def get_rule(self, rule_id: str) -> Optional[ETLRule]:
        """
        根据 ID 获取规则。

        Args:
            rule_id: 规则标识符

        Returns:
            如果找到返回 ETLRule，否则返回 None
        """
        try:
            # 将 rule_id 转换为 bigint
            try:
                id_int = int(rule_id)
            except ValueError:
                logger.warning(f"Invalid rule_id format: {rule_id}")
                return None

            query = self.supabase.table(self.TABLE_NAME).select("*").eq("id", id_int)

            # 如果指定了 user_id，添加过滤
            if self.user_id is not None:
                query = query.eq("user_id", self.user_id)

            response = query.execute()

            if not response.data or len(response.data) == 0:
                logger.warning(f"Rule not found: {rule_id}")
                return None

            row = response.data[0]
            mode, strategy, schema = parse_rule_payload(row["json_schema"])

            # 从数据库记录构建 ETLRule
            rule = ETLRule(
                rule_id=str(row["id"]),
                name=row.get("name", ""),
                description=row["description"],
                json_schema=schema,
                postprocess_mode=mode,
                postprocess_strategy=strategy,
                system_prompt=row["system_prompt"] or None,
                created_at=_parse_timestamp(row.get("created_at")),
                updated_at=_parse_timestamp(
                    row.get("updated_at"), row.get("created_at")
                ),
            )

            return rule

        except Exception as e:
            logger.error(f"Error getting rule {rule_id}: {e}")
            return None

    def update_rule(
        self, rule_id: str, request: RuleUpdateRequest
    ) -> Optional[ETLRule]:
        """
        更新现有规则。

        Args:
            rule_id: 规则标识符
            request: 更新请求

        Returns:
            如果找到返回更新后的 ETLRule，否则返回 None

        Raises:
            SupabaseException: 数据库操作失败时
        """
        # 先检查规则是否存在
        existing_rule = self.get_rule(rule_id)
        if not existing_rule:
            return None

        # 准备更新数据
        update_data: dict = {}
        if request.name is not None:
            update_data["name"] = request.name
        if request.description is not None:
            update_data["description"] = request.description
        if request.system_prompt is not None:
            update_data["system_prompt"] = request.system_prompt

        # Handle json_schema + postprocess config as a single payload
        if (
            request.json_schema is not None
            or request.postprocess_mode is not None
            or request.postprocess_strategy is not None
        ):
            # Load existing payload to merge
            mode, strategy, schema = parse_rule_payload(existing_rule.json_schema)
            next_mode = request.postprocess_mode or mode
            next_strategy = (
                request.postprocess_strategy
                if request.postprocess_strategy is not None
                else strategy
            )
            next_schema = (
                request.json_schema if request.json_schema is not None else schema
            )
            update_data["json_schema"] = build_rule_payload(
                json_schema=next_schema,
                postprocess_mode=next_mode,
                postprocess_strategy=next_strategy,
            )

        if not update_data:
            # 没有需要更新的字段
            return existing_rule

        # 添加 updated_at 时间戳
        update_data["updated_at"] = datetime.now(UTC).isoformat()

        try:
            # 将 rule_id 转换为 bigint
            id_int = int(rule_id)

            query = (
                self.supabase.table(self.TABLE_NAME)
                .update(update_data)
                .eq("id", id_int)
            )

            # 如果指定了 user_id，添加过滤
            if self.user_id is not None:
                query = query.eq("user_id", self.user_id)

            response = query.execute()

            if not response.data or len(response.data) == 0:
                logger.warning(f"Rule not found for update: {rule_id}")
                return None

            row = response.data[0]
            mode, strategy, schema = parse_rule_payload(row["json_schema"])

            # 构建更新后的 ETLRule
            rule = ETLRule(
                rule_id=str(row["id"]),
                name=row["name"],
                description=row["description"],
                json_schema=schema,
                postprocess_mode=mode,
                postprocess_strategy=strategy,
                system_prompt=row["system_prompt"] or None,
                created_at=_parse_timestamp(row.get("created_at")),
                updated_at=_parse_timestamp(
                    row.get("updated_at"), row.get("created_at")
                ),
            )

            logger.info(f"Updated rule: {rule_id}")
            return rule

        except Exception as e:
            handle_supabase_error(e, "更新 ETL 规则")

    def delete_rule(self, rule_id: str) -> bool:
        """
        删除规则。

        Args:
            rule_id: 规则标识符

        Returns:
            如果删除成功返回 True，如果未找到返回 False

        Raises:
            SupabaseException: 数据库操作失败时
        """
        try:
            # 将 rule_id 转换为 bigint
            try:
                id_int = int(rule_id)
            except ValueError:
                logger.warning(f"Invalid rule_id format: {rule_id}")
                return False

            query = self.supabase.table(self.TABLE_NAME).delete().eq("id", id_int)

            # 如果指定了 user_id，添加过滤
            if self.user_id is not None:
                query = query.eq("user_id", self.user_id)

            response = query.execute()

            if not response.data or len(response.data) == 0:
                logger.warning(f"Rule not found for deletion: {rule_id}")
                return False

            logger.info(f"Deleted rule: {rule_id}")
            return True

        except Exception as e:
            handle_supabase_error(e, "删除 ETL 规则")

    def list_rules(self, limit: int = 100, offset: int = 0) -> list[ETLRule]:
        """
        列出所有规则（支持分页）。

        Args:
            limit: 最大返回数量
            offset: 跳过的数量

        Returns:
            ETLRule 对象列表
        """
        try:
            query = self.supabase.table(self.TABLE_NAME).select("*")

            # 如果指定了 user_id，添加过滤
            if self.user_id is not None:
                query = query.eq("user_id", self.user_id)

            # 应用分页
            query = query.range(offset, offset + limit - 1).order(
                "created_at", desc=True
            )

            response = query.execute()

            rules = []
            for row in response.data:
                mode, strategy, schema = parse_rule_payload(row["json_schema"])
                rule = ETLRule(
                    rule_id=str(row["id"]),
                    name=row.get("name", ""),
                    description=row["description"],
                    json_schema=schema,
                    postprocess_mode=mode,
                    postprocess_strategy=strategy,
                    system_prompt=row["system_prompt"] or None,
                    created_at=_parse_timestamp(row.get("created_at")),
                    updated_at=_parse_timestamp(
                        row.get("updated_at"), row.get("created_at")
                    ),
                )
                rules.append(rule)

            logger.info(f"Listed {len(rules)} rules (offset={offset}, limit={limit})")
            return rules

        except Exception as e:
            logger.error(f"Error listing rules: {e}")
            return []

    def count_rules(self) -> int:
        """
        统计规则总数。

        Returns:
            规则总数
        """
        try:
            query = self.supabase.table(self.TABLE_NAME).select("id", count="exact")

            # 如果指定了 user_id，添加过滤
            if self.user_id is not None:
                query = query.eq("user_id", self.user_id)

            response = query.execute()

            count = response.count if response.count is not None else 0
            return count

        except Exception as e:
            logger.error(f"Error counting rules: {e}")
            return 0
