"""
PuppyEngine ExecutableResources - Edge Protocol Adapter

Edge Protocol适配器:
- 支持URI格式的type定义（如resource://puppyagent/edge/modify.edit_text@v1）
- 支持扁平化配置结构（去除嵌套的data层）
- 兼容既有WorkFlow的edge protocol
- 统一的Edge资源调用接口
"""

import uuid
from typing import Any, Dict, List, Optional, Union
from datetime import datetime

from .base import (
    ExecutableResource,
    ResourceConfigProtocol,
    ExecutionContext,
    GlobalResourceUID,
    ResourceType,
    ContentType,
    ResourceConfig,
    IOConfig
)
from .edge_resources import EdgeResourceFactory
from .block_resources import BlockResourceFactory


class EdgeProtocolAdapter:
    """Edge Protocol适配器 - 处理新旧协议格式转换"""
    
    def __init__(self):
        self.edge_factory = EdgeResourceFactory()
        self.block_factory = BlockResourceFactory()
    
    def parse_edge_protocol(self, edge_id: str, edge_config: Dict[str, Any]) -> Dict[str, Any]:
        """解析Edge Protocol，支持新旧两种格式"""
        
        # 检测协议格式
        if self._is_new_protocol(edge_config):
            return self._parse_new_protocol(edge_id, edge_config)
        else:
            return self._parse_legacy_protocol(edge_id, edge_config)
    
    def _is_new_protocol(self, edge_config: Dict[str, Any]) -> bool:
        """检测是否为新协议格式"""
        edge_type = edge_config.get("type", "")
        
        # 新协议特征：
        # 1. type包含URI格式（如resource://...）
        # 2. type包含subtype（如modify.edit_text）
        # 3. 配置为扁平化结构（没有data嵌套）
        
        if "://" in edge_type:
            return True
        
        if "." in edge_type and "data" not in edge_config:
            return True
        
        return False
    
    def _parse_new_protocol(self, edge_id: str, edge_config: Dict[str, Any]) -> Dict[str, Any]:
        """解析新协议格式"""
        edge_type = edge_config.get("type", "")
        
        # 解析资源UID
        if "://" in edge_type:
            # URI格式：resource://puppyagent/edge/modify.edit_text@v1
            resource_uid = GlobalResourceUID.from_url(edge_type)
        else:
            # 简化格式：modify.edit_text
            resource_uid = GlobalResourceUID(
                namespace="puppyagent",
                resource_type="edge",
                resource_name=edge_type,
                version="v1"
            )
        
        # 提取配置参数（扁平化）
        config_params = {}
        reserved_keys = {"type", "inputs", "outputs"}
        
        for key, value in edge_config.items():
            if key not in reserved_keys:
                config_params[key] = value
        
        # 提取I/O映射
        inputs = edge_config.get("inputs", {})
        outputs = edge_config.get("outputs", {})
        
        return {
            "edge_id": edge_id,
            "resource_uid": resource_uid,
            "config_params": config_params,
            "inputs": inputs,
            "outputs": outputs,
            "protocol_version": "v2"
        }
    
    def _parse_legacy_protocol(self, edge_id: str, edge_config: Dict[str, Any]) -> Dict[str, Any]:
        """解析传统协议格式"""
        edge_type = edge_config.get("type", "")
        edge_data = edge_config.get("data", {})
        
        # 处理subtype
        modify_type = edge_data.get("modify_type", "")
        if edge_type == "modify" and modify_type:
            resource_name = f"modify.{modify_type}"
        else:
            resource_name = edge_type
        
        # 创建资源UID
        resource_uid = GlobalResourceUID(
            namespace="puppyagent",
            resource_type="edge",
            resource_name=resource_name,
            version="v1"
        )
        
        # 提取配置参数
        config_params = {}
        reserved_keys = {"modify_type", "inputs", "outputs"}
        
        for key, value in edge_data.items():
            if key not in reserved_keys:
                config_params[key] = value
        
        # 提取I/O映射
        inputs = edge_data.get("inputs", {})
        outputs = edge_data.get("outputs", {})
        
        return {
            "edge_id": edge_id,
            "resource_uid": resource_uid,
            "config_params": config_params,
            "inputs": inputs,
            "outputs": outputs,
            "protocol_version": "v1"
        }
    
    async def execute_edge(
        self, 
        parsed_protocol: Dict[str, Any], 
        input_blocks: Dict[str, Any]
    ) -> Dict[str, Any]:
        """执行Edge资源"""
        
        resource_uid = parsed_protocol["resource_uid"]
        config_params = parsed_protocol["config_params"]
        inputs_mapping = parsed_protocol["inputs"]
        outputs_mapping = parsed_protocol["outputs"]
        
        # 创建Edge资源
        edge_resource = self.edge_factory.create_edge_resource(
            resource_uid.to_url()
        )
        
        # 准备输入数据
        processed_inputs = await self._prepare_inputs(
            input_blocks, 
            inputs_mapping, 
            config_params
        )
        
        # 执行Edge资源
        execution_results = await edge_resource.execute(processed_inputs)
        
        # 处理输出数据
        output_blocks = await self._process_outputs(
            execution_results,
            outputs_mapping,
            parsed_protocol["edge_id"]
        )
        
        return output_blocks
    
    async def _prepare_inputs(
        self, 
        input_blocks: Dict[str, Any], 
        inputs_mapping: Dict[str, str],
        config_params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """准备输入数据"""
        processed_inputs = {}
        
        # 处理来自Block的输入
        for input_key, block_reference in inputs_mapping.items():
            # block_reference格式：block_id/label 或 block_id
            if "/" in block_reference:
                block_id, block_label = block_reference.split("/", 1)
            else:
                block_id = block_reference
                block_label = None
            
            # 获取Block数据
            if block_id in input_blocks:
                block_data = input_blocks[block_id]
                
                # 根据Block类型提取内容
                if isinstance(block_data, dict):
                    if "data" in block_data:
                        # WorkFlow格式的Block
                        content = block_data["data"].get("content")
                        embedding_view = block_data["data"].get("embedding_view", [])
                        
                        if embedding_view:
                            processed_inputs[input_key] = {
                                "content": content,
                                "embedding_view": embedding_view
                            }
                        else:
                            processed_inputs[input_key] = content
                    else:
                        # 直接的数据
                        processed_inputs[input_key] = block_data
                else:
                    # 简单数据
                    processed_inputs[input_key] = block_data
        
        # 合并配置参数
        processed_inputs.update(config_params)
        
        return processed_inputs
    
    async def _process_outputs(
        self, 
        execution_results: Dict[str, Any], 
        outputs_mapping: Dict[str, str],
        edge_id: str
    ) -> Dict[str, Any]:
        """处理输出数据"""
        output_blocks = {}
        
        # 获取主要结果
        main_result = execution_results.get("result")
        metadata = execution_results.get("_metadata", {})
        
        # 根据输出映射创建Block
        for output_key, block_reference in outputs_mapping.items():
            # block_reference格式：block_id/label 或 block_id
            if "/" in block_reference:
                block_id, block_label = block_reference.split("/", 1)
            else:
                block_id = block_reference
                block_label = f"Output from {edge_id}"
            
            # 确定Block类型和内容
            if isinstance(main_result, str):
                # 文本输出
                block_type = "text"
                block_content = {"content": main_result}
            elif isinstance(main_result, (dict, list)):
                # 结构化输出
                block_type = "structured"
                block_content = {"content": main_result}
            else:
                # 其他类型，转为文本
                block_type = "text"
                block_content = {"content": str(main_result)}
            
            # 创建Block数据结构（兼容WorkFlow格式）
            output_blocks[block_id] = {
                "type": block_type,
                "label": block_label,
                "data": block_content,
                "metadata": {
                    "created_by": edge_id,
                    "created_at": datetime.utcnow().isoformat(),
                    "source_metadata": metadata
                }
            }
        
        return output_blocks
    
    def convert_to_new_protocol(self, edge_id: str, legacy_config: Dict[str, Any]) -> Dict[str, Any]:
        """将传统协议转换为新协议格式"""
        
        parsed = self._parse_legacy_protocol(edge_id, legacy_config)
        resource_uid = parsed["resource_uid"]
        config_params = parsed["config_params"]
        inputs = parsed["inputs"]
        outputs = parsed["outputs"]
        
        # 构建新协议格式
        new_protocol = {
            "type": resource_uid.to_url(),
            "inputs": inputs,
            "outputs": outputs
        }
        
        # 添加扁平化的配置参数
        new_protocol.update(config_params)
        
        return new_protocol
    
    def convert_to_legacy_protocol(self, edge_id: str, new_config: Dict[str, Any]) -> Dict[str, Any]:
        """将新协议转换为传统协议格式"""
        
        parsed = self._parse_new_protocol(edge_id, new_config)
        resource_uid = parsed["resource_uid"]
        config_params = parsed["config_params"]
        inputs = parsed["inputs"]
        outputs = parsed["outputs"]
        
        # 构建传统协议格式
        if resource_uid.main_type == "modify":
            legacy_protocol = {
                "type": "modify",
                "data": {
                    "modify_type": resource_uid.sub_type,
                    "inputs": inputs,
                    "outputs": outputs
                }
            }
            
            # 添加配置参数到data中
            legacy_protocol["data"].update(config_params)
        else:
            # 其他类型的Edge
            legacy_protocol = {
                "type": resource_uid.main_type,
                "data": {
                    "inputs": inputs,
                    "outputs": outputs
                }
            }
            
            # 添加配置参数到data中
            legacy_protocol["data"].update(config_params)
        
        return legacy_protocol


class EdgeProtocolValidator:
    """Edge Protocol验证器"""
    
    def __init__(self):
        self.adapter = EdgeProtocolAdapter()
    
    def validate_protocol(self, edge_id: str, edge_config: Dict[str, Any]) -> Dict[str, Any]:
        """验证Edge Protocol"""
        
        validation_result = {
            "valid": True,
            "errors": [],
            "warnings": [],
            "protocol_version": "unknown"
        }
        
        try:
            # 解析协议
            parsed = self.adapter.parse_edge_protocol(edge_id, edge_config)
            validation_result["protocol_version"] = parsed["protocol_version"]
            
            # 验证资源UID
            resource_uid = parsed["resource_uid"]
            if not self._validate_resource_uid(resource_uid):
                validation_result["errors"].append(f"Invalid resource UID: {resource_uid}")
            
            # 验证输入输出映射
            inputs = parsed["inputs"]
            outputs = parsed["outputs"]
            
            if not inputs:
                validation_result["warnings"].append("No input mappings defined")
            
            if not outputs:
                validation_result["warnings"].append("No output mappings defined")
            
            # 验证配置参数
            config_params = parsed["config_params"]
            validation_errors = self._validate_config_params(resource_uid, config_params)
            validation_result["errors"].extend(validation_errors)
            
        except Exception as e:
            validation_result["valid"] = False
            validation_result["errors"].append(f"Protocol parsing error: {str(e)}")
        
        # 设置最终验证状态
        validation_result["valid"] = len(validation_result["errors"]) == 0
        
        return validation_result
    
    def _validate_resource_uid(self, resource_uid: GlobalResourceUID) -> bool:
        """验证资源UID"""
        try:
            # 检查namespace
            if not resource_uid.namespace:
                return False
            
            # 检查resource_type
            if resource_uid.resource_type not in ["edge", "block", "workflow"]:
                return False
            
            # 检查resource_name
            if not resource_uid.resource_name:
                return False
            
            return True
        except Exception:
            return False
    
    def _validate_config_params(self, resource_uid: GlobalResourceUID, config_params: Dict[str, Any]) -> List[str]:
        """验证配置参数"""
        errors = []
        
        # 根据资源类型验证特定参数
        if resource_uid.main_type == "modify":
            sub_type = resource_uid.sub_type
            
            if sub_type == "edit_text":
                # 验证edit_text特定参数
                if "content" not in config_params:
                    errors.append("edit_text requires 'content' parameter")
                
                slice_param = config_params.get("slice")
                if slice_param is not None:
                    if not isinstance(slice_param, list) or len(slice_param) != 2:
                        errors.append("'slice' parameter must be a list of 2 integers")
                
                sort_type = config_params.get("sort_type")
                if sort_type is not None:
                    if sort_type not in ["ascending", "descending", ""]:
                        errors.append("'sort_type' must be 'ascending', 'descending', or empty")
            
            elif sub_type == "convert2structured":
                # 验证convert2structured特定参数
                if "content" not in config_params:
                    errors.append("convert2structured requires 'content' parameter")
                
                conversion_mode = config_params.get("conversion_mode")
                if conversion_mode is not None:
                    valid_modes = ["parse_as_json", "eval_safe", "split_by_character", "split_by_length", "wrap_into_dict"]
                    if conversion_mode not in valid_modes:
                        errors.append(f"'conversion_mode' must be one of: {valid_modes}")
        
        return errors


# =============================================================================
# 示例和测试用例
# =============================================================================

def create_example_protocols():
    """创建示例协议"""
    
    # 新协议格式示例
    new_protocol_examples = {
        "modify_edit_text_new": {
            "type": "resource://puppyagent/edge/modify.edit_text@v1",
            "content": "111,{{label_a}}, 222,{{id_b}}",
            "slice": [0, -1],
            "sort_type": "ascending",
            "plugins": {"label_a": "Hello", "id_b": "World"},
            "inputs": {"2": "2/label_2"},
            "outputs": {"3": "3/label_3"}
        },
        
        "modify_convert2text_new": {
            "type": "modify.convert2text",
            "content": {"key": "value"},
            "inputs": {"1": "1/input_data"},
            "outputs": {"2": "2/text_output"}
        }
    }
    
    # 传统协议格式示例
    legacy_protocol_examples = {
        "modify_edit_text_legacy": {
            "type": "modify",
            "data": {
                "modify_type": "edit_text",
                "content": "111,{{label_a}}, 222,{{id_b}}",
                "extra_configs": {
                    "slice": [0, -1],
                    "sort_type": "ascending"
                },
                "plugins": {"label_a": "Hello", "id_b": "World"},
                "inputs": {"2": "2/label_2"},
                "outputs": {"3": "3/label_3"}
            }
        }
    }
    
    return new_protocol_examples, legacy_protocol_examples


async def test_protocol_adapter():
    """测试协议适配器"""
    
    adapter = EdgeProtocolAdapter()
    validator = EdgeProtocolValidator()
    
    new_examples, legacy_examples = create_example_protocols()
    
    print("=== 测试新协议解析 ===")
    for name, protocol in new_examples.items():
        print(f"\n测试: {name}")
        parsed = adapter.parse_edge_protocol(name, protocol)
        print(f"解析结果: {parsed}")
        
        validation = validator.validate_protocol(name, protocol)
        print(f"验证结果: {validation}")
    
    print("\n=== 测试传统协议解析 ===")
    for name, protocol in legacy_examples.items():
        print(f"\n测试: {name}")
        parsed = adapter.parse_edge_protocol(name, protocol)
        print(f"解析结果: {parsed}")
        
        validation = validator.validate_protocol(name, protocol)
        print(f"验证结果: {validation}")
    
    print("\n=== 测试协议转换 ===")
    legacy_protocol = legacy_examples["modify_edit_text_legacy"]
    converted_new = adapter.convert_to_new_protocol("test_edge", legacy_protocol)
    print(f"传统 -> 新协议: {converted_new}")
    
    new_protocol = new_examples["modify_edit_text_new"]
    converted_legacy = adapter.convert_to_legacy_protocol("test_edge", new_protocol)
    print(f"新协议 -> 传统: {converted_legacy}")


if __name__ == "__main__":
    import asyncio
    asyncio.run(test_protocol_adapter()) 