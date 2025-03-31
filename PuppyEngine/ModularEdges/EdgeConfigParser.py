# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import re
from itertools import product
from dataclasses import dataclass
from abc import ABC, abstractmethod
from typing import Dict, Any, List, Union, Tuple
from Utils.puppy_exception import global_exception_handler


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
        self.edge_configs = edge_configs
        self.block_configs = block_configs
        self.placeholder_pattern = r"\{\{(.*?)\}\}"

    @abstractmethod
    def parse(
        self,
        variable_replace_field: str = None
    ) -> ParsedEdgeParams:
        """
        Parse edge and block configs into parameters for edge execution
        """

        pass

    def _get_base_configs(
        self,
        base_fields: Dict[str, str]
    ) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        """
        Get base configurations for init and extra configs
        """

        base_init = {
            field: self.edge_configs.get(config_key, "")
            for field, config_key in base_fields.items()
        }
        return base_init, self.edge_configs.get("extra_configs", {})

    def _handle_loop_content(
        self,
        content: Any
    ) -> List[str]:
        """
        Convert content to list of strings for loop processing
        """

        if isinstance(content, list):
            return [str(item) for item in content]
        elif isinstance(content, dict):
            return [str({k: v}) for k, v in content.items()]
        return [str(content)]

    def _prase_single_block_content(
        self,
        variable_field: str,
        base_fields: Dict[str, str]
    ) -> Tuple[bool, List[Dict[str, Any]], List[Dict[str, Any]]]:
        """
        Parse single block content and generate configs for both single and loop cases
        """

        base_init, base_extra = self._get_base_configs(base_fields)

        original_block_info = list(self.block_configs.values())[0]
        is_loop = original_block_info.get("looped")
        block_content = original_block_info.get("content")

        if is_loop and isinstance(block_content, (list, dict)):
            contents = self._handle_loop_content(block_content)
            init_configs = [{**base_init, variable_field: content} for content in contents]
            extra_configs = [base_extra] * len(contents)
        else:
            init_configs = [{**base_init, variable_field: block_content}]
            extra_configs = [base_extra]

        return is_loop, init_configs, extra_configs

    def get_looped_configs(
        self
    ) -> List[Dict[str, Any]]:
        """
        Get looped configs from block configs
        """

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

    def replace_placeholders(
        self,
        text_content: str,
        variable_values: Dict[str, Any],
        keep_new_content_type: bool = False,
        escape_inner_chars: bool = False
    ) -> Any:
        placeholders = re.findall(self.placeholder_pattern, text_content)
        for content_block_label in placeholders:
            replace_block_id = [
                block_id for block_id, block_info in self.block_configs.items() 
                if block_info.get("label") == content_block_label
            ]
            if replace_block_id:
                replaced_content = variable_values.get(replace_block_id[0], "")
                content_to_match = f"{{{{{content_block_label}}}}}"
                # Handle single block content that keep the original content type
                if text_content == content_to_match and self.edge_configs.get("modify_type") != "edit_text":
                    return replaced_content

                if escape_inner_chars:
                    replaced_content = self._escape_markdown(str(replaced_content))
                text_content = replaced_content if keep_new_content_type else text_content.replace(content_to_match, str(replaced_content))
            else:
                raise ValueError(f"Block {content_block_label} not found")
        return text_content
    
    def _escape_markdown(
        self,
        text: str
    ) -> str:
        """
        Escapes markdown special characters and structures to be treated as plain text.

        Args:
            text: The markdown text to escape

        Returns:
            Escaped string where markdown syntax is treated as literal text
        """

        # Handle backslashes first to avoid double-escaping
        text = text.replace('\\', '\\\\').replace('\n', '\\n').replace('\t', '\\t')

        # Handle quotes
        text = text.replace('"', '\\\"').replace("'", "\\\'")

        return text


class LoadConfigParser(EdgeConfigParser):
    @global_exception_handler(3001, "Error Parsing Load Edge")
    def parse(
        self,
        variable_replace_field: str = "content"
    ) -> ParsedEdgeParams:
        base_fields = {
            "block_type": "block_type",
        }
        is_loop, init_configs, extra_configs = self._prase_single_block_content(
            variable_replace_field,
            base_fields
        )

        return ParsedEdgeParams(
            init_configs=init_configs,
            extra_configs=extra_configs,
            is_loop=is_loop
        )


class SaveConfigParser(EdgeConfigParser):
    @global_exception_handler(3002, "Error Parsing Save Edge")
    def parse(
        self,
        variable_replace_field: str = "data"
    ) -> ParsedEdgeParams:
        base_fields = {
            "file_type": "file_type",
            "file_name": "file_name",
        }
        is_loop, init_configs, extra_configs = self._prase_single_block_content(
            variable_replace_field,
            base_fields
        )

        return ParsedEdgeParams(
            init_configs=init_configs,
            extra_configs=extra_configs,
            is_loop=is_loop
        )


class LLMConfigParser(EdgeConfigParser):
    @global_exception_handler(3003, "Error Parsing LLM Edge")
    def parse(
        self,
        variable_replace_field: str = "messages"
    ) -> ParsedEdgeParams:
        variable_replace_content = self.edge_configs.get(variable_replace_field, [])
        self.edge_configs.pop("inputs")
        self.edge_configs.pop("outputs")
        self.edge_configs.pop(variable_replace_field)
        variables = self.get_looped_configs()

        init_configs = [{
            **self.edge_configs,
            variable_replace_field: [{
                "role": message.get("role", "user"),
                "content": self.replace_placeholders(message.get("content", ""), variable)
            } for message in variable_replace_content]
        } for variable in variables]

        is_loop = len(variables) > 1
        if is_loop:
            extra_configs = [{}] * len(variables)
        else:
            extra_configs = [{}]

        return ParsedEdgeParams(
            init_configs=init_configs,
            extra_configs=extra_configs,
            is_loop=is_loop
        )


class ChunkConfigParser(EdgeConfigParser):
    @global_exception_handler(3004, "Error Parsing Chunk Edge")
    def parse(
        self,
        variable_replace_field: str = "doc",
    ) -> ParsedEdgeParams:
        base_fields = {
            "chunking_mode": "chunking_mode",
            "sub_chunking_mode": "sub_chunking_mode",
        }
        is_loop, init_configs, extra_configs = self._prase_single_block_content(
            variable_replace_field,
            base_fields
        )

        return ParsedEdgeParams(
            init_configs=init_configs,
            extra_configs=extra_configs,
            is_loop=is_loop
        )


class SearchConfigParser(EdgeConfigParser):
    @global_exception_handler(3005, "Error Parsing Search Edge")
    def parse(
        self,
        variable_replace_field: str = "query"
    ) -> ParsedEdgeParams:
        # Handle multiple document sources
        doc_ids = self.edge_configs.get("doc_ids", [])
        collection_configs_list = []
        if doc_ids:
            doc_contents = []
            for doc_id in doc_ids:
                content = self.block_configs[doc_id]["embedding_view"]
                doc_contents.extend(content)
                collections = [self.block_configs[doc_id]["collection_configs"]] * len(content)
                collection_configs_list.extend(collections)

            self.block_configs[doc_ids[0]]["content"] = doc_contents
            for doc_id in doc_ids[1:]:
                self.block_configs.pop(doc_id)

        variables = self.get_looped_configs()
        query_id = list(self.edge_configs.get("query_id", {}).keys())[0]

        init_configs = [{
            "search_type": self.edge_configs.get("search_type", ""),
            variable_replace_field: variable.get(query_id)
        } for variable in variables]

        original_extra_configs = self.edge_configs.get("extra_configs", {})
        is_loop = len(variables) > 1
        if is_loop:
            extra_configs = [{
                **original_extra_configs,
                "documents": variable.get(doc_ids[0], ""),
                "collection_configs": [collection_configs_list[i]]
            } for i, variable in enumerate(variables)]
        else:
            extra_configs = [{
                **original_extra_configs,
                "documents": self.block_configs.get(doc_ids[0], {}).get("content", "") if doc_ids else "",
                "collection_configs": collection_configs_list if doc_ids else []
            }]

        return ParsedEdgeParams(
            init_configs=init_configs,
            extra_configs=extra_configs,
            is_loop=is_loop
        )


class RerankConfigParser(EdgeConfigParser):
    @global_exception_handler(3006, "Error Parsing Rerank Edge")
    def parse(
        self,
        variable_replace_field: str = "retrieval_chunks"
    ) -> ParsedEdgeParams:
        variables = self.get_looped_configs()

        init_configs = [{
            "reranker_type": self.edge_configs.get("reranker_type", ""),
            "model_name": self.edge_configs.get("model_name", ""),
            "top_k": self.edge_configs.get("top_k", ""),
            "query": variable.get(self.edge_configs.get("query", "")),
            variable_replace_field: variable.get(self.edge_configs.get("retrieval_chunks", ""))
        } for variable in variables]
        is_loop = len(variables) > 1
        if is_loop:
            extra_configs = [self.edge_configs.get("extra_configs", {})] * len(variables)
        else:
            extra_configs = [self.edge_configs.get("extra_configs", {})]

        return ParsedEdgeParams(
            init_configs=init_configs,
            extra_configs=extra_configs,
            is_loop=is_loop
        )


class QueryRewriteConfigParser(EdgeConfigParser):
    @global_exception_handler(3007, "Error Parsing Query Rewrite Edge")
    def parse(
        self,
        variable_replace_field: str = "query"
    ) -> ParsedEdgeParams:
        base_fields = {
            "strategy_type": "strategy_type",
            "model": "model",
        }
        is_loop, init_configs, extra_configs = self._prase_single_block_content(
            variable_replace_field,
            base_fields
        )

        return ParsedEdgeParams(    
            init_configs=init_configs,
            extra_configs=extra_configs,
            is_loop=is_loop
        )


class CodeConfigParser(EdgeConfigParser):
    @global_exception_handler(3008, "Error Parsing Code Edge")
    def parse(
        self,
        variable_replace_field: str = "variables"
    ) -> ParsedEdgeParams:
        variables = self.get_looped_configs()
        
        init_configs = [{
            "code_string": self.edge_configs.get("code_string", ""),
            variable_replace_field: variable
        } for variable in variables]
        is_loop = len(variables) > 1
        if is_loop:
            extra_configs = [self.edge_configs.get("extra_configs", {})] * len(variables)
        else:
            extra_configs = [self.edge_configs.get("extra_configs", {})]

        return ParsedEdgeParams(
            init_configs=init_configs,
            extra_configs=extra_configs,
            is_loop=is_loop
        )


class ConditionConfigParser(EdgeConfigParser):
    @global_exception_handler(3009, "Error Parsing Condition Edge")
    def parse(
        self,
        variable_replace_field: str = "content_blocks"
    ) -> ParsedEdgeParams:
        variables = self.get_looped_configs()

        init_configs = [{
            "cases": self.edge_configs.get("cases", {}),
            variable_replace_field: variable
        } for variable in variables]
        is_loop = len(variables) > 1
        if is_loop:
            extra_configs = [self.edge_configs.get("extra_configs", {})] * len(variables)
        else:
            extra_configs = [self.edge_configs.get("extra_configs", {})]

        return ParsedEdgeParams(
            init_configs=init_configs,
            extra_configs=extra_configs,
            is_loop=is_loop
        )


class ModifyConfigParser(EdgeConfigParser):
    @global_exception_handler(3010, "Error Parsing Modify Edge")
    def parse(
        self,
        variable_replace_field: str = "content"
    ) -> ParsedEdgeParams:
        variables = self.get_looped_configs()
        modify_type = self.edge_configs.get("modify_type", "")

        init_configs = [{
            "modify_type": modify_type,
            variable_replace_field: self.replace_placeholders(
                text_content=self.edge_configs.get(variable_replace_field),
                variable_values=variable,
                keep_new_content_type=True if modify_type == "edit_structured" else False,
                escape_inner_chars=False
            )
        } for variable in variables]

        is_loop = len(variables) > 1
        extra_configs = self._handle_edit_structured_extra_configs(is_loop, variables)

        return ParsedEdgeParams(
            init_configs=init_configs,
            extra_configs=extra_configs,
            is_loop=is_loop
        )
    
    def _handle_edit_structured_extra_configs(
        self,
        is_loop: bool,
        variables: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Handle edit structured extra configs"""
        if is_loop:
            extra_configs = [self.edge_configs.get("extra_configs", {})] * len(variables)
        else:
            extra_configs = [self.edge_configs.get("extra_configs", {})]

        for i, extra in enumerate(extra_configs):
            operations = extra.get("operations", [])
            for operation in operations:
                params = operation.get("params", {})
                for key, value in params.items():
                    if key.startswith("value"):
                        params[key] = self.replace_placeholders(value, variables[i], True)
                operation["params"] = params
            extra_configs[i] = extra
        return extra_configs


class ConfigParserFactory:
    """Factory for creating edge config parsers"""

    _parsers = {
        "load": LoadConfigParser,
        "save": SaveConfigParser,
        "llm": LLMConfigParser,
        "chunk": ChunkConfigParser,
        "search": SearchConfigParser,
        "rerank": RerankConfigParser,
        "rewrite": QueryRewriteConfigParser,
        "code": CodeConfigParser,
        "ifelse": ConditionConfigParser,
        "modify": ModifyConfigParser
    }

    @classmethod
    def get_parser(
        cls,
        edge_type: str,
        edge_configs: Dict[str, Any],
        block_configs: List[Dict[str, Any]]
    ) -> EdgeConfigParser:
        parser = cls._parsers.get(edge_type.lower())
        if not parser:
            raise ValueError(f"No parser found for edge type: {edge_type}")

        return parser(
            edge_configs=edge_configs,
            block_configs=block_configs
        )

