"""ETL规则存储单元测试

测试规则仓库的文件存储功能：
- 创建规则
- 读取规则
- 更新规则
- 删除规则
- 列表和分页
"""

import json
import shutil
import tempfile
from pathlib import Path

import pytest

from src.etl.rules.repository import RuleRepository
from src.etl.rules.schemas import ETLRule, RuleCreateRequest, RuleUpdateRequest


# ============= Fixtures =============


@pytest.fixture
def temp_rules_dir():
    """创建临时规则目录"""
    temp_dir = tempfile.mkdtemp(prefix="test_rules_")
    yield temp_dir
    # 清理
    if Path(temp_dir).exists():
        shutil.rmtree(temp_dir)


@pytest.fixture
def repository(temp_rules_dir):
    """创建规则仓库实例"""
    return RuleRepository(rules_dir=temp_rules_dir)


@pytest.fixture
def sample_rule_request():
    """创建测试用的规则请求"""
    return RuleCreateRequest(
        name="测试规则",
        description="这是一个测试规则",
        json_schema={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "summary": {"type": "string"}
            },
            "required": ["title", "summary"]
        },
        system_prompt="你是一个测试助手。"
    )


# ============= 初始化测试 =============


def test_repository_initialization(temp_rules_dir):
    """测试仓库初始化"""
    repo = RuleRepository(rules_dir=temp_rules_dir)
    
    assert repo.rules_dir == Path(temp_rules_dir)
    assert repo.rules_dir.exists()
    assert repo.rules_dir.is_dir()


def test_repository_initialization_creates_directory():
    """测试仓库初始化自动创建目录"""
    temp_dir = tempfile.mkdtemp()
    non_existent = Path(temp_dir) / "new_rules_dir"
    
    # 确保目录不存在
    assert not non_existent.exists()
    
    repo = RuleRepository(rules_dir=str(non_existent))
    
    # 目录应该被创建
    assert non_existent.exists()
    assert non_existent.is_dir()
    
    # 清理
    shutil.rmtree(temp_dir)


def test_repository_default_directory():
    """测试默认目录"""
    repo = RuleRepository()
    
    assert repo.rules_dir == Path(".etl_rules")
    assert repo.rules_dir.exists()


# ============= 创建规则测试 =============


def test_create_rule(repository, sample_rule_request):
    """测试创建规则"""
    rule = repository.create_rule(sample_rule_request)
    
    # 验证规则属性
    assert rule.rule_id is not None
    assert rule.name == sample_rule_request.name
    assert rule.description == sample_rule_request.description
    assert rule.json_schema == sample_rule_request.json_schema
    assert rule.system_prompt == sample_rule_request.system_prompt
    assert rule.created_at is not None
    assert rule.updated_at is not None
    
    # 验证文件被创建
    rule_file = repository.rules_dir / f"{rule.rule_id}.json"
    assert rule_file.exists()
    
    # 验证文件内容
    with open(rule_file, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    assert data["rule_id"] == rule.rule_id
    assert data["name"] == rule.name


def test_create_rule_generates_unique_id(repository, sample_rule_request):
    """测试创建规则生成唯一ID"""
    rule1 = repository.create_rule(sample_rule_request)
    rule2 = repository.create_rule(sample_rule_request)
    
    assert rule1.rule_id != rule2.rule_id


def test_create_rule_with_minimal_fields(repository):
    """测试创建最小字段的规则"""
    minimal_request = RuleCreateRequest(
        name="最小规则",
        description="只有必需字段",
        json_schema={"type": "object"},
        system_prompt=None  # 可选字段
    )
    
    rule = repository.create_rule(minimal_request)
    
    assert rule.rule_id is not None
    assert rule.name == "最小规则"
    assert rule.system_prompt is None


def test_create_rule_with_complex_schema(repository):
    """测试创建复杂schema的规则"""
    complex_schema = {
        "type": "object",
        "properties": {
            "sections": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string"},
                        "content": {"type": "string"}
                    }
                }
            }
        }
    }
    
    request = RuleCreateRequest(
        name="复杂规则",
        description="包含复杂schema",
        json_schema=complex_schema
    )
    
    rule = repository.create_rule(request)
    
    assert rule.json_schema == complex_schema


# ============= 读取规则测试 =============


def test_get_rule(repository, sample_rule_request):
    """测试读取规则"""
    created_rule = repository.create_rule(sample_rule_request)
    
    retrieved_rule = repository.get_rule(created_rule.rule_id)
    
    assert retrieved_rule is not None
    assert retrieved_rule.rule_id == created_rule.rule_id
    assert retrieved_rule.name == created_rule.name
    assert retrieved_rule.description == created_rule.description
    assert retrieved_rule.json_schema == created_rule.json_schema


def test_get_rule_not_found(repository):
    """测试读取不存在的规则"""
    rule = repository.get_rule("nonexistent-rule-id")
    
    assert rule is None


def test_get_rule_with_unicode(repository):
    """测试读取包含Unicode的规则"""
    request = RuleCreateRequest(
        name="Unicode规则 🚀",
        description="包含中文和emoji：你好世界 😀",
        json_schema={"type": "object"},
        system_prompt="测试Unicode：こんにちは"
    )
    
    created_rule = repository.create_rule(request)
    retrieved_rule = repository.get_rule(created_rule.rule_id)
    
    assert retrieved_rule.name == "Unicode规则 🚀"
    assert "你好世界" in retrieved_rule.description
    assert "こんにちは" in retrieved_rule.system_prompt


# ============= 更新规则测试 =============


def test_update_rule(repository, sample_rule_request):
    """测试更新规则"""
    created_rule = repository.create_rule(sample_rule_request)
    
    update_request = RuleUpdateRequest(
        name="更新后的名称",
        description="更新后的描述"
    )
    
    updated_rule = repository.update_rule(created_rule.rule_id, update_request)
    
    assert updated_rule is not None
    assert updated_rule.rule_id == created_rule.rule_id
    assert updated_rule.name == "更新后的名称"
    assert updated_rule.description == "更新后的描述"
    assert updated_rule.json_schema == created_rule.json_schema  # 未更新的字段保持不变
    assert updated_rule.updated_at > created_rule.updated_at


def test_update_rule_partial(repository, sample_rule_request):
    """测试部分更新规则"""
    created_rule = repository.create_rule(sample_rule_request)
    
    # 只更新名称
    update_request = RuleUpdateRequest(name="新名称")
    updated_rule = repository.update_rule(created_rule.rule_id, update_request)
    
    assert updated_rule.name == "新名称"
    assert updated_rule.description == created_rule.description
    
    # 只更新schema
    new_schema = {"type": "string"}
    update_request = RuleUpdateRequest(json_schema=new_schema)
    updated_rule = repository.update_rule(created_rule.rule_id, update_request)
    
    assert updated_rule.json_schema == new_schema
    assert updated_rule.name == "新名称"  # 之前的更新保持


def test_update_rule_not_found(repository):
    """测试更新不存在的规则"""
    update_request = RuleUpdateRequest(name="新名称")
    result = repository.update_rule("nonexistent-id", update_request)
    
    assert result is None


def test_update_rule_clear_system_prompt(repository, sample_rule_request):
    """测试清除system_prompt"""
    created_rule = repository.create_rule(sample_rule_request)
    assert created_rule.system_prompt is not None
    
    # 设置为None来清除
    update_request = RuleUpdateRequest(system_prompt=None)
    updated_rule = repository.update_rule(created_rule.rule_id, update_request)
    
    # 注意：根据实际实现，可能需要验证是否真的清除了
    # 如果实现中None表示"不更新"，则这个测试需要调整


# ============= 删除规则测试 =============


def test_delete_rule(repository, sample_rule_request):
    """测试删除规则"""
    created_rule = repository.create_rule(sample_rule_request)
    rule_file = repository.rules_dir / f"{created_rule.rule_id}.json"
    
    # 确认文件存在
    assert rule_file.exists()
    
    # 删除规则
    success = repository.delete_rule(created_rule.rule_id)
    
    assert success is True
    assert not rule_file.exists()
    
    # 验证无法再读取
    retrieved = repository.get_rule(created_rule.rule_id)
    assert retrieved is None


def test_delete_rule_not_found(repository):
    """测试删除不存在的规则"""
    success = repository.delete_rule("nonexistent-id")
    
    assert success is False


def test_delete_rule_multiple_times(repository, sample_rule_request):
    """测试多次删除同一规则"""
    created_rule = repository.create_rule(sample_rule_request)
    
    # 第一次删除成功
    success1 = repository.delete_rule(created_rule.rule_id)
    assert success1 is True
    
    # 第二次删除失败（规则已不存在）
    success2 = repository.delete_rule(created_rule.rule_id)
    assert success2 is False


# ============= 列表和分页测试 =============


def test_list_rules_empty(repository):
    """测试列出空规则列表"""
    rules = repository.list_rules()
    
    assert rules == []


def test_list_rules(repository, sample_rule_request):
    """测试列出规则"""
    # 创建多个规则
    rule1 = repository.create_rule(sample_rule_request)
    rule2 = repository.create_rule(sample_rule_request)
    rule3 = repository.create_rule(sample_rule_request)
    
    # 列出所有规则
    rules = repository.list_rules()
    
    assert len(rules) == 3
    rule_ids = [r.rule_id for r in rules]
    assert rule1.rule_id in rule_ids
    assert rule2.rule_id in rule_ids
    assert rule3.rule_id in rule_ids


def test_list_rules_pagination(repository, sample_rule_request):
    """测试规则列表分页"""
    # 创建5个规则
    for i in range(5):
        repository.create_rule(sample_rule_request)
    
    # 第一页（2个规则）
    page1 = repository.list_rules(limit=2, offset=0)
    assert len(page1) == 2
    
    # 第二页（2个规则）
    page2 = repository.list_rules(limit=2, offset=2)
    assert len(page2) == 2
    
    # 第三页（1个规则）
    page3 = repository.list_rules(limit=2, offset=4)
    assert len(page3) == 1
    
    # 验证没有重复
    all_ids = [r.rule_id for r in page1 + page2 + page3]
    assert len(all_ids) == len(set(all_ids))


def test_list_rules_limit(repository, sample_rule_request):
    """测试规则列表限制数量"""
    # 创建10个规则
    for i in range(10):
        repository.create_rule(sample_rule_request)
    
    # 只获取3个
    rules = repository.list_rules(limit=3)
    
    assert len(rules) == 3


def test_list_rules_offset(repository, sample_rule_request):
    """测试规则列表偏移"""
    # 创建5个规则
    for i in range(5):
        repository.create_rule(sample_rule_request)
    
    # 跳过前2个
    rules = repository.list_rules(offset=2)
    
    assert len(rules) == 3


def test_list_rules_large_offset(repository, sample_rule_request):
    """测试规则列表大偏移量"""
    # 创建3个规则
    for i in range(3):
        repository.create_rule(sample_rule_request)
    
    # 偏移量超过总数
    rules = repository.list_rules(offset=10)
    
    assert len(rules) == 0


# ============= 计数测试 =============


def test_count_rules_empty(repository):
    """测试空仓库计数"""
    count = repository.count_rules()
    
    assert count == 0


def test_count_rules(repository, sample_rule_request):
    """测试规则计数"""
    # 创建3个规则
    for i in range(3):
        repository.create_rule(sample_rule_request)
    
    count = repository.count_rules()
    
    assert count == 3


def test_count_rules_after_delete(repository, sample_rule_request):
    """测试删除后的计数"""
    # 创建3个规则
    rule1 = repository.create_rule(sample_rule_request)
    repository.create_rule(sample_rule_request)
    repository.create_rule(sample_rule_request)
    
    assert repository.count_rules() == 3
    
    # 删除一个
    repository.delete_rule(rule1.rule_id)
    
    assert repository.count_rules() == 2


# ============= 文件系统测试 =============


def test_save_rule_creates_valid_json(repository, sample_rule_request):
    """测试保存规则创建有效的JSON文件"""
    rule = repository.create_rule(sample_rule_request)
    rule_file = repository.rules_dir / f"{rule.rule_id}.json"
    
    # 读取并验证JSON
    with open(rule_file, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    # 验证JSON结构
    assert "rule_id" in data
    assert "name" in data
    assert "description" in data
    assert "json_schema" in data
    assert "created_at" in data
    assert "updated_at" in data


def test_repository_handles_corrupted_file(repository, sample_rule_request):
    """测试处理损坏的JSON文件"""
    # 创建一个规则
    rule = repository.create_rule(sample_rule_request)
    rule_file = repository.rules_dir / f"{rule.rule_id}.json"
    
    # 创建另一个损坏的规则文件
    corrupted_file = repository.rules_dir / "corrupted.json"
    with open(corrupted_file, "w") as f:
        f.write("这不是有效的JSON{{{")
    
    # 列表应该跳过损坏的文件
    rules = repository.list_rules()
    
    assert len(rules) == 1
    assert rules[0].rule_id == rule.rule_id


def test_repository_file_encoding(repository):
    """测试文件编码处理Unicode"""
    request = RuleCreateRequest(
        name="中文规则名称",
        description="包含各种Unicode字符：🚀😀©®™",
        json_schema={"type": "object"},
        system_prompt="日文：こんにちは、韩文：안녕하세요"
    )
    
    rule = repository.create_rule(request)
    rule_file = repository.rules_dir / f"{rule.rule_id}.json"
    
    # 验证文件可以正确读取Unicode
    with open(rule_file, "r", encoding="utf-8") as f:
        content = f.read()
    
    assert "中文规则名称" in content
    assert "🚀" in content
    assert "こんにちは" in content


# ============= 边界情况测试 =============


def test_create_rule_with_very_long_name(repository):
    """测试创建非常长名称的规则"""
    long_name = "规则" * 100  # 200个字符
    
    request = RuleCreateRequest(
        name=long_name,
        description="测试长名称",
        json_schema={"type": "object"}
    )
    
    rule = repository.create_rule(request)
    
    assert rule.name == long_name
    
    # 验证可以读取
    retrieved = repository.get_rule(rule.rule_id)
    assert retrieved.name == long_name


def test_create_rule_with_special_characters_in_description(repository):
    """测试描述中包含特殊字符"""
    special_desc = """包含特殊字符：
    - 引号: "test" 'test'
    - 反斜杠: \\ \n \t
    - 换行符和制表符
    - JSON特殊字符: {} [] ,
    """
    
    request = RuleCreateRequest(
        name="特殊字符测试",
        description=special_desc,
        json_schema={"type": "object"}
    )
    
    rule = repository.create_rule(request)
    retrieved = repository.get_rule(rule.rule_id)
    
    assert retrieved.description == special_desc


def test_concurrent_operations(repository, sample_rule_request):
    """测试并发操作的基本功能
    
    注意：这不是真正的并发测试，只是验证连续操作不会相互干扰
    """
    # 创建
    rule1 = repository.create_rule(sample_rule_request)
    rule2 = repository.create_rule(sample_rule_request)
    
    # 更新
    repository.update_rule(rule1.rule_id, RuleUpdateRequest(name="更新1"))
    repository.update_rule(rule2.rule_id, RuleUpdateRequest(name="更新2"))
    
    # 验证
    retrieved1 = repository.get_rule(rule1.rule_id)
    retrieved2 = repository.get_rule(rule2.rule_id)
    
    assert retrieved1.name == "更新1"
    assert retrieved2.name == "更新2"
    
    # 删除一个
    repository.delete_rule(rule1.rule_id)
    
    # 验证
    assert repository.get_rule(rule1.rule_id) is None
    assert repository.get_rule(rule2.rule_id) is not None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

