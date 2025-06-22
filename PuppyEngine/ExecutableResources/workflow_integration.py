"""
WorkFlow集成模块 - 为WorkFlow提供Edge适配器支持

在不修改原始WorkFlow代码的前提下，通过包装器模式为WorkFlow提供Content Adapter能力。
"""

import asyncio
from typing import Dict, Any, Set, Optional
from concurrent.futures import ThreadPoolExecutor

from .edge_adapter import (
    EdgeAdapterFactory,
    EdgeExecutorWrapper,
    create_edge_executor_wrapper,
    run_async_adapter
)


class WorkFlowAdapterIntegration:
    """WorkFlow适配器集成类"""
    
    def __init__(self):
        self.edge_executor_wrapper = create_edge_executor_wrapper()
        self.enabled_edge_types = {"modify"}  # 目前只为modify类型启用适配器
    
    def should_use_adapter(self, edge_type: str) -> bool:
        """判断是否应该为该Edge类型使用适配器"""
        return edge_type in self.enabled_edge_types
    
    def enable_adapter_for_edge_type(self, edge_type: str):
        """为特定Edge类型启用适配器"""
        self.enabled_edge_types.add(edge_type)
    
    def disable_adapter_for_edge_type(self, edge_type: str):
        """为特定Edge类型禁用适配器"""
        self.enabled_edge_types.discard(edge_type)
    
    def prepare_block_configs_with_types(
        self, 
        edge_id: str, 
        blocks: Dict[str, Dict], 
        edge_to_inputs_mapping: Dict[str, Set[str]]
    ) -> Dict[str, Any]:
        """为Edge准备包含类型信息的Block配置"""
        input_block_ids = edge_to_inputs_mapping.get(edge_id, [])
        block_configs = {}
        
        for block_id in input_block_ids:
            block = blocks.get(block_id)
            if block:
                block_configs[block_id] = {
                    "label": block.get("label"),
                    "content": block.get("data", {}).get("content"),
                    "type": block.get("type", "text"),  # 重要：包含block类型
                    "embedding_view": block.get("data", {}).get("embedding_view", []),
                    "looped": block.get("looped", False),
                    "collection_configs": block.get("collection_configs", {})
                }
        
        return block_configs
    
    def prepare_output_block_types(
        self,
        edge_id: str,
        blocks: Dict[str, Dict],
        edge_to_outputs_mapping: Dict[str, Set[str]]
    ) -> Dict[str, str]:
        """准备输出Block类型映射"""
        output_block_ids = edge_to_outputs_mapping.get(edge_id, [])
        output_block_types = {}
        
        for block_id in output_block_ids:
            block = blocks.get(block_id)
            if block:
                output_block_types[block_id] = block.get("type", "text")
        
        return output_block_types
    
    def execute_edge_with_adapter(
        self,
        edge_type: str,
        edge_configs: Dict[str, Any],
        block_configs: Dict[str, Any],
        output_block_types: Optional[Dict[str, str]] = None
    ) -> Any:
        """执行Edge（带适配器支持）"""
        
        if self.should_use_adapter(edge_type):
            # 使用适配器执行
            return run_async_adapter(
                self.edge_executor_wrapper.execute_with_adapter(
                    edge_type=edge_type,
                    edge_configs=edge_configs,
                    block_configs=block_configs,
                    output_block_types=output_block_types
                )
            )
        else:
            # 传统执行方式
            from ModularEdges.EdgeExecutor import EdgeExecutor
            executor = EdgeExecutor(
                edge_type=edge_type,
                edge_configs=edge_configs,
                block_configs=block_configs
            )
            return executor.execute()


class EnhancedWorkFlowExecutor:
    """增强的WorkFlow执行器 - 集成Edge适配器"""
    
    def __init__(self, workflow_instance):
        """
        Args:
            workflow_instance: 原始WorkFlow实例
        """
        self.workflow = workflow_instance
        self.adapter_integration = WorkFlowAdapterIntegration()
    
    def execute_edge_batch_with_adapter(self, edge_batch: Set[str]) -> Dict[str, Any]:
        """执行Edge批次（带适配器支持）"""
        futures = {}
        results = {}
        
        try:
            # 提交所有Edge进行并发执行
            for edge_id in edge_batch:
                edge_info = self.workflow.edges.get(edge_id)
                edge_type = edge_info.get("type")
                
                # 准备包含类型信息的block配置
                block_configs = self.adapter_integration.prepare_block_configs_with_types(
                    edge_id, 
                    self.workflow.blocks, 
                    self.workflow.edge_to_inputs_mapping
                )
                
                # 准备输出block类型映射
                output_block_types = self.adapter_integration.prepare_output_block_types(
                    edge_id,
                    self.workflow.blocks,
                    self.workflow.edge_to_outputs_mapping
                )
                
                # 提交Edge执行
                future = self.workflow.thread_executor.submit(
                    self.adapter_integration.execute_edge_with_adapter,
                    edge_type,
                    edge_info.get("data", {}),
                    block_configs,
                    output_block_types
                )
                futures[future] = edge_id
            
            # 等待所有Edge完成
            import concurrent.futures
            for future in concurrent.futures.as_completed(futures):
                edge_id = futures[future]
                try:
                    results = self._process_edge_result_with_adapter(edge_id, results, future)
                except Exception as e:
                    from Utils.logger import log_error
                    import traceback
                    log_error(f"Edge {edge_id} execution failed with error: {str(e)}\n{traceback.format_exc()}")
                    raise
            
            return results
            
        except Exception as e:
            # 失败时恢复状态
            with self.workflow.state_lock:
                for edge_id in edge_batch:
                    self.workflow.edge_states[edge_id] = "pending"
            raise
    
    def _process_edge_result_with_adapter(
        self,
        edge_id: str,
        results: Dict[str, Any],
        future
    ) -> Dict[str, Any]:
        """处理Edge执行结果（适配器版本）"""
        edge_result = future.result()
        
        from Utils.logger import log_info, log_warning, log_error
        
        # 详细执行结果日志
        log_msg = (
            f"\nEdge Execution Summary (with Adapter):"
            f"\n------------------------"
            f"\nEdge ID: {edge_id}"
            f"\nStatus: {edge_result.status if hasattr(edge_result, 'status') else 'completed'}"
        )
        
        if hasattr(edge_result, 'error') and edge_result.error:
            log_msg += f"\nError: {str(edge_result.error)}"
            log_error(log_msg)
            raise edge_result.error
        
        log_msg += f"\nOutput Blocks: {list(self.workflow.edge_to_outputs_mapping.get(edge_id, []))}"
        log_info(log_msg)
        
        # 处理结果
        actual_result = edge_result.result if hasattr(edge_result, 'result') else edge_result
        
        if hasattr(edge_result, 'status') and edge_result.status == "completed":
            # 映射结果到输出blocks
            for block_id in self.workflow.edge_to_outputs_mapping.get(edge_id, []):
                # 特殊处理ifelse类型Edge
                if self.workflow.edges.get(edge_id, {}).get("type") == "ifelse":
                    for block_id, content in actual_result.items():
                        results[block_id] = content
                else:
                    results[block_id] = actual_result
                log_info(f"[DEBUG] Block {block_id} updated with result type: {type(actual_result)}")
        else:
            # 处理没有status属性的情况（直接返回结果）
            for block_id in self.workflow.edge_to_outputs_mapping.get(edge_id, []):
                results[block_id] = actual_result
                log_info(f"[DEBUG] Block {block_id} updated with result type: {type(actual_result)}")
        
        return results


def create_enhanced_workflow_executor(workflow_instance):
    """创建增强的WorkFlow执行器"""
    return EnhancedWorkFlowExecutor(workflow_instance)


# 使用示例和辅助函数
def patch_workflow_with_adapter(workflow_instance):
    """为WorkFlow实例添加适配器支持（猴子补丁方式）"""
    enhanced_executor = create_enhanced_workflow_executor(workflow_instance)
    
    # 保存原始方法
    workflow_instance._original_execute_edge_batch = workflow_instance._execute_edge_batch
    
    # 替换为增强版本
    workflow_instance._execute_edge_batch = enhanced_executor.execute_edge_batch_with_adapter
    
    return workflow_instance


def unpatch_workflow_adapter(workflow_instance):
    """移除WorkFlow实例的适配器支持"""
    if hasattr(workflow_instance, '_original_execute_edge_batch'):
        workflow_instance._execute_edge_batch = workflow_instance._original_execute_edge_batch
        delattr(workflow_instance, '_original_execute_edge_batch')
    
    return workflow_instance 