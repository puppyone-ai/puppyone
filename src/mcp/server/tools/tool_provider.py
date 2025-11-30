"""
工具定义提供者模块
负责管理工具名称和工具描述的生成
"""

from abc import ABC, abstractmethod
from typing import Dict, Optional
from src.mcp.server.tools.context_tool import tool_types
from src.mcp.server.tools.context_tool import ContextTool
from src.mcp.schemas import McpToolsDefinition
from src.utils.logger import log_info, log_error


class ToolDefinitionProvider(ABC):
    """
    工具定义提供者抽象接口
    用于统一管理工具名称和工具描述的生成
    """

    @abstractmethod
    def get_tool_name(self, tool_type: tool_types) -> str:
        """
        获取工具名称

        Args:
            tool_type: 工具类型（create/update/delete/get）

        Returns:
            工具名称字符串
        """
        pass

    @abstractmethod
    def get_tool_description(self, tool_type: tool_types, context_info: dict) -> str:
        """
        获取工具描述

        Args:
            tool_type: 工具类型（create/update/delete/get）
            context_info: 上下文信息字典

        Returns:
            工具描述字符串
        """
        pass


class DefaultToolDefinitionProvider(ToolDefinitionProvider):
    """
    默认工具定义提供者
    使用 context_tool.py 中的 generate_tool_description 方法
    """

    def __init__(self):
        self.context_tool = ContextTool()

    def get_tool_name(self, tool_type: tool_types) -> str:
        """获取默认工具名称"""
        tool_name_map = {
            "query": "query_context",
            "create": "create_element",
            "update": "update_element",
            "delete": "delete_element",
            "preview": "preview_data",
            "select": "select_contexts",
        }
        return tool_name_map.get(tool_type, f"unknown_{tool_type}")

    def get_tool_description(self, tool_type: tool_types, context_info: dict) -> str:
        """获取默认工具描述"""
        context = context_info.get("context")

        if not context:
            return f"知识库管理工具 - {tool_type}"

        return self.context_tool.generate_tool_description(
            project_name=context_info.get("project_name", "未知项目"),
            context_name=context.context_name,
            tool_type=tool_type,
            project_description=context_info.get("project_description"),
            project_metadata=context_info.get("project_metadata"),
            context_description=context.context_description,
            context_metadata=context.metadata,
        )


class CustomToolDefinitionProvider(ToolDefinitionProvider):
    """
    自定义工具定义提供者
    使用用户传入的 tools_definition
    """

    def __init__(self, tools_definition: Dict[str, McpToolsDefinition]):
        """
        初始化自定义工具定义提供者

        Args:
            tools_definition: 用户自定义的工具定义字典，key只能是get/create/update/delete
        """
        # tools_definition 已经是字典格式，key是工具类型（get/create/update/delete）
        self.tool_definitions = tools_definition

        # 创建默认提供者作为回退
        self.default_provider = DefaultToolDefinitionProvider()

    def get_tool_name(self, tool_type: tool_types) -> str:
        """获取工具名称"""
        # 如果用户定义了该工具类型，使用用户定义的工具名称
        if tool_type in self.tool_definitions:
            return self.tool_definitions[tool_type].tool_name

        # 否则返回默认名称
        return self.default_provider.get_tool_name(tool_type)

    def get_tool_description(self, tool_type: tool_types, context_info: dict) -> str:
        """获取工具描述"""
        # 如果用户定义了该工具类型，使用用户定义的描述模板
        if tool_type in self.tool_definitions:
            tool_def = self.tool_definitions[tool_type]
            template = tool_def.tool_desc_template
            parameters = tool_def.tool_desc_parameters

            # 填充模板参数
            # tool_desc_parameters 是一个字典列表，需要合并成一个字典
            try:
                # 将参数列表转换为字典
                params_dict = {}
                if isinstance(parameters, list):
                    for param in parameters:
                        if isinstance(param, dict):
                            params_dict.update(param)
                elif isinstance(parameters, dict):
                    params_dict = parameters

                # 使用 format 方法填充模板
                # 支持 {key} 格式的占位符
                if params_dict:
                    return template.format(**params_dict)
                else:
                    # 如果没有参数，直接返回模板
                    return template
            except KeyError as e:
                log_error(
                    f"Missing parameter in tool description template for {tool_type}: {e}"
                )
                return template  # 如果缺少参数，返回原始模板
            except Exception as e:
                log_error(
                    f"Error formatting tool description template for {tool_type}: {e}"
                )
                return template  # 如果格式化失败，返回原始模板

        # 如果没有用户定义，回退到默认提供者
        return self.default_provider.get_tool_description(tool_type, context_info)


def create_tool_definition_provider(
    tools_definition: Optional[Dict[str, McpToolsDefinition]] = None,
) -> ToolDefinitionProvider:
    """
    创建工具定义提供者

    Args:
        tools_definition: 用户自定义的工具定义字典，key只能是get/create/update/delete，如果为 None 或空字典则使用默认实现

    Returns:
        ToolDefinitionProvider 实例
    """
    if tools_definition and len(tools_definition) > 0:
        provider = CustomToolDefinitionProvider(tools_definition)
        log_info(
            f"Using custom tool definition provider with {len(tools_definition)} tools"
        )
        return provider
    else:
        provider = DefaultToolDefinitionProvider()
        log_info("Using default tool definition provider")
        return provider
