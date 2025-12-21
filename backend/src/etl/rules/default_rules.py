"""
Default ETL Rules

提供系统默认的 ETL 转换规则。
"""

from typing import Optional
import logging
from src.etl.rules.schemas import ETLRule, RuleCreateRequest
from src.etl.rules.repository_supabase import RuleRepositorySupabase

logger = logging.getLogger(__name__)


# 默认文档解析规则的配置
DEFAULT_DOCUMENT_PARSER_NAME = "default_document_parser"
DEFAULT_DOCUMENT_PARSER_DESCRIPTION = (
    "通用文档解析规则，适用于 PDF、DOC、DOCX、PPT、PPTX 以及图片等二进制文件。"
    "提取文档的标题、内容和元数据。"
)

DEFAULT_DOCUMENT_PARSER_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {
            "type": "string",
            "description": "文档的标题或主题"
        },
        "content": {
            "type": "string",
            "description": "文档的主要文本内容，保持原始结构和格式"
        },
        "metadata": {
            "type": "object",
            "description": "文档的元数据信息",
            "properties": {
                "page_count": {"type": "integer", "description": "页数（如果适用）"},
                "author": {"type": "string", "description": "作者（如果可获取）"},
                "created_date": {"type": "string", "description": "创建日期（如果可获取）"},
                "file_type": {"type": "string", "description": "文件类型"}
            }
        }
    },
    "required": ["content"]
}

DEFAULT_DOCUMENT_PARSER_SYSTEM_PROMPT = """你是一个专业的文档解析助手。请从提供的 Markdown 格式文档中提取结构化信息。

要求：
1. 提取文档的标题（通常是第一个标题或文档开头的主要标题）
2. 提取文档的完整文本内容，保持原有的结构和格式
3. 如果文档中包含元数据信息（如作者、日期、页数等），请提取到 metadata 字段中
4. 保持内容的完整性，不要遗漏重要信息
5. 如果文档是图片扫描件，请尽可能识别其中的文字内容

输出格式必须严格遵循提供的 JSON Schema。
"""


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
        if rule.name == DEFAULT_DOCUMENT_PARSER_NAME:
            logger.info(f"Found existing default rule: {rule.rule_id}")
            return rule
    
    # 如果不存在，创建新规则
    logger.info("Creating default document parser rule...")
    
    rule_request = RuleCreateRequest(
        name=DEFAULT_DOCUMENT_PARSER_NAME,
        description=DEFAULT_DOCUMENT_PARSER_DESCRIPTION,
        json_schema=DEFAULT_DOCUMENT_PARSER_SCHEMA,
        system_prompt=DEFAULT_DOCUMENT_PARSER_SYSTEM_PROMPT,
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

