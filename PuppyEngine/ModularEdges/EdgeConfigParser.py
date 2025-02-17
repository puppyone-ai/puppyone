# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from itertools import product
from dataclasses import dataclass
from abc import ABC, abstractmethod
from typing import Dict, Any, List, Union, Tuple


@dataclass
class ParsedEdgeParams:
    """Container for parsed edge parameters"""
    init_configs: Union[Dict[str, Any], List[Dict[str, Any]]]
    extra_configs: Union[Dict[str, Any], List[Dict[str, Any]]]
    is_loop: bool = False


class EdgeConfigParser(ABC):
    """Base class for edge config parsers"""

    def __init__(
        self,
        edge_configs: Dict[str, Any],
        block_configs: List[Dict[str, Any]]
    ):
        """
        edge_configs: {
            "inputs": {},
            "outputs": {},
            "...",
            "extra_configs": {}
        }
        block_configs: {
            <id>: {
                "label": <label>,
                "content": <content>,
                "looped": <bool>
            }
        }
        """

        self.edge_configs = edge_configs
        self.block_configs = block_configs
        self.placeholder_pattern = r"\{\{(.*?)\}\}"
        self.unsupported_structure_error = "Unsupported Structure Error"

    @abstractmethod
    def parse(
        self,
        variable_replace_field: str = None
    ) -> ParsedEdgeParams:
        """Parse edge and block configs into parameters for edge execution"""
        pass

    def get_looped_configs(
        self
    ) -> List[Dict[str, Any]]:
        """Get looped configs from block configs"""

        looped_values = {}
        non_looped_values = {}

        # Separate looped and non-looped items
        for key, info in self.block_configs.items():
            content = info.get("content")
            is_looped = info.get("looped", False)

            if is_looped and isinstance(content, (list, dict)):
                looped_values[key] = (
                    [str(item) for item in content] if isinstance(content, list) 
                    else [str({k: v}) for k, v in content.items()]
                )
            else:
                non_looped_values[key] = content  # Keep original content

        # Generate all combinations of looped values
        looped_combinations = [
            dict(zip(looped_values.keys(), values))
            for values in product(*looped_values.values())
        ] if looped_values else [{}]  # Ensure at least one entry exists

        # Merge looped results with non-looped values
        result = [{**combo, **non_looped_values} for combo in looped_combinations]

        return result


class LoadConfigParser(EdgeConfigParser):
    def parse(
        self,
        variable_replace_field: str = "content"
    ) -> ParsedEdgeParams:
        init_configs = []
        extra_configs = []
        base_init_configs = {
            "block_type": self.edge_configs.get('block_type', ''),
        }
        base_extra_configs = self.edge_configs.get('extra_configs', {})

        original_block_info = list(self.block_configs.values())[0]
        is_loop = original_block_info.get('looped')
        block_content = original_block_info.get('content')
        if is_loop and isinstance(block_content, (list, dict)):
            loop_contents = (
                [str(item) for item in block_content]
                if isinstance(block_content, list)
                else [str({key: val}) for key, val in block_content.items()]
            )
            init_configs = [{**base_init_configs, variable_replace_field: content} for content in loop_contents]
            extra_configs = [base_extra_configs] * len(loop_contents)
        else:
            init_configs = [{**base_init_configs, variable_replace_field: str(block_content)}]
            extra_configs = [base_extra_configs]

        return ParsedEdgeParams(
            init_configs=init_configs,
            extra_configs=extra_configs,
            is_loop=is_loop
        )


class SaveConfigParser(EdgeConfigParser):
    def parse(
        self,
        variable_replace_field: str = "data"
    ) -> ParsedEdgeParams:
        init_configs = []
        extra_configs = []
        base_init_configs = {
            "file_type": self.edge_configs.get('file_type', ''),
            "file_name": self.edge_configs.get('file_name', ''),
        }
        base_extra_configs = self.edge_configs.get('extra_configs', {})

        original_block_info = list(self.block_configs.values())[0]
        is_loop = original_block_info.get('looped')
        block_content = original_block_info.get('content')
        if is_loop and isinstance(block_content, (list, dict)):
            loop_contents = (
                [str(item) for item in block_content]
                if isinstance(block_content, list)
                else [str({key: val}) for key, val in block_content.items()]
            )
            init_configs = [{**base_init_configs, variable_replace_field: content} for content in loop_contents]
            extra_configs = [base_extra_configs] * len(loop_contents)
        else:
            init_configs = [{**base_init_configs, variable_replace_field: str(block_content)}]
            extra_configs = [base_extra_configs]

        return ParsedEdgeParams(
            init_configs=init_configs,
            extra_configs=extra_configs,
            is_loop=is_loop
        )


class LLMConfigParser(EdgeConfigParser):
    def parse(
        self,
        variable_replace_field: str = None
    ) -> ParsedEdgeParams:
        return ParsedEdgeParams(
            init_configs=self.edge_configs.get('init_configs', {}),
            extra_configs=self.edge_configs.get('extra_configs', {}),
            is_loop=False
        )


class ChunkConfigParser(EdgeConfigParser):
    def parse(
        self,
        variable_replace_field: str = "doc",
    ) -> ParsedEdgeParams:
        init_configs = []
        extra_configs = []
        base_init_configs = {
            "chunking_mode": self.edge_configs.get('chunking_mode', ''),
            "sub_chunking_mode": self.edge_configs.get('sub_chunking_mode', ''),
        }
        base_extra_configs = self.edge_configs.get('extra_configs', {})

        original_block_info = list(self.block_configs.values())[0]
        is_loop = original_block_info.get('looped')
        block_content = original_block_info.get('content')
        if is_loop and isinstance(block_content, (list, dict)):
            loop_contents = (
                [str(item) for item in block_content]
                if isinstance(block_content, list)
                else [str({key: val}) for key, val in block_content.items()]
            )
            init_configs = [{**base_init_configs, variable_replace_field: content} for content in loop_contents]
            extra_configs = [base_extra_configs] * len(loop_contents)
        else:
            init_configs = [{**base_init_configs, variable_replace_field: str(block_content)}]
            extra_configs = [base_extra_configs]

        return ParsedEdgeParams(
            init_configs=init_configs,
            extra_configs=extra_configs,
            is_loop=is_loop
        )


class SearchConfigParser(EdgeConfigParser):
    def parse(
        self,
        variable_replace_field: str = "query"
    ) -> ParsedEdgeParams:
        variables = self.get_looped_configs()
        
        init_configs = [{
            "search_type": self.edge_configs.get('search_type', ''),
            variable_replace_field: variable.get(self.edge_configs.get('query_id', ''))
        } for variable in variables]
        
        original_extra_configs = self.edge_configs.get('extra_configs', {})
        is_loop = len(variables) > 1
        if is_loop:
            extra_configs = [{**original_extra_configs, "documents": variable.get(self.edge_configs.get('docs_id', ''))} for variable in variables]
        else:
            extra_configs = [{**original_extra_configs, "documents": self.block_configs.get(self.edge_configs.get('docs_id', '')).get('content', '')}]

        return ParsedEdgeParams(
            init_configs=init_configs,
            extra_configs=extra_configs,
            is_loop=is_loop
        )


class RerankConfigParser(EdgeConfigParser):
    def parse(
        self,
        variable_replace_field: str = "retrieval_chunks"
    ) -> ParsedEdgeParams:
        variables = self.get_looped_configs()

        init_configs = [{
            "reranker_type": self.edge_configs.get('reranker_type', ''),
            "model_name": self.edge_configs.get('model_name', ''),
            "top_k": self.edge_configs.get('top_k', ''),
            "query": variable.get(self.edge_configs.get('query', '')),
            variable_replace_field: variable.get(self.edge_configs.get('retrieval_chunks', ''))
        } for variable in variables]
        is_loop = len(variables) > 1
        if is_loop:
            extra_configs = [self.edge_configs.get('extra_configs', {})] * len(variables)
        else:
            extra_configs = [self.edge_configs.get('extra_configs', {})]

        return ParsedEdgeParams(
            init_configs=init_configs,
            extra_configs=extra_configs,
            is_loop=is_loop
        )


class QueryRewriteConfigParser(EdgeConfigParser):
    def parse(
        self,
        variable_replace_field: str = "query"
    ) -> ParsedEdgeParams:
        init_configs = []
        extra_configs = []
        base_init_configs = {
            "strategy_type": self.edge_configs.get('strategy_type', ''),
            "model": self.edge_configs.get('model', ''),
        }
        base_extra_configs = self.edge_configs.get('extra_configs', {})

        original_block_info = list(self.block_configs.values())[0]
        is_loop = original_block_info.get('looped')
        block_content = original_block_info.get('content')
        if is_loop and isinstance(block_content, (list, dict)):
            loop_contents = (
                [str(item) for item in block_content]
                if isinstance(block_content, list)
                else [str({key: val}) for key, val in block_content.items()]
            )
            init_configs = [{**base_init_configs, variable_replace_field: content} for content in loop_contents]
            extra_configs = [base_extra_configs] * len(loop_contents)
        else:
            init_configs = [{**base_init_configs, variable_replace_field: str(block_content)}]
            extra_configs = [base_extra_configs]

        return ParsedEdgeParams(
            init_configs=init_configs,
            extra_configs=extra_configs,
            is_loop=is_loop
        )


class CodeConfigParser(EdgeConfigParser):
    def parse(
        self,
        variable_replace_field: str = "variables"
    ) -> ParsedEdgeParams:
        variables = self.get_looped_configs()
        
        init_configs = [{
            "code_string": self.edge_configs.get('code_string', ''),
            variable_replace_field: variable
        } for variable in variables]
        is_loop = len(variables) > 1
        if is_loop:
            extra_configs = [self.edge_configs.get('extra_configs', {})] * len(variables)
        else:
            extra_configs = [self.edge_configs.get('extra_configs', {})]

        return ParsedEdgeParams(
            init_configs=init_configs,
            extra_configs=extra_configs,
            is_loop=is_loop
        )


class ConditionConfigParser(EdgeConfigParser):
    def parse(
        self,
        variable_replace_field: str = "content_blocks"
    ) -> ParsedEdgeParams:
        variables = self.get_looped_configs()

        init_configs = [{
            "cases": self.edge_configs.get('cases', {}),
            variable_replace_field: variable
        } for variable in variables]
        is_loop = len(variables) > 1
        if is_loop:
            extra_configs = [self.edge_configs.get('extra_configs', {})] * len(variables)
        else:
            extra_configs = [self.edge_configs.get('extra_configs', {})]

        return ParsedEdgeParams(
            init_configs=init_configs,
            extra_configs=extra_configs,
            is_loop=is_loop
        )


class ModifyConfigParser(EdgeConfigParser):
    def parse(
        self,
        variable_replace_field: str = None
    ) -> ParsedEdgeParams:
        return ParsedEdgeParams(
            init_configs=self.edge_configs.get('init_configs', {}),
            extra_configs=self.edge_configs.get('extra_configs', {}),
            is_loop=False
        )


class ConfigParserFactory:
    """Factory for creating edge config parsers"""

    _parsers = {
        'load': LoadConfigParser(),
        'save': SaveConfigParser(),
        'llm': LLMConfigParser(),
        'chunk': ChunkConfigParser(),
        'search': SearchConfigParser(),
        'rerank': RerankConfigParser(),
        'rewrite': QueryRewriteConfigParser(),
        'code': CodeConfigParser(),
        'condition': ConditionConfigParser(),
        'modify': ModifyConfigParser()
    }

    @classmethod
    def get_parser(cls, edge_type: str) -> EdgeConfigParser:
        parser = cls._parsers.get(edge_type.lower())
        if not parser:
            raise ValueError(f"No parser found for edge type: {edge_type}")
        return parser

