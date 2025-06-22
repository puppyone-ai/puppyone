#!/usr/bin/env python3
"""
PuppyEngine ExecutableResources - 重构后的ModifyEdge测试

验证重构后的资源系统:
- 平级设计（无subtype层级）
- 统一UID标识
- 内化I/O处理
- 协议导向架构
"""

import asyncio
import json
import time
from typing import Dict, Any

from base import (
    ResourceConfig,
    IOConfig,
    ExecutionContext,
    ContentType,
    ResourceType,
    GlobalResourceUID
)

from modify_resources import (
    ModifyCopyResource,
    ModifyConvert2TextResource,
    ModifyConvert2StructuredResource,
    ModifyEditTextResource,
    ModifyEditStructuredResource,
    create_modify_resource
)


class RefactoredModifyTester:
    """重构后的Modify资源测试器"""
    
    def __init__(self):
        self.test_results = []
    
    async def run_all_tests(self):
        """运行所有测试"""
        print("🚀 开始测试重构后的ModifyEdge资源系统")
        print("=" * 60)
        
        # 测试每个资源类型
        await self._test_copy_resource()
        await self._test_convert2text_resource()
        await self._test_convert2structured_resource()
        await self._test_edit_text_resource()
        await self._test_edit_structured_resource()
        
        # 测试工厂函数
        await self._test_factory_function()
        
        # 测试I/O内化
        await self._test_io_internalization()
        
        # 测试UID系统
        await self._test_uid_system()
        
        # 性能对比测试
        await self._test_performance_comparison()
        
        # 显示测试总结
        self._show_test_summary()
    
    async def _test_copy_resource(self):
        """测试复制资源"""
        print("\n📋 测试 ModifyCopyResource")
        print("-" * 40)
        
        # 创建配置
        config = ResourceConfig(
            resource_id="test-copy-001",
            resource_uid=GlobalResourceUID(
                namespace="puppyengine",
                resource_type="modify",
                resource_name="copy",
                version="v1"
            ),
            resource_type=ResourceType.MODIFY,
            io_config=IOConfig(
                input_format=ContentType.JSON,
                output_format=ContentType.JSON,
                output_metadata=["timestamp", "resource_uid"]
            )
        )
        
        context = ExecutionContext(resource_id="test-copy-001")
        
        # 创建资源
        copy_resource = ModifyCopyResource(config, context)
        
        # 测试数据
        test_data = {
            "users": [{"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}],
            "settings": {"theme": "dark", "notifications": True}
        }
        
        # 执行复制
        result = await copy_resource.execute({"content": test_data})
        
        # 验证结果
        success = (
            result["result"] == test_data and 
            result["result"] is not test_data and  # 确保是深拷贝
            result["operation"] == "copy" and
            "_metadata" in result
        )
        
        print(f"✅ 复制操作: {'成功' if success else '失败'}")
        print(f"📊 资源UID: {result.get('resource_uid', 'N/A')}")
        print(f"🕒 包含元数据: {'是' if '_metadata' in result else '否'}")
        
        self.test_results.append(("Copy Resource", success))
    
    async def _test_convert2text_resource(self):
        """测试转文本资源"""
        print("\n📄 测试 ModifyConvert2TextResource")
        print("-" * 40)
        
        config = ResourceConfig(
            resource_id="test-convert2text-001",
            resource_uid=GlobalResourceUID(
                namespace="puppyengine",
                resource_type="modify", 
                resource_name="convert2text",
                version="v1"
            ),
            resource_type=ResourceType.MODIFY,
            io_config=IOConfig(
                input_format=ContentType.JSON,
                output_format=ContentType.JSON,
                input_validation=["content_serializable"]
            )
        )
        
        context = ExecutionContext(resource_id="test-convert2text-001")
        convert_resource = ModifyConvert2TextResource(config, context)
        
        # 测试结构化数据转文本
        test_data = {"name": "Test", "values": [1, 2, 3]}
        result = await convert_resource.execute({"content": test_data})
        
        success = (
            isinstance(result["result"], str) and
            "Test" in result["result"] and
            result["operation"] == "convert2text"
        )
        
        print(f"✅ 转文本操作: {'成功' if success else '失败'}")
        print(f"📊 原始类型: {result.get('original_type', 'N/A')}")
        print(f"📝 文本结果: {result['result'][:50]}...")
        
        self.test_results.append(("Convert2Text Resource", success))
    
    async def _test_convert2structured_resource(self):
        """测试转结构化资源"""
        print("\n🔧 测试 ModifyConvert2StructuredResource")
        print("-" * 40)
        
        config = ResourceConfig(
            resource_id="test-convert2structured-001",
            resource_uid=GlobalResourceUID(
                namespace="puppyengine",
                resource_type="modify",
                resource_name="convert2structured", 
                version="v1"
            ),
            resource_type=ResourceType.MODIFY,
            io_config=IOConfig(
                input_format=ContentType.TEXT,
                output_format=ContentType.JSON,
                input_validation=["valid_json_format"]
            )
        )
        
        context = ExecutionContext(resource_id="test-convert2structured-001")
        convert_resource = ModifyConvert2StructuredResource(config, context)
        
        # 测试JSON文本转结构化
        json_text = '{"name": "Test", "values": [1, 2, 3]}'
        result = await convert_resource.execute({
            "content": json_text,
            "conversion_mode": "parse_as_json"
        })
        
        success = (
            isinstance(result["result"], dict) and
            result["result"]["name"] == "Test" and
            result["operation"] == "convert2structured"
        )
        
        print(f"✅ 转结构化操作: {'成功' if success else '失败'}")
        print(f"📊 转换模式: {result.get('conversion_mode', 'N/A')}")
        print(f"🔧 结构化结果: {result['result']}")
        
        self.test_results.append(("Convert2Structured Resource", success))
    
    async def _test_edit_text_resource(self):
        """测试文本编辑资源"""
        print("\n✏️ 测试 ModifyEditTextResource")
        print("-" * 40)
        
        config = ResourceConfig(
            resource_id="test-edit-text-001",
            resource_uid=GlobalResourceUID(
                namespace="puppyengine",
                resource_type="modify",
                resource_name="edit_text",
                version="v1"
            ),
            resource_type=ResourceType.MODIFY,
            io_config=IOConfig(
                input_format=ContentType.TEXT,
                output_format=ContentType.JSON,
                input_validation=["valid_slice_range", "valid_sort_type"]
            )
        )
        
        context = ExecutionContext(resource_id="test-edit-text-001")
        edit_resource = ModifyEditTextResource(config, context)
        
        # 测试变量替换
        template_text = "Hello {{name}}! Your score is {{score}}"
        result = await edit_resource.execute({
            "content": template_text,
            "plugins": {"name": "Alice", "score": "95"}
        })
        
        success = (
            "Alice" in result["result"] and
            "95" in result["result"] and
            result["operation"] == "edit_text"
        )
        
        print(f"✅ 文本编辑操作: {'成功' if success else '失败'}")
        print(f"📝 编辑结果: {result['result']}")
        print(f"⚙️ 应用的操作: {result['applied_operations']}")
        
        self.test_results.append(("EditText Resource", success))
    
    async def _test_edit_structured_resource(self):
        """测试结构化编辑资源"""
        print("\n🔧 测试 ModifyEditStructuredResource")
        print("-" * 40)
        
        config = ResourceConfig(
            resource_id="test-edit-structured-001",
            resource_uid=GlobalResourceUID(
                namespace="puppyengine",
                resource_type="modify",
                resource_name="edit_structured",
                version="v1"
            ),
            resource_type=ResourceType.MODIFY,
            io_config=IOConfig(
                input_format=ContentType.JSON,
                output_format=ContentType.JSON,
                input_validation=["valid_operations"]
            )
        )
        
        context = ExecutionContext(resource_id="test-edit-structured-001")
        edit_resource = ModifyEditStructuredResource(config, context)
        
        # 测试复杂操作链
        test_data = {
            "users": [{"id": 1, "name": "Alice", "scores": [85, 90, 78]}],
            "settings": {"theme": "{{theme_name}}"}
        }
        
        operations = [
            {
                "type": "set_value",
                "params": {"path": ["settings", "theme"], "value": "light"}
            },
            {
                "type": "append", 
                "params": {"path": ["users", 0, "scores"], "value": 100}
            },
            {
                "type": "sort",
                "params": {"path": ["users", 0, "scores"], "reverse": True}
            }
        ]
        
        result = await edit_resource.execute({
            "content": test_data,
            "operations": operations
        })
        
        success = (
            result["result"]["settings"]["theme"] == "light" and
            100 in result["result"]["users"][0]["scores"] and
            result["result"]["users"][0]["scores"][0] == 100 and  # 排序后100应该在最前
            result["operation"] == "edit_structured"
        )
        
        print(f"✅ 结构化编辑操作: {'成功' if success else '失败'}")
        print(f"🔧 应用的操作数: {len(result['applied_operations'])}")
        print(f"📊 成功操作数: {len([op for op in result['applied_operations'] if op['success']])}")
        
        self.test_results.append(("EditStructured Resource", success))
    
    async def _test_factory_function(self):
        """测试工厂函数"""
        print("\n🏭 测试资源工厂函数")
        print("-" * 40)
        
        config = ResourceConfig(
            resource_id="test-factory-001",
            resource_uid=GlobalResourceUID(),
            resource_type=ResourceType.MODIFY,
            io_config=IOConfig()
        )
        
        context = ExecutionContext(resource_id="test-factory-001")
        
        # 测试每种资源类型的创建
        resource_types = ["copy", "convert2text", "convert2structured", "edit_text", "edit_structured"]
        created_resources = []
        
        for modify_type in resource_types:
            try:
                resource = create_modify_resource(modify_type, config, context)
                created_resources.append((modify_type, resource is not None))
                print(f"  ✅ {modify_type}: 创建成功")
            except Exception as e:
                created_resources.append((modify_type, False))
                print(f"  ❌ {modify_type}: 创建失败 - {e}")
        
        success = all(result[1] for result in created_resources)
        print(f"🏭 工厂函数测试: {'成功' if success else '失败'}")
        
        self.test_results.append(("Factory Function", success))
    
    async def _test_io_internalization(self):
        """测试I/O内化"""
        print("\n🔄 测试I/O处理内化")
        print("-" * 40)
        
        # 创建一个带有多种I/O处理的资源
        config = ResourceConfig(
            resource_id="test-io-001",
            resource_uid=GlobalResourceUID(),
            resource_type=ResourceType.MODIFY,
            io_config=IOConfig(
                input_format=ContentType.JSON,
                output_format=ContentType.JSON,
                input_validation=["content_exists"],
                input_preprocessing=["normalize"],
                output_postprocessing=["format"],
                output_metadata=["timestamp", "resource_uid"],
                shared_adapters=True
            )
        )
        
        context = ExecutionContext(resource_id="test-io-001")
        copy_resource = ModifyCopyResource(config, context)
        
        # 测试I/O处理是否被正确内化
        test_data = {"test": "data"}
        result = await copy_resource.execute({"content": test_data})
        
        success = (
            "_metadata" in result and
            "timestamp" in result["_metadata"] and
            "resource_uid" in result["_metadata"] and
            copy_resource.input_adapter is not None and
            copy_resource.output_adapter is not None
        )
        
        print(f"✅ I/O内化测试: {'成功' if success else '失败'}")
        print(f"🔄 输入适配器: {type(copy_resource.input_adapter).__name__}")
        print(f"🔄 输出适配器: {type(copy_resource.output_adapter).__name__}")
        print(f"📊 共享适配器: {'是' if config.io_config.shared_adapters else '否'}")
        
        self.test_results.append(("I/O Internalization", success))
    
    async def _test_uid_system(self):
        """测试UID系统"""
        print("\n🆔 测试全球唯一ID系统")
        print("-" * 40)
        
        # 创建多个资源，验证UID唯一性
        resource_configs = []
        for i in range(5):
            uid = GlobalResourceUID(
                namespace="puppyengine",
                resource_type="modify",
                resource_name=f"test_{i}",
                version="v1"
            )
            
            config = ResourceConfig(
                resource_id=f"test-uid-{i:03d}",
                resource_uid=uid,
                resource_type=ResourceType.MODIFY,
                io_config=IOConfig()
            )
            
            resource_configs.append((config, uid))
            print(f"  🆔 资源 {i}: {uid.short_id} | URL: {uid.to_url()}")
        
        # 验证UID唯一性
        uids = [uid.uid for _, uid in resource_configs]
        short_ids = [uid.short_id for _, uid in resource_configs]
        
        unique_uids = len(set(uids)) == len(uids)
        unique_short_ids = len(set(short_ids)) == len(short_ids)
        
        success = unique_uids and unique_short_ids
        print(f"🆔 UID唯一性测试: {'成功' if success else '失败'}")
        print(f"📊 完整UID唯一: {'是' if unique_uids else '否'}")
        print(f"📊 短ID唯一: {'是' if unique_short_ids else '否'}")
        
        self.test_results.append(("UID System", success))
    
    async def _test_performance_comparison(self):
        """性能对比测试"""
        print("\n⚡ 性能对比测试")
        print("-" * 40)
        
        # 创建测试资源
        config = ResourceConfig(
            resource_id="test-perf-001",
            resource_uid=GlobalResourceUID(),
            resource_type=ResourceType.MODIFY,
            io_config=IOConfig(
                input_format=ContentType.JSON,
                output_format=ContentType.JSON,
                shared_adapters=True
            )
        )
        
        context = ExecutionContext(resource_id="test-perf-001")
        copy_resource = ModifyCopyResource(config, context)
        
        # 准备测试数据
        test_data = {
            "large_list": list(range(1000)),
            "nested_dict": {f"key_{i}": f"value_{i}" for i in range(100)}
        }
        
        # 执行性能测试
        iterations = 100
        start_time = time.time()
        
        for _ in range(iterations):
            result = await copy_resource.execute({"content": test_data})
        
        end_time = time.time()
        total_time = end_time - start_time
        avg_time = (total_time / iterations) * 1000  # 转换为毫秒
        
        success = avg_time < 10  # 平均每次操作应该小于10ms
        
        print(f"⚡ 性能测试: {'成功' if success else '失败'}")
        print(f"📊 总时间: {total_time:.3f}秒")
        print(f"📊 平均时间: {avg_time:.2f}ms/操作")
        print(f"📊 吞吐量: {iterations/total_time:.1f} 操作/秒")
        
        self.test_results.append(("Performance", success))
    
    def _show_test_summary(self):
        """显示测试总结"""
        print("\n" + "=" * 60)
        print("📊 测试总结")
        print("=" * 60)
        
        passed = len([r for r in self.test_results if r[1]])
        total = len(self.test_results)
        
        print(f"✅ 通过: {passed}/{total}")
        print(f"❌ 失败: {total - passed}/{total}")
        print(f"📊 成功率: {(passed/total)*100:.1f}%")
        
        print("\n详细结果:")
        for test_name, success in self.test_results:
            status = "✅ 通过" if success else "❌ 失败"
            print(f"  {status}: {test_name}")
        
        if passed == total:
            print("\n🎉 所有测试通过！重构成功！")
            print("🎯 重构成果:")
            print("  ✅ 去除了subtype多层级设计")
            print("  ✅ 实现了平级资源架构")
            print("  ✅ 统一标注了UID")
            print("  ✅ 内化了I/O处理")
            print("  ✅ 采用了协议导向设计")
        else:
            print(f"\n⚠️ 有{total - passed}个测试失败，需要进一步调试")


async def main():
    """主函数"""
    tester = RefactoredModifyTester()
    await tester.run_all_tests()


if __name__ == "__main__":
    asyncio.run(main()) 