"""
Edge适配器系统测试

测试Edge适配器系统的各个组件功能。
"""

import asyncio
import unittest
from typing import Dict, Any

from .edge_adapter import (
    EdgeAdapterProtocol,
    BaseEdgeAdapter, 
    DefaultEdgeAdapter,
    ModifyEdgeAdapter,
    EdgeAdapterFactory,
    run_async_adapter
)

from .workflow_integration import (
    WorkFlowAdapterIntegration,
    patch_workflow_with_adapter,
    unpatch_workflow_adapter
)

from .base import ContentType, ContentAdapterFactory


class TestEdgeAdapterProtocol(unittest.TestCase):
    """测试Edge适配器协议"""
    
    def test_protocol_compliance(self):
        """测试协议合规性"""
        # 测试DefaultEdgeAdapter是否符合协议
        adapter = DefaultEdgeAdapter("test")
        self.assertIsInstance(adapter, EdgeAdapterProtocol)
        
        # 测试ModifyEdgeAdapter是否符合协议
        modify_adapter = ModifyEdgeAdapter()
        self.assertIsInstance(modify_adapter, EdgeAdapterProtocol)


class TestBaseEdgeAdapter(unittest.TestCase):
    """测试Edge适配器基类"""
    
    def setUp(self):
        """设置测试环境"""
        self.adapter = DefaultEdgeAdapter("test")
    
    def test_initialization(self):
        """测试初始化"""
        self.assertEqual(self.adapter.edge_type, "test")
        self.assertEqual(self.adapter.get_edge_type(), "test")
        self.assertIsNone(self.adapter.context)
        self.assertIsNone(self.adapter.metadata)
    
    def test_context_and_metadata(self):
        """测试上下文和元数据设置"""
        from .base import ExecutionContext, GlobalResourceUID, ResourceMetadata
        
        # 设置执行上下文
        context = ExecutionContext(resource_id="test_resource")
        self.adapter.set_context(context)
        self.assertEqual(self.adapter.context, context)
        
        # 设置资源元数据
        uid = GlobalResourceUID(resource_name="test")
        metadata = ResourceMetadata(uid=uid)
        self.adapter.set_metadata(metadata)
        self.assertEqual(self.adapter.metadata, metadata)


class TestDefaultEdgeAdapter(unittest.TestCase):
    """测试默认Edge适配器"""
    
    def setUp(self):
        """设置测试环境"""
        self.adapter = DefaultEdgeAdapter("test")
    
    async def test_adapt_inputs(self):
        """测试输入适配"""
        raw_inputs = {"key1": "value1", "key2": "value2"}
        block_configs = {"block1": {"content": "test"}}
        
        result = await self.adapter.adapt_inputs(raw_inputs, block_configs)
        self.assertEqual(result, raw_inputs)  # 默认适配器不做任何处理
    
    async def test_adapt_outputs(self):
        """测试输出适配"""
        raw_outputs = "test_output"
        output_block_types = {"block1": "text"}
        
        result = await self.adapter.adapt_outputs(raw_outputs, output_block_types)
        self.assertEqual(result, raw_outputs)  # 默认适配器不做任何处理
    
    def test_should_use_adapter(self):
        """测试是否使用适配器"""
        self.assertFalse(self.adapter.should_use_adapter())
    
    def test_async_methods(self):
        """测试异步方法"""
        # 使用run_async_adapter运行异步测试
        raw_inputs = {"test": "data"}
        block_configs = {}
        
        result = run_async_adapter(
            self.adapter.adapt_inputs(raw_inputs, block_configs)
        )
        self.assertEqual(result, raw_inputs)


class TestModifyEdgeAdapter(unittest.TestCase):
    """测试ModifyEdge适配器"""
    
    def setUp(self):
        """设置测试环境"""
        self.adapter = ModifyEdgeAdapter()
    
    def test_initialization(self):
        """测试初始化"""
        self.assertEqual(self.adapter.edge_type, "modify")
        self.assertTrue(self.adapter.should_use_adapter())
    
    async def test_adapt_inputs_text_block(self):
        """测试文本block的输入适配"""
        raw_inputs = {"block1": "input_value"}
        block_configs = {
            "block1": {
                "type": "text",
                "content": "Hello World"
            }
        }
        
        result = await self.adapter.adapt_inputs(raw_inputs, block_configs)
        self.assertIn("block1", result)
        self.assertEqual(result["block1"], "Hello World")
    
    async def test_adapt_inputs_structured_block(self):
        """测试结构化block的输入适配"""
        raw_inputs = {"block1": "input_value"}
        block_configs = {
            "block1": {
                "type": "structured", 
                "content": {"name": "test", "value": 123}
            }
        }
        
        result = await self.adapter.adapt_inputs(raw_inputs, block_configs)
        self.assertIn("block1", result)
        # 结构化数据应该被JSON适配器处理
        self.assertIsInstance(result["block1"], dict)
    
    async def test_adapt_outputs_single_block(self):
        """测试单个输出block的适配"""
        raw_outputs = "processed_result"
        output_block_types = {"output1": "text"}
        
        result = await self.adapter.adapt_outputs(raw_outputs, output_block_types)
        self.assertEqual(result, "processed_result")
    
    async def test_adapt_outputs_multiple_blocks(self):
        """测试多个输出block的适配"""
        raw_outputs = "processed_result"
        output_block_types = {
            "output1": "text",
            "output2": "structured"
        }
        
        result = await self.adapter.adapt_outputs(raw_outputs, output_block_types)
        self.assertIsInstance(result, dict)
        self.assertIn("output1", result)
        self.assertIn("output2", result)
    
    def test_get_block_type(self):
        """测试block类型获取"""
        # 显式类型
        block_config = {"type": "text", "content": "test"}
        block_type = self.adapter._get_block_type(block_config)
        self.assertEqual(block_type, "text")
        
        # 推断类型 - 结构化数据
        block_config = {"content": {"key": "value"}}
        block_type = self.adapter._get_block_type(block_config)
        self.assertEqual(block_type, "structured")
        
        # 推断类型 - 文本数据
        block_config = {"content": "text content"}
        block_type = self.adapter._get_block_type(block_config)
        self.assertEqual(block_type, "text")
    
    def test_get_content_adapter(self):
        """测试Content Adapter获取"""
        # 文本适配器
        text_adapter = self.adapter._get_content_adapter("text")
        self.assertEqual(text_adapter.content_type, ContentType.TEXT)
        
        # JSON适配器
        json_adapter = self.adapter._get_content_adapter("structured")
        self.assertEqual(json_adapter.content_type, ContentType.JSON)
        
        # 默认适配器
        default_adapter = self.adapter._get_content_adapter("unknown")
        self.assertEqual(default_adapter.content_type, ContentType.TEXT)


class TestEdgeAdapterFactory(unittest.TestCase):
    """测试Edge适配器工厂"""
    
    def test_create_default_adapter(self):
        """测试创建默认适配器"""
        adapter = EdgeAdapterFactory.create_adapter("unknown_type")
        self.assertIsInstance(adapter, DefaultEdgeAdapter)
        self.assertEqual(adapter.edge_type, "unknown_type")
    
    def test_create_modify_adapter(self):
        """测试创建ModifyEdge适配器"""
        adapter = EdgeAdapterFactory.create_adapter("modify")
        self.assertIsInstance(adapter, ModifyEdgeAdapter)
        self.assertEqual(adapter.edge_type, "modify")
    
    def test_create_known_edge_adapters(self):
        """测试创建已知Edge类型的适配器"""
        edge_types = ["llm", "search", "code", "save", "load"]
        
        for edge_type in edge_types:
            adapter = EdgeAdapterFactory.create_adapter(edge_type)
            self.assertIsInstance(adapter, DefaultEdgeAdapter)
            self.assertEqual(adapter.edge_type, edge_type)
    
    def test_register_custom_adapter(self):
        """测试注册自定义适配器"""
        class CustomAdapter(BaseEdgeAdapter):
            def __init__(self):
                super().__init__("custom")
            
            async def adapt_inputs(self, raw_inputs, block_configs):
                return raw_inputs
            
            async def adapt_outputs(self, raw_outputs, output_block_types):
                return raw_outputs
            
            def should_use_adapter(self):
                return True
        
        # 注册自定义适配器
        EdgeAdapterFactory.register_adapter("custom", CustomAdapter)
        
        # 创建自定义适配器实例
        adapter = EdgeAdapterFactory.create_adapter("custom")
        self.assertIsInstance(adapter, CustomAdapter)
        self.assertEqual(adapter.edge_type, "custom")


class TestWorkFlowAdapterIntegration(unittest.TestCase):
    """测试WorkFlow适配器集成"""
    
    def setUp(self):
        """设置测试环境"""
        self.integration = WorkFlowAdapterIntegration()
    
    def test_initialization(self):
        """测试初始化"""
        self.assertIn("modify", self.integration.enabled_edge_types)
    
    def test_should_use_adapter(self):
        """测试适配器使用判断"""
        self.assertTrue(self.integration.should_use_adapter("modify"))
        self.assertFalse(self.integration.should_use_adapter("llm"))
    
    def test_enable_disable_adapter(self):
        """测试启用/禁用适配器"""
        # 启用LLM适配器
        self.integration.enable_adapter_for_edge_type("llm")
        self.assertTrue(self.integration.should_use_adapter("llm"))
        
        # 禁用LLM适配器
        self.integration.disable_adapter_for_edge_type("llm")
        self.assertFalse(self.integration.should_use_adapter("llm"))
    
    def test_prepare_block_configs_with_types(self):
        """测试准备包含类型的block配置"""
        blocks = {
            "1": {
                "label": "test_block",
                "type": "text",
                "data": {"content": "test content"},
                "looped": False
            }
        }
        edge_to_inputs_mapping = {"edge1": {"1"}}
        
        result = self.integration.prepare_block_configs_with_types(
            "edge1", blocks, edge_to_inputs_mapping
        )
        
        self.assertIn("1", result)
        self.assertEqual(result["1"]["type"], "text")
        self.assertEqual(result["1"]["content"], "test content")
        self.assertEqual(result["1"]["label"], "test_block")
    
    def test_prepare_output_block_types(self):
        """测试准备输出block类型映射"""
        blocks = {
            "2": {"type": "structured"},
            "3": {"type": "text"}
        }
        edge_to_outputs_mapping = {"edge1": {"2", "3"}}
        
        result = self.integration.prepare_output_block_types(
            "edge1", blocks, edge_to_outputs_mapping
        )
        
        self.assertEqual(result["2"], "structured")
        self.assertEqual(result["3"], "text")


class TestAsyncAdapterHelpers(unittest.TestCase):
    """测试异步适配器辅助函数"""
    
    def test_run_async_adapter(self):
        """测试异步适配器运行函数"""
        async def async_function():
            return "async_result"
        
        result = run_async_adapter(async_function())
        self.assertEqual(result, "async_result")
    
    def test_run_async_adapter_with_exception(self):
        """测试异步适配器异常处理"""
        async def async_function_with_error():
            raise ValueError("Test error")
        
        with self.assertRaises(ValueError):
            run_async_adapter(async_function_with_error())


def run_all_tests():
    """运行所有测试"""
    # 创建测试套件
    test_suite = unittest.TestSuite()
    
    # 添加测试类
    test_classes = [
        TestEdgeAdapterProtocol,
        TestBaseEdgeAdapter,
        TestDefaultEdgeAdapter,
        TestModifyEdgeAdapter,
        TestEdgeAdapterFactory,
        TestWorkFlowAdapterIntegration,
        TestAsyncAdapterHelpers
    ]
    
    for test_class in test_classes:
        tests = unittest.TestLoader().loadTestsFromTestCase(test_class)
        test_suite.addTests(tests)
    
    # 运行测试
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(test_suite)
    
    return result.wasSuccessful()


if __name__ == "__main__":
    print("=== Edge适配器系统测试 ===\n")
    
    success = run_all_tests()
    
    if success:
        print("\n" + "="*50)
        print("所有测试通过！Edge适配器系统功能正常。")
        print("="*50)
    else:
        print("\n" + "="*50)
        print("部分测试失败，请检查Edge适配器系统。")
        print("="*50) 