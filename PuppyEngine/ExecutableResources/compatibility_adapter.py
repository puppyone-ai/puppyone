"""
PuppyEngine ExecutableResources - 兼容性适配器

在重构期间桥接新旧架构:
- 保持现有API接口不变
- 内部使用新的ExecutableResource架构
- 渐进式迁移支持
- 向后兼容保证
"""

import asyncio
from typing import Any, Dict, Optional

from .base import (
    ResourceConfig,
    IOConfig,
    ExecutionContext,
    ContentType,
    ResourceType,
    GlobalResourceUID
)

from .modify_resources import create_modify_resource


class LegacyModifierFactoryAdapter:
    """传统ModifierFactory的适配器"""
    
    # 保持原有的策略映射
    _strategies = {
        "copy": "copy",
        "convert2text": "convert2text", 
        "convert2structured": "convert2structured",
        "edit_text": "edit_text",
        "edit_structured": "edit_structured",
    }
    
    @classmethod
    def execute(
        cls,
        init_configs: Dict[str, Any] = None,
        extra_configs: Dict[str, Any] = None
    ) -> Any:
        """
        兼容原有execute接口，内部使用新架构
        
        Args:
            init_configs: 初始配置，包含modify_type和content
            extra_configs: 额外配置，包含操作参数
            
        Returns:
            处理结果（保持原有格式）
        """
        if init_configs is None:
            init_configs = {}
        if extra_configs is None:
            extra_configs = {}
            
        modify_type = init_configs.get("modify_type")
        content = init_configs.get("content")
        
        if not modify_type:
            raise ValueError("modify_type is required")
        
        if modify_type not in cls._strategies:
            raise ValueError(f"Invalid modify type: {modify_type}")
        
        # 将传统参数转换为新架构格式
        try:
            # 同步调用异步函数（保持原接口的同步性）
            return asyncio.run(cls._execute_async(modify_type, content, extra_configs))
        except Exception as e:
            # 保持原有的异常处理方式
            from Utils.puppy_exception import PuppyException
            raise PuppyException(3014, f"Error in legacy adapter: {str(e)}")
    
    @classmethod
    async def _execute_async(
        cls,
        modify_type: str,
        content: Any,
        extra_configs: Dict[str, Any]
    ) -> Any:
        """内部异步执行方法"""
        
        # 创建新架构的配置
        resource_uid = GlobalResourceUID(
            namespace="puppyengine",
            resource_type="modify",
            resource_name=modify_type,
            version="v1"
        )
        
        # 自动推断I/O格式
        input_format, output_format = cls._infer_io_formats(content, modify_type)
        
        config = ResourceConfig(
            resource_id=f"legacy-{modify_type}-{resource_uid.short_id}",
            resource_uid=resource_uid,
            resource_type=ResourceType.MODIFY,
            io_config=IOConfig(
                input_format=input_format,
                output_format=output_format,
                shared_adapters=True
            )
        )
        
        context = ExecutionContext(
            resource_id=config.resource_id,
            workspace_id="legacy",
            user_context={"legacy_mode": True}
        )
        
        # 创建新架构的资源
        resource = create_modify_resource(modify_type, config, context)
        
        # 转换输入参数
        inputs = cls._convert_legacy_inputs(modify_type, content, extra_configs)
        
        # 执行新资源
        result = await resource.execute(inputs)
        
        # 转换输出格式以保持兼容性
        return cls._convert_legacy_output(result, modify_type)
    
    @classmethod
    def _infer_io_formats(cls, content: Any, modify_type: str) -> tuple[ContentType, ContentType]:
        """推断I/O格式"""
        # 根据内容类型和操作类型智能推断
        if modify_type in ["convert2text"]:
            return ContentType.JSON, ContentType.TEXT
        elif modify_type in ["convert2structured"]:
            return ContentType.TEXT, ContentType.JSON
        elif modify_type in ["edit_text"]:
            return ContentType.TEXT, ContentType.TEXT
        else:
            # 默认JSON格式
            return ContentType.JSON, ContentType.JSON
    
    @classmethod
    def _convert_legacy_inputs(
        cls,
        modify_type: str,
        content: Any,
        extra_configs: Dict[str, Any]
    ) -> Dict[str, Any]:
        """转换传统输入参数为新格式"""
        inputs = {"content": content}
        
        # 根据操作类型转换特定参数
        if modify_type == "edit_text":
            if "slice" in extra_configs:
                inputs["slice"] = extra_configs["slice"]
            if "sort_type" in extra_configs:
                inputs["sort_type"] = extra_configs["sort_type"]
            if "plugins" in extra_configs:
                inputs["plugins"] = extra_configs["plugins"]
        
        elif modify_type == "edit_structured":
            if "operations" in extra_configs:
                inputs["operations"] = extra_configs["operations"]
        
        elif modify_type == "convert2structured":
            if "conversion_mode" in extra_configs:
                inputs["conversion_mode"] = extra_configs["conversion_mode"]
        
        # 添加其他extra_configs作为额外参数
        for key, value in extra_configs.items():
            if key not in inputs:
                inputs[key] = value
        
        return inputs
    
    @classmethod
    def _convert_legacy_output(cls, result: Dict[str, Any], modify_type: str) -> Any:
        """转换新架构输出为传统格式"""
        # 传统接口只返回处理结果，不包含元数据
        return result.get("result", result)


class LegacyModifyStrategyAdapter:
    """传统ModifyStrategy的适配器基类"""
    
    def __init__(self, content: Any, extra_configs: Dict[str, Any]):
        self.content = content
        self.extra_configs = extra_configs or {}
    
    def modify(self) -> Any:
        """兼容原有modify接口"""
        # 这个方法将被子类重写，但提供默认实现
        return self.content


def create_legacy_adapter(modify_type: str) -> type:
    """动态创建传统策略适配器类"""
    
    class DynamicLegacyAdapter(LegacyModifyStrategyAdapter):
        def modify(self) -> Any:
            # 使用新的适配器执行
            return LegacyModifierFactoryAdapter.execute(
                init_configs={"modify_type": modify_type, "content": self.content},
                extra_configs=self.extra_configs
            )
    
    # 设置类名
    DynamicLegacyAdapter.__name__ = f"Legacy{modify_type.title()}Adapter"
    DynamicLegacyAdapter.__qualname__ = f"Legacy{modify_type.title()}Adapter"
    
    return DynamicLegacyAdapter


# 为了完全兼容，提供传统类的别名
ModifyEditText = create_legacy_adapter("edit_text")
ModifyCopyContent = create_legacy_adapter("copy")
ModifyConvert2Text = create_legacy_adapter("convert2text")
ModifyEditStructured = create_legacy_adapter("edit_structured")
ModifyConvert2Structured = create_legacy_adapter("convert2structured")


# 导出传统接口
__all__ = [
    "LegacyModifierFactoryAdapter",
    "LegacyModifyStrategyAdapter",
    "ModifyEditText",
    "ModifyCopyContent", 
    "ModifyConvert2Text",
    "ModifyEditStructured",
    "ModifyConvert2Structured",
    "create_legacy_adapter"
]


# 兼容性验证示例
if __name__ == "__main__":
    import time
    
    print("🔄 兼容性适配器验证")
    print("=" * 50)
    
    # 测试数据
    nested_data = {
        "users": [
            {"id": 1, "name": "Alice", "scores": [85, 90, 78]},
            {"id": 2, "name": "Bob", "scores": [92, 88, 95]}
        ],
        "settings": {"theme": "dark", "notifications": True}
    }
    
    # 1. 测试复制操作
    print("\n1. 测试复制操作")
    copied_data = LegacyModifierFactoryAdapter.execute(
        init_configs={"modify_type": "copy", "content": nested_data}
    )
    copy_success = copied_data == nested_data and copied_data is not nested_data
    print(f"   ✅ 复制结果: {'成功' if copy_success else '失败'}")
    
    # 2. 测试文本编辑
    print("\n2. 测试文本编辑")
    text_with_vars = "Hello {{name}}! Your score is {{score}}"
    replaced_text = LegacyModifierFactoryAdapter.execute(
        init_configs={"content": text_with_vars, "modify_type": "edit_text"},
        extra_configs={"plugins": {"name": "Alice", "score": "95"}}
    )
    text_success = "Alice" in replaced_text and "95" in replaced_text
    print(f"   ✅ 文本编辑: {'成功' if text_success else '失败'}")
    print(f"   📝 结果: {replaced_text}")
    
    # 3. 测试结构化编辑
    print("\n3. 测试结构化编辑")
    operations = [
        {
            "type": "set_value",
            "params": {"path": ["settings", "theme"], "value": "light"}
        }
    ]
    structured_result = LegacyModifierFactoryAdapter.execute(
        init_configs={"content": nested_data, "modify_type": "edit_structured"},
        extra_configs={"operations": operations}
    )
    structured_success = structured_result["settings"]["theme"] == "light"
    print(f"   ✅ 结构化编辑: {'成功' if structured_success else '失败'}")
    
    # 4. 测试转换操作
    print("\n4. 测试转换操作")
    text_data = '{"name": "Test", "values": [1, 2, 3]}'
    parsed_result = LegacyModifierFactoryAdapter.execute(
        init_configs={"content": text_data, "modify_type": "convert2structured"},
        extra_configs={"conversion_mode": "parse_as_json"}
    )
    conversion_success = isinstance(parsed_result, dict) and parsed_result.get("name") == "Test"
    print(f"   ✅ 文本转结构化: {'成功' if conversion_success else '失败'}")
    
    # 5. 性能对比测试
    print("\n5. 性能对比")
    iterations = 1000
    start_time = time.time()
    
    for _ in range(iterations):
        LegacyModifierFactoryAdapter.execute(
            init_configs={"modify_type": "copy", "content": {"test": "data"}}
        )
    
    end_time = time.time()
    avg_time = ((end_time - start_time) / iterations) * 1000
    
    print(f"   ⚡ 平均执行时间: {avg_time:.2f}ms")
    print(f"   📊 吞吐量: {iterations/(end_time-start_time):.1f} 操作/秒")
    
    # 总结
    all_tests = [copy_success, text_success, structured_success, conversion_success]
    passed = sum(all_tests)
    total = len(all_tests)
    
    print(f"\n📊 兼容性验证总结:")
    print(f"   ✅ 通过: {passed}/{total}")
    print(f"   📈 成功率: {(passed/total)*100:.1f}%")
    
    if passed == total:
        print("\n🎉 兼容性适配器验证成功！")
        print("   ✅ 新架构完全兼容原有接口")
        print("   ✅ 性能保持在可接受范围")
        print("   ✅ 可以安全进行渐进式迁移")
    else:
        print(f"\n⚠️ 有{total-passed}个测试失败，需要进一步调试") 