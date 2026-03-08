"""ETL规则引擎单元测试

测试规则引擎的核心功能：
- Prompt构造
- JSON Schema验证
- LLM调用和重试机制
- 错误处理
"""

import json
from datetime import datetime, UTC
from unittest.mock import AsyncMock, Mock, patch

import pytest
from jsonschema import ValidationError

from src.upload.file.rules.engine import RuleEngine
from src.upload.file.rules.schemas import ETLRule, TransformationResult
from src.llm.exceptions import LLMError
from src.llm.schemas import TextModelResponse


# ============= Fixtures =============


@pytest.fixture
def mock_llm_service():
    """创建mock的LLM服务"""
    service = Mock()
    service.call_text_model = AsyncMock()
    return service


@pytest.fixture
def rule_engine(mock_llm_service):
    """创建规则引擎实例"""
    return RuleEngine(llm_service=mock_llm_service)


@pytest.fixture
def sample_rule():
    """创建测试用的规则"""
    now = datetime.now(UTC)
    return ETLRule(
        rule_id="test-rule-001",
        name="测试规则",
        description="提取标题和摘要",
        json_schema={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "summary": {"type": "string"}
            },
            "required": ["title", "summary"]
        },
        system_prompt="你是一个文档分析助手。",
        created_at=now,
        updated_at=now
    )


@pytest.fixture
def sample_markdown():
    """测试用的Markdown内容"""
    return """# 测试文档

这是一个测试文档的内容。

## 第一章节

这是第一章节的内容。

## 第二章节

这是第二章节的内容。
"""


# ============= Prompt构造测试 =============


def test_build_prompt(rule_engine, sample_rule, sample_markdown):
    """测试Prompt构造"""
    prompt = rule_engine._build_prompt(sample_markdown, sample_rule.json_schema)
    
    # 验证prompt包含必要的元素
    assert "JSON Schema" in prompt
    assert "Markdown Document" in prompt
    assert sample_markdown in prompt
    
    # 验证schema被正确格式化
    schema_str = json.dumps(sample_rule.json_schema, indent=2)
    assert schema_str in prompt
    
    # 验证包含指导性文字
    assert "extract" in prompt.lower() or "transform" in prompt.lower()
    assert "json" in prompt.lower()


def test_build_prompt_with_complex_schema(rule_engine, sample_markdown):
    """测试复杂schema的Prompt构造"""
    complex_schema = {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "sections": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "heading": {"type": "string"},
                        "content": {"type": "string"}
                    }
                }
            },
            "metadata": {
                "type": "object",
                "properties": {
                    "author": {"type": "string"},
                    "date": {"type": "string"}
                }
            }
        }
    }
    
    prompt = rule_engine._build_prompt(sample_markdown, complex_schema)
    
    # 验证嵌套结构被正确包含
    assert "sections" in prompt
    assert "metadata" in prompt
    assert "array" in prompt


def test_build_prompt_with_empty_markdown(rule_engine, sample_rule):
    """测试空Markdown内容的Prompt构造"""
    prompt = rule_engine._build_prompt("", sample_rule.json_schema)
    
    # 即使内容为空，prompt结构应该完整
    assert "JSON Schema" in prompt
    assert "Markdown Document" in prompt


# ============= JSON Schema验证测试 =============


def test_validate_output_success(rule_engine, sample_rule):
    """测试成功的JSON验证"""
    valid_output = {
        "title": "测试标题",
        "summary": "测试摘要"
    }
    
    is_valid, error = rule_engine.validate_output(valid_output, sample_rule.json_schema)
    
    assert is_valid is True
    assert error is None


def test_validate_output_missing_required_field(rule_engine, sample_rule):
    """测试缺少必需字段的验证"""
    invalid_output = {
        "title": "测试标题"
        # 缺少 summary
    }
    
    is_valid, error = rule_engine.validate_output(invalid_output, sample_rule.json_schema)
    
    assert is_valid is False
    assert error is not None
    assert "summary" in error.lower() or "required" in error.lower()


def test_validate_output_wrong_type(rule_engine, sample_rule):
    """测试类型错误的验证"""
    invalid_output = {
        "title": 123,  # 应该是string
        "summary": "测试摘要"
    }
    
    is_valid, error = rule_engine.validate_output(invalid_output, sample_rule.json_schema)
    
    assert is_valid is False
    assert error is not None


def test_validate_output_additional_properties(rule_engine):
    """测试额外属性的验证"""
    schema = {
        "type": "object",
        "properties": {
            "title": {"type": "string"}
        },
        "additionalProperties": False
    }
    
    output_with_extra = {
        "title": "测试",
        "extra_field": "不应该存在"
    }
    
    is_valid, error = rule_engine.validate_output(output_with_extra, schema)
    
    assert is_valid is False
    assert error is not None


def test_validate_output_nested_structure(rule_engine):
    """测试嵌套结构的验证"""
    schema = {
        "type": "object",
        "properties": {
            "sections": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "heading": {"type": "string"},
                        "content": {"type": "string"}
                    },
                    "required": ["heading", "content"]
                }
            }
        }
    }
    
    valid_output = {
        "sections": [
            {"heading": "标题1", "content": "内容1"},
            {"heading": "标题2", "content": "内容2"}
        ]
    }
    
    is_valid, error = rule_engine.validate_output(valid_output, schema)
    
    assert is_valid is True
    assert error is None
    
    # 测试无效的嵌套结构
    invalid_output = {
        "sections": [
            {"heading": "标题1"}  # 缺少content
        ]
    }
    
    is_valid, error = rule_engine.validate_output(invalid_output, schema)
    
    assert is_valid is False
    assert error is not None


# ============= 规则应用测试 =============


@pytest.mark.asyncio
async def test_apply_rule_success(rule_engine, mock_llm_service, sample_rule, sample_markdown):
    """测试成功应用规则"""
    # Mock LLM响应
    valid_json = {
        "title": "测试文档",
        "summary": "这是一个测试文档的摘要"
    }
    
    mock_llm_service.call_text_model.return_value = TextModelResponse(
        content=json.dumps(valid_json),
        model="gpt-4",
        usage={"prompt_tokens": 100, "completion_tokens": 50},
        finish_reason="stop"
    )
    
    # 应用规则
    result = await rule_engine.apply_rule(sample_markdown, sample_rule)
    
    # 验证结果
    assert result.success is True
    assert result.output == valid_json
    assert result.error is None
    assert result.llm_usage is not None
    
    # 验证LLM被正确调用
    mock_llm_service.call_text_model.assert_called_once()
    call_args = mock_llm_service.call_text_model.call_args
    assert call_args.kwargs["system_prompt"] == sample_rule.system_prompt
    assert call_args.kwargs["response_format"] == "json_object"


@pytest.mark.asyncio
async def test_apply_rule_with_invalid_json(rule_engine, mock_llm_service, sample_rule, sample_markdown):
    """测试LLM返回无效JSON的重试"""
    # 第一次返回无效JSON，第二次返回有效JSON
    valid_json = {"title": "测试", "summary": "摘要"}
    
    mock_llm_service.call_text_model.side_effect = [
        TextModelResponse(content="这不是JSON", model="gpt-4", usage={}, finish_reason="stop"),
        TextModelResponse(content=json.dumps(valid_json), model="gpt-4", usage={}, finish_reason="stop")
    ]
    
    result = await rule_engine.apply_rule(sample_markdown, sample_rule, max_retries=2)
    
    # 应该重试并最终成功
    assert result.success is True
    assert result.output == valid_json
    assert mock_llm_service.call_text_model.call_count == 2


@pytest.mark.asyncio
async def test_apply_rule_with_schema_validation_failure(rule_engine, mock_llm_service, sample_rule, sample_markdown):
    """测试JSON Schema验证失败的重试"""
    invalid_json = {"title": "测试"}  # 缺少summary
    valid_json = {"title": "测试", "summary": "摘要"}
    
    mock_llm_service.call_text_model.side_effect = [
        TextModelResponse(content=json.dumps(invalid_json), model="gpt-4", usage={}, finish_reason="stop"),
        TextModelResponse(content=json.dumps(valid_json), model="gpt-4", usage={}, finish_reason="stop")
    ]
    
    result = await rule_engine.apply_rule(sample_markdown, sample_rule, max_retries=2)
    
    # 应该重试并最终成功
    assert result.success is True
    assert result.output == valid_json
    assert mock_llm_service.call_text_model.call_count == 2


@pytest.mark.asyncio
async def test_apply_rule_max_retries_exhausted(rule_engine, mock_llm_service, sample_rule, sample_markdown):
    """测试重试次数用尽"""
    # 每次都返回无效JSON
    mock_llm_service.call_text_model.return_value = TextModelResponse(
        content="无效的JSON",
        model="gpt-4",
        usage={},
        finish_reason="stop"
    )
    
    result = await rule_engine.apply_rule(sample_markdown, sample_rule, max_retries=2)
    
    # 应该失败
    assert result.success is False
    assert result.output is None
    assert result.error is not None
    assert "Invalid JSON" in result.error or "json" in result.error.lower()
    
    # 应该尝试了3次（初始 + 2次重试）
    assert mock_llm_service.call_text_model.call_count == 3


@pytest.mark.asyncio
async def test_apply_rule_llm_error(rule_engine, mock_llm_service, sample_rule, sample_markdown):
    """测试LLM调用错误"""
    # Mock LLM抛出错误
    mock_llm_service.call_text_model.side_effect = LLMError("API调用失败")
    
    result = await rule_engine.apply_rule(sample_markdown, sample_rule)
    
    # 应该返回错误结果
    assert result.success is False
    assert result.output is None
    assert result.error is not None
    assert "LLM error" in result.error


@pytest.mark.asyncio
async def test_apply_rule_with_retry_feedback(rule_engine, mock_llm_service, sample_rule, sample_markdown):
    """测试重试时的错误反馈"""
    invalid_json = {"title": "测试"}  # 缺少summary
    valid_json = {"title": "测试", "summary": "摘要"}
    
    mock_llm_service.call_text_model.side_effect = [
        TextModelResponse(content=json.dumps(invalid_json), model="gpt-4", usage={}, finish_reason="stop"),
        TextModelResponse(content=json.dumps(valid_json), model="gpt-4", usage={}, finish_reason="stop")
    ]
    
    result = await rule_engine.apply_rule(sample_markdown, sample_rule, max_retries=2)
    
    assert result.success is True
    
    # 验证第二次调用包含错误反馈
    second_call = mock_llm_service.call_text_model.call_args_list[1]
    prompt = second_call.kwargs["prompt"]
    assert "failed" in prompt.lower() or "error" in prompt.lower()


# ============= 边界情况测试 =============


@pytest.mark.asyncio
async def test_apply_rule_with_empty_markdown(rule_engine, mock_llm_service, sample_rule):
    """测试空Markdown内容"""
    valid_json = {"title": "空文档", "summary": "无内容"}
    
    mock_llm_service.call_text_model.return_value = TextModelResponse(
        content=json.dumps(valid_json),
        model="gpt-4",
        usage={},
        finish_reason="stop"
    )
    
    result = await rule_engine.apply_rule("", sample_rule)
    
    assert result.success is True
    assert result.output == valid_json


@pytest.mark.asyncio
async def test_apply_rule_with_large_markdown(rule_engine, mock_llm_service, sample_rule):
    """测试大型Markdown内容"""
    large_markdown = "# 标题\n\n" + "段落内容。\n\n" * 1000
    valid_json = {"title": "大文档", "summary": "很长的内容"}
    
    mock_llm_service.call_text_model.return_value = TextModelResponse(
        content=json.dumps(valid_json),
        model="gpt-4",
        usage={},
        finish_reason="stop"
    )
    
    result = await rule_engine.apply_rule(large_markdown, sample_rule)
    
    assert result.success is True
    
    # 验证大内容被包含在prompt中
    call_args = mock_llm_service.call_text_model.call_args
    assert large_markdown in call_args.kwargs["prompt"]


@pytest.mark.asyncio
async def test_apply_rule_with_unicode_content(rule_engine, mock_llm_service, sample_rule):
    """测试包含Unicode字符的内容"""
    unicode_markdown = """# 测试文档 🚀

这是一个包含中文、emoji和其他Unicode字符的文档：
- 中文：你好世界
- 日文：こんにちは
- emoji：😀🎉✨
- 特殊符号：©®™
"""
    
    valid_json = {"title": "Unicode文档", "summary": "包含多种字符"}
    
    mock_llm_service.call_text_model.return_value = TextModelResponse(
        content=json.dumps(valid_json, ensure_ascii=False),
        model="gpt-4",
        usage={},
        finish_reason="stop"
    )
    
    result = await rule_engine.apply_rule(unicode_markdown, sample_rule)
    
    assert result.success is True
    assert result.output == valid_json


@pytest.mark.asyncio
async def test_apply_rule_with_no_retries(rule_engine, mock_llm_service, sample_rule, sample_markdown):
    """测试不允许重试（max_retries=0）"""
    invalid_json = {"title": "测试"}  # 缺少summary
    
    mock_llm_service.call_text_model.return_value = TextModelResponse(
        content=json.dumps(invalid_json),
        model="gpt-4",
        usage={},
        finish_reason="stop"
    )
    
    result = await rule_engine.apply_rule(sample_markdown, sample_rule, max_retries=0)
    
    # 应该立即失败，只调用一次
    assert result.success is False
    assert mock_llm_service.call_text_model.call_count == 1


# ============= 集成场景测试 =============


@pytest.mark.asyncio
async def test_apply_rule_complex_schema(rule_engine, mock_llm_service):
    """测试复杂schema的规则应用"""
    now = datetime.now(UTC)
    complex_rule = ETLRule(
        rule_id="complex-rule",
        name="复杂规则",
        description="提取复杂结构",
        json_schema={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "sections": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "heading": {"type": "string"},
                            "content": {"type": "string"},
                            "subsections": {
                                "type": "array",
                                "items": {"type": "string"}
                            }
                        },
                        "required": ["heading", "content"]
                    }
                }
            },
            "required": ["title", "sections"]
        },
        created_at=now,
        updated_at=now
    )
    
    valid_output = {
        "title": "复杂文档",
        "sections": [
            {
                "heading": "章节1",
                "content": "内容1",
                "subsections": ["子章节1.1", "子章节1.2"]
            },
            {
                "heading": "章节2",
                "content": "内容2",
                "subsections": []
            }
        ]
    }
    
    mock_llm_service.call_text_model.return_value = TextModelResponse(
        content=json.dumps(valid_output),
        model="gpt-4",
        usage={},
        finish_reason="stop"
    )
    
    result = await rule_engine.apply_rule("# 测试", complex_rule)
    
    assert result.success is True
    assert result.output == valid_output
    assert len(result.output["sections"]) == 2
    assert len(result.output["sections"][0]["subsections"]) == 2


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

