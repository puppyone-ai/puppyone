"""
Default ETL Rules

提供系统默认的 ETL 转换规则。
"""

from typing import Optional
import logging
from src.etl.rules.schemas import ETLRule, RuleCreateRequest
from src.etl.rules.repository_supabase import RuleRepositorySupabase

logger = logging.getLogger(__name__)


# 全局默认规则：默认跳过 LLM，仅产出 markdown 指针 + 必要元信息
GLOBAL_DEFAULT_RULE_NAME = "global_default_etl_rule"
GLOBAL_DEFAULT_RULE_DESCRIPTION = (
    "系统内置的全局默认 ETL 规则（默认跳过 LLM），用于返回 OCR markdown 指针与元信息的稳定 JSON 包装。"
)

# 在 skip 模式下 json_schema 会被忽略；为了兼容存储与校验，这里给一个最小 schema
GLOBAL_DEFAULT_RULE_SCHEMA = {"type": "object"}


def get_or_create_default_rule(
    rule_repository: RuleRepositorySupabase,
) -> ETLRule:
    """
    获取或创建默认的文档解析规则。
    
    如果数据库中已存在同名规则，返回第一个；否则创建新规则。
    
    Args:
        rule_repository: ETL 规则仓库实例
    
    Returns:
        默认文档解析规则
    """
    # 尝试查找已存在的默认规则
    existing_rules = rule_repository.list_rules(limit=100)
    
    for rule in existing_rules:
        if rule.name == GLOBAL_DEFAULT_RULE_NAME:
            logger.info(f"Found existing global default rule: {rule.rule_id}")
            return rule
    
    # 如果不存在，创建新规则
    logger.info("Creating global default ETL rule (skip-llm)...")
    
    rule_request = RuleCreateRequest(
        name=GLOBAL_DEFAULT_RULE_NAME,
        description=GLOBAL_DEFAULT_RULE_DESCRIPTION,
        json_schema=GLOBAL_DEFAULT_RULE_SCHEMA,
        system_prompt=None,
        postprocess_mode="skip",
        postprocess_strategy=None,
    )
    
    rule = rule_repository.create_rule(rule_request)
    logger.info(f"Created default rule: {rule.rule_id}")
    
    return rule


def get_default_rule_id(rule_repository: RuleRepositorySupabase) -> int:
    """
    获取默认规则的 ID。
    
    Args:
        rule_repository: ETL 规则仓库实例
    
    Returns:
        默认规则的 ID（整数）
    """
    rule = get_or_create_default_rule(rule_repository)
    return int(rule.rule_id)

