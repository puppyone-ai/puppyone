"""
PuppyEngine ExecutableResources - Unified Architecture Tests

完整的统一架构测试:
- Edge Resources 测试
- Block Resources 测试  
- Protocol Adapter 测试
- URI格式支持测试
- 向后兼容性测试
- 性能对比测试
"""

import asyncio
import json
import time
import uuid
from typing import Dict, Any

from . import (
    # Core Classes
    GlobalResourceUID, ResourceConfig, IOConfig, ExecutionContext,
    ContentType, ResourceType,
    
    # Edge Resources
    EdgeResourceFactory,
    ModifyEditTextEdgeResource,
    ModifyConvert2TextEdgeResource,
    ModifyConvert2StructuredEdgeResource,
    
    # Block Resources  
    BlockResourceFactory,
    TextBlockResource,
    JSONBlockResource,
    
    # Protocol Adapters
    EdgeProtocolAdapter,
    EdgeProtocolValidator,
    create_example_protocols,
    
    # Legacy Compatibility
    LegacyModifierFactoryAdapter,
    create_modify_edit_text_resource,
    
    # Utility Functions
    create_resource_from_uri,
    list_available_resources
)


class UnifiedArchitectureTestSuite:
    """统一架构测试套件"""
    
    def __init__(self):
        self.test_results = {}
        self.performance_results = {}
    
    async def run_all_tests(self):
        """运行所有测试"""
        print("🚀 Starting Unified Architecture Test Suite")
        print("=" * 60)
        
        # 1. 基础架构测试
        await self._test_core_architecture()
        
        # 2. Edge Resources测试
        await self._test_edge_resources()
        
        # 3. Block Resources测试
        await self._test_block_resources()
        
        # 4. Protocol Adapter测试
        await self._test_protocol_adapters()
        
        # 5. URI格式测试
        await self._test_uri_support()
        
        # 6. 向后兼容性测试
        await self._test_backward_compatibility()
        
        # 7. 性能对比测试
        await self._test_performance_comparison()
        
        # 8. 生成测试报告
        self._generate_test_report()
    
    async def _test_core_architecture(self):
        """测试核心架构"""
        print("\n📋 Testing Core Architecture...")
        
        test_name = "core_architecture"
        results = []
        
        try:
            # 测试GlobalResourceUID
            uid1 = GlobalResourceUID(
                namespace="puppyagent",
                resource_type="edge",
                resource_name="modify.edit_text",
                version="v1"
            )
            
            uri = uid1.to_url()
            uid2 = GlobalResourceUID.from_url(uri)
            
            results.append({
                "test": "GlobalResourceUID creation and parsing",
                "passed": uid1.uid == uid2.uid,
                "details": f"URI: {uri}"
            })
            
            # 测试main_type和sub_type
            results.append({
                "test": "Resource name parsing",
                "passed": uid1.main_type == "modify" and uid1.sub_type == "edit_text",
                "details": f"main_type: {uid1.main_type}, sub_type: {uid1.sub_type}"
            })
            
            # 测试资源注册表
            available_resources = list_available_resources()
            results.append({
                "test": "Resource registry",
                "passed": "edge" in available_resources and "block" in available_resources,
                "details": f"Available: {list(available_resources.keys())}"
            })
            
        except Exception as e:
            results.append({
                "test": "Core architecture",
                "passed": False,
                "error": str(e)
            })
        
        self.test_results[test_name] = results
        self._print_test_results(test_name, results)
    
    async def _test_edge_resources(self):
        """测试Edge Resources"""
        print("\n⚡ Testing Edge Resources...")
        
        test_name = "edge_resources"
        results = []
        
        try:
            # 测试Edge Resource Factory
            edge_factory = EdgeResourceFactory()
            available_edges = edge_factory.list_available_resources()
            
            results.append({
                "test": "Edge factory initialization",
                "passed": len(available_edges) > 0,
                "details": f"Available edges: {available_edges}"
            })
            
            # 测试modify.edit_text Edge
            edit_text_edge = edge_factory.create_edge_resource("modify.edit_text")
            
            test_inputs = {
                "content": "Hello {{name}}, welcome to {{place}}!",
                "slice": [0, 20],
                "sort_type": "",
                "plugins": {"name": "World", "place": "PuppyAgent"}
            }
            
            result = await edit_text_edge.execute(test_inputs)
            expected_content = "Hello World, welcome"  # After slice [0, 20]
            
            results.append({
                "test": "modify.edit_text execution",
                "passed": expected_content in result.get("result", ""),
                "details": f"Result: {result.get('result', '')[:50]}..."
            })
            
            # 测试modify.convert2text Edge
            convert_edge = edge_factory.create_edge_resource("modify.convert2text")
            
            convert_inputs = {
                "content": {"message": "Hello", "data": [1, 2, 3]}
            }
            
            convert_result = await convert_edge.execute(convert_inputs)
            
            results.append({
                "test": "modify.convert2text execution",
                "passed": "message" in convert_result.get("result", ""),
                "details": f"Converted to text successfully"
            })
            
        except Exception as e:
            results.append({
                "test": "Edge resources",
                "passed": False,
                "error": str(e)
            })
        
        self.test_results[test_name] = results
        self._print_test_results(test_name, results)
    
    async def _test_block_resources(self):
        """测试Block Resources"""
        print("\n🧱 Testing Block Resources...")
        
        test_name = "block_resources"
        results = []
        
        try:
            # 测试Block Resource Factory
            block_factory = BlockResourceFactory()
            available_blocks = block_factory.list_available_resources()
            
            results.append({
                "test": "Block factory initialization",
                "passed": len(available_blocks) > 0,
                "details": f"Available blocks: {available_blocks}"
            })
            
            # 测试Text Block
            text_block = block_factory.create_block_resource("text")
            
            await text_block.write({"content": "Hello World"})
            read_result = await text_block.read()
            
            results.append({
                "test": "Text block read/write",
                "passed": read_result["data"]["content"] == "Hello World",
                "details": f"Content: {read_result['data']['content']}"
            })
            
            # 测试Text Block操作
            append_result = await text_block._execute_block_logic("append", {"text": " - PuppyAgent"})
            
            results.append({
                "test": "Text block append operation",
                "passed": append_result.get("success", False),
                "details": f"New length: {append_result.get('new_length', 0)}"
            })
            
            # 测试JSON Block
            json_block = block_factory.create_block_resource("json")
            
            test_data = {
                "user": "Alice",
                "settings": {
                    "theme": "dark",
                    "notifications": True
                }
            }
            
            await json_block.write({"content": test_data})
            
            # 测试路径操作
            get_result = await json_block._execute_block_logic("get_path", {
                "path": ["settings", "theme"]
            })
            
            results.append({
                "test": "JSON block path operations",
                "passed": get_result.get("value") == "dark",
                "details": f"Retrieved value: {get_result.get('value')}"
            })
            
        except Exception as e:
            results.append({
                "test": "Block resources",
                "passed": False,
                "error": str(e)
            })
        
        self.test_results[test_name] = results
        self._print_test_results(test_name, results)
    
    async def _test_protocol_adapters(self):
        """测试Protocol Adapters"""
        print("\n🔄 Testing Protocol Adapters...")
        
        test_name = "protocol_adapters"
        results = []
        
        try:
            adapter = EdgeProtocolAdapter()
            validator = EdgeProtocolValidator()
            
            # 测试新协议解析
            new_protocol = {
                "type": "resource://puppyagent/edge/modify.edit_text@v1",
                "content": "Hello {{name}}!",
                "slice": [0, -1],
                "plugins": {"name": "World"},
                "inputs": {"1": "1/input"},
                "outputs": {"2": "2/output"}
            }
            
            parsed = adapter.parse_edge_protocol("test_edge", new_protocol)
            
            results.append({
                "test": "New protocol parsing",
                "passed": parsed["protocol_version"] == "v2",
                "details": f"Resource: {parsed['resource_uid'].resource_name}"
            })
            
            # 测试传统协议解析
            legacy_protocol = {
                "type": "modify",
                "data": {
                    "modify_type": "edit_text",
                    "content": "Hello {{name}}!",
                    "extra_configs": {"slice": [0, -1]},
                    "plugins": {"name": "World"},
                    "inputs": {"1": "1/input"},
                    "outputs": {"2": "2/output"}
                }
            }
            
            parsed_legacy = adapter.parse_edge_protocol("test_edge_legacy", legacy_protocol)
            
            results.append({
                "test": "Legacy protocol parsing",
                "passed": parsed_legacy["protocol_version"] == "v1",
                "details": f"Resource: {parsed_legacy['resource_uid'].resource_name}"
            })
            
            # 测试协议验证
            validation = validator.validate_protocol("test_edge", new_protocol)
            
            results.append({
                "test": "Protocol validation",
                "passed": validation["valid"],
                "details": f"Errors: {len(validation['errors'])}, Warnings: {len(validation['warnings'])}"
            })
            
            # 测试协议转换
            converted_new = adapter.convert_to_new_protocol("test", legacy_protocol)
            converted_legacy = adapter.convert_to_legacy_protocol("test", new_protocol)
            
            results.append({
                "test": "Protocol conversion",
                "passed": "://" in converted_new["type"] and "data" in converted_legacy,
                "details": "Bidirectional conversion successful"
            })
            
        except Exception as e:
            results.append({
                "test": "Protocol adapters",
                "passed": False,
                "error": str(e)
            })
        
        self.test_results[test_name] = results
        self._print_test_results(test_name, results)
    
    async def _test_uri_support(self):
        """测试URI格式支持"""
        print("\n🌐 Testing URI Support...")
        
        test_name = "uri_support"
        results = []
        
        try:
            # 测试不同协议的URI
            uris = [
                "resource://puppyagent/edge/modify.edit_text@v1",
                "vibe://puppyagent/edge/modify.convert2text@v2",
                "puppyagent://local/block/text@v1"
            ]
            
            for uri in uris:
                try:
                    resource = create_resource_from_uri(uri)
                    results.append({
                        "test": f"URI creation: {uri}",
                        "passed": resource is not None,
                        "details": f"Resource type: {type(resource).__name__}"
                    })
                except Exception as e:
                    results.append({
                        "test": f"URI creation: {uri}",
                        "passed": False,
                        "error": str(e)
                    })
            
            # 测试URI解析的各个组件
            uid = GlobalResourceUID.from_url("resource://puppyagent/edge/modify.edit_text@v1")
            
            results.append({
                "test": "URI component parsing",
                "passed": (
                    uid.protocol == "resource" and
                    uid.namespace == "puppyagent" and
                    uid.resource_type == "edge" and
                    uid.main_type == "modify" and
                    uid.sub_type == "edit_text" and
                    uid.version == "v1"
                ),
                "details": f"All components parsed correctly"
            })
            
        except Exception as e:
            results.append({
                "test": "URI support",
                "passed": False,
                "error": str(e)
            })
        
        self.test_results[test_name] = results
        self._print_test_results(test_name, results)
    
    async def _test_backward_compatibility(self):
        """测试向后兼容性"""
        print("\n🔄 Testing Backward Compatibility...")
        
        test_name = "backward_compatibility"
        results = []
        
        try:
            # 测试Legacy Factory Functions
            legacy_resource = create_modify_edit_text_resource()
            
            test_inputs = {
                "content": "Legacy test {{value}}",
                "plugins": {"value": "SUCCESS"}
            }
            
            legacy_result = await legacy_resource.execute(test_inputs)
            
            results.append({
                "test": "Legacy factory functions",
                "passed": "SUCCESS" in legacy_result.get("result", ""),
                "details": "Legacy resource creation and execution"
            })
            
            # 测试Legacy Adapter
            adapter_result = LegacyModifierFactoryAdapter.execute(
                "edit_text",
                "Adapter test {{status}}",
                {"plugins": {"status": "WORKING"}}
            )
            
            results.append({
                "test": "Legacy modifier adapter",
                "passed": "WORKING" in str(adapter_result),
                "details": "Legacy adapter interface compatibility"
            })
            
            # 测试新旧资源的结果一致性
            new_edge = EdgeResourceFactory.create_edge_resource("modify.edit_text")
            
            test_content = "Consistency test {{check}}"
            test_plugins = {"check": "PASSED"}
            
            new_result = await new_edge.execute({
                "content": test_content,
                "plugins": test_plugins
            })
            
            legacy_result2 = await legacy_resource.execute({
                "content": test_content,
                "plugins": test_plugins
            })
            
            results.append({
                "test": "New vs Legacy result consistency",
                "passed": new_result.get("result") == legacy_result2.get("result"),
                "details": "Results match between new and legacy implementations"
            })
            
        except Exception as e:
            results.append({
                "test": "Backward compatibility",
                "passed": False,
                "error": str(e)
            })
        
        self.test_results[test_name] = results
        self._print_test_results(test_name, results)
    
    async def _test_performance_comparison(self):
        """测试性能对比"""
        print("\n⚡ Testing Performance Comparison...")
        
        test_name = "performance_comparison"
        results = []
        
        try:
            # 测试数据
            test_content = "Performance test " * 100 + " {{value}}"
            test_plugins = {"value": "BENCHMARK"}
            iterations = 100
            
            # 新架构性能测试
            new_edge = EdgeResourceFactory.create_edge_resource("modify.edit_text")
            
            start_time = time.time()
            for _ in range(iterations):
                await new_edge.execute({
                    "content": test_content,
                    "plugins": test_plugins
                })
            new_time = time.time() - start_time
            
            # Legacy架构性能测试
            legacy_edge = create_modify_edit_text_resource()
            
            start_time = time.time()
            for _ in range(iterations):
                await legacy_edge.execute({
                    "content": test_content,
                    "plugins": test_plugins
                })
            legacy_time = time.time() - start_time
            
            # 计算性能提升
            performance_improvement = ((legacy_time - new_time) / legacy_time) * 100
            
            results.append({
                "test": f"Performance comparison ({iterations} iterations)",
                "passed": new_time < legacy_time,
                "details": f"New: {new_time:.3f}s, Legacy: {legacy_time:.3f}s, Improvement: {performance_improvement:.1f}%"
            })
            
            self.performance_results = {
                "new_architecture_time": new_time,
                "legacy_architecture_time": legacy_time,
                "performance_improvement_percent": performance_improvement,
                "iterations": iterations
            }
            
        except Exception as e:
            results.append({
                "test": "Performance comparison",
                "passed": False,
                "error": str(e)
            })
        
        self.test_results[test_name] = results
        self._print_test_results(test_name, results)
    
    def _print_test_results(self, test_name: str, results: list):
        """打印测试结果"""
        print(f"\n  📊 {test_name.replace('_', ' ').title()} Results:")
        
        passed_count = 0
        total_count = len(results)
        
        for result in results:
            status = "✅" if result["passed"] else "❌"
            print(f"    {status} {result['test']}")
            
            if result["passed"]:
                passed_count += 1
                if "details" in result:
                    print(f"       📝 {result['details']}")
            else:
                if "error" in result:
                    print(f"       ❗ Error: {result['error']}")
                elif "details" in result:
                    print(f"       📝 {result['details']}")
        
        print(f"    📈 Summary: {passed_count}/{total_count} tests passed")
    
    def _generate_test_report(self):
        """生成测试报告"""
        print("\n" + "=" * 60)
        print("📋 UNIFIED ARCHITECTURE TEST REPORT")
        print("=" * 60)
        
        total_passed = 0
        total_tests = 0
        
        for test_category, results in self.test_results.items():
            passed = sum(1 for r in results if r["passed"])
            total = len(results)
            
            total_passed += passed
            total_tests += total
            
            status = "✅" if passed == total else "⚠️" if passed > 0 else "❌"
            print(f"{status} {test_category.replace('_', ' ').title()}: {passed}/{total}")
        
        print(f"\n🎯 Overall Result: {total_passed}/{total_tests} tests passed")
        print(f"📊 Success Rate: {(total_passed/total_tests)*100:.1f}%")
        
        if self.performance_results:
            print(f"\n⚡ Performance Results:")
            print(f"   🚀 New Architecture: {self.performance_results['new_architecture_time']:.3f}s")
            print(f"   🐌 Legacy Architecture: {self.performance_results['legacy_architecture_time']:.3f}s")
            print(f"   📈 Performance Improvement: {self.performance_results['performance_improvement_percent']:.1f}%")
        
        print("\n🎉 Test Suite Completed!")


async def run_unified_architecture_tests():
    """运行统一架构测试"""
    test_suite = UnifiedArchitectureTestSuite()
    await test_suite.run_all_tests()


if __name__ == "__main__":
    asyncio.run(run_unified_architecture_tests()) 