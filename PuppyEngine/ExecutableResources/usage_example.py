"""
Edge适配器系统使用示例

展示如何在不修改原始WorkFlow代码的情况下，为WorkFlow添加Content Adapter支持。
"""

import json
import os
from typing import Dict, Any

# 导入原始WorkFlow
from Server.WorkFlow import WorkFlow

# 导入Edge适配器系统
from ExecutableResources import (
    patch_workflow_with_adapter,
    unpatch_workflow_adapter,
    WorkFlowAdapterIntegration,
    EdgeAdapterFactory
)


def example_workflow_with_adapter():
    """示例：使用适配器增强的WorkFlow"""
    
    # 示例WorkFlow JSON数据
    workflow_data = {
        "blocks": {
            "1": {
                "label": "input_text",
                "type": "text",
                "data": {
                    "content": "Hello World"
                }
            },
            "2": {
                "label": "output_text", 
                "type": "text",
                "data": {
                    "content": ""
                }
            },
            "3": {
                "label": "structured_data",
                "type": "structured",
                "data": {
                    "content": {"name": "test", "value": 123}
                }
            },
            "4": {
                "label": "converted_text",
                "type": "text", 
                "data": {
                    "content": ""
                }
            }
        },
        "edges": {
            "modify_1": {
                "type": "modify",
                "data": {
                    "modify_type": "copy",
                    "content": "{{input_text}}",
                    "inputs": {"1": "input_text"},
                    "outputs": {"2": "output_text"}
                }
            },
            "modify_2": {
                "type": "modify", 
                "data": {
                    "modify_type": "convert2text",
                    "content": "{{structured_data}}",
                    "inputs": {"3": "structured_data"},
                    "outputs": {"4": "converted_text"}
                }
            }
        },
        "version": "0.1"
    }
    
    print("=== Edge适配器系统使用示例 ===\n")
    
    # 1. 创建原始WorkFlow实例
    print("1. 创建原始WorkFlow实例...")
    workflow = WorkFlow(workflow_data)
    print(f"   - 创建成功，包含 {len(workflow.blocks)} 个blocks，{len(workflow.edges)} 个edges")
    
    # 2. 为WorkFlow添加适配器支持（不修改原始代码）
    print("\n2. 为WorkFlow添加适配器支持...")
    enhanced_workflow = patch_workflow_with_adapter(workflow)
    print("   - 适配器已安装，ModifyEdge将使用Content Adapter处理数据")
    
    # 3. 执行WorkFlow（现在ModifyEdge会使用适配器）
    print("\n3. 执行WorkFlow（带适配器）...")
    try:
        results = []
        for output_blocks in enhanced_workflow.process():
            print(f"   - 批次完成，输出blocks: {list(output_blocks.keys())}")
            results.append(output_blocks)
        
        print(f"\n4. 执行完成！")
        print(f"   - 总共处理了 {len(results)} 个批次")
        print(f"   - 最终blocks状态:")
        for block_id, block_data in enhanced_workflow.blocks.items():
            content = block_data.get("data", {}).get("content", "")
            block_type = block_data.get("type", "unknown")
            print(f"     Block {block_id} ({block_type}): {content}")
            
    except Exception as e:
        print(f"   - 执行失败: {str(e)}")
    
    # 5. 移除适配器支持（可选）
    print("\n5. 清理适配器...")
    unpatch_workflow_adapter(enhanced_workflow)
    print("   - 适配器已移除")
    
    return enhanced_workflow


def example_edge_adapter_configuration():
    """示例：Edge适配器配置"""
    
    print("\n=== Edge适配器配置示例 ===\n")
    
    # 1. 创建适配器集成实例
    integration = WorkFlowAdapterIntegration()
    
    print("1. 当前适配器配置:")
    print(f"   - 启用适配器的Edge类型: {integration.enabled_edge_types}")
    
    # 2. 为其他Edge类型启用适配器
    print("\n2. 为LLMEdge启用适配器...")
    integration.enable_adapter_for_edge_type("llm")
    print(f"   - 更新后的启用列表: {integration.enabled_edge_types}")
    
    # 3. 检查特定Edge类型是否使用适配器
    edge_types = ["modify", "llm", "search", "code"]
    print("\n3. 检查各Edge类型的适配器状态:")
    for edge_type in edge_types:
        uses_adapter = integration.should_use_adapter(edge_type)
        print(f"   - {edge_type}: {'✓ 使用适配器' if uses_adapter else '✗ 不使用适配器'}")
    
    # 4. 禁用某个Edge类型的适配器
    print("\n4. 禁用LLMEdge的适配器...")
    integration.disable_adapter_for_edge_type("llm")
    print(f"   - 更新后的启用列表: {integration.enabled_edge_types}")


def example_custom_edge_adapter():
    """示例：创建自定义Edge适配器"""
    
    print("\n=== 自定义Edge适配器示例 ===\n")
    
    from ExecutableResources.edge_adapter import BaseEdgeAdapter
    from ExecutableResources.base import ContentAdapterFactory, ContentType
    
    class CustomLLMEdgeAdapter(BaseEdgeAdapter):
        """自定义LLM Edge适配器"""
        
        def __init__(self):
            super().__init__("llm")
        
        async def adapt_inputs(self, raw_inputs: Dict[str, Any], block_configs: Dict[str, Any]) -> Dict[str, Any]:
            """LLM Edge输入适配"""
            print("   - 正在适配LLM Edge输入...")
            
            # 为LLM Edge进行特殊的输入处理
            adapted_inputs = {}
            for key, value in raw_inputs.items():
                if key in block_configs:
                    block_config = block_configs[key]
                    content = block_config.get("content", "")
                    
                    # 对文本内容进行预处理
                    if isinstance(content, str):
                        # 示例：为LLM输入添加特殊标记
                        adapted_content = f"[PROCESSED] {content}"
                        adapted_inputs[key] = adapted_content
                    else:
                        adapted_inputs[key] = content
                else:
                    adapted_inputs[key] = value
            
            return adapted_inputs
        
        async def adapt_outputs(self, raw_outputs: Any, output_block_types: Dict[str, str]) -> Any:
            """LLM Edge输出适配"""
            print("   - 正在适配LLM Edge输出...")
            
            # 为LLM输出添加后处理
            if isinstance(raw_outputs, str):
                # 示例：清理LLM输出中的特殊标记
                cleaned_output = raw_outputs.replace("[PROCESSED]", "").strip()
                return f"[LLM_OUTPUT] {cleaned_output}"
            
            return raw_outputs
        
        def should_use_adapter(self) -> bool:
            """LLM Edge使用适配器"""
            return True
    
    # 1. 注册自定义适配器
    print("1. 注册自定义LLM Edge适配器...")
    EdgeAdapterFactory.register_adapter("llm", CustomLLMEdgeAdapter)
    print("   - 自定义适配器已注册")
    
    # 2. 创建适配器实例
    print("\n2. 创建适配器实例...")
    llm_adapter = EdgeAdapterFactory.create_adapter("llm")
    print(f"   - 创建的适配器类型: {type(llm_adapter).__name__}")
    print(f"   - 适配器Edge类型: {llm_adapter.get_edge_type()}")
    print(f"   - 是否使用适配器: {llm_adapter.should_use_adapter()}")


def run_all_examples():
    """运行所有示例"""
    try:
        # 示例1：WorkFlow适配器集成
        example_workflow_with_adapter()
        
        # 示例2：适配器配置
        example_edge_adapter_configuration()
        
        # 示例3：自定义适配器
        example_custom_edge_adapter()
        
        print("\n" + "="*50)
        print("所有示例执行完成！")
        print("="*50)
        
    except Exception as e:
        print(f"\n示例执行失败: {str(e)}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    run_all_examples() 