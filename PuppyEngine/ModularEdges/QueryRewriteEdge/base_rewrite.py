# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import re
import json
from abc import ABC, abstractmethod
from typing import Dict, List, Union
from ModularEdges.LLMEdge.generater import lite_llm_chat
from Utils.puppy_exception import global_exception_handler


class QueryRewriteStrategy(ABC):
    """Base strategy class for query rewriting"""

    def __init__(
        self,
        query: str,
        model: str = "gpt-4o"
    ):
        self.query = query
        self.model = model

    def _execute_lite_llm_chat(
        self,
        prompt: List[Dict[str, str]]
    ) -> str:
        """Execute LLM chat with given prompt"""
        response = lite_llm_chat(
            messages=prompt,
            model=self.model,
            temperature=0.3,
            max_tokens=4096,
            printing=True,
            stream=True
        ).strip()
        return response

    @global_exception_handler(3700, "Error Parsing LLM Response")
    def _safe_eval(
        self,
        expression: str
    ) -> List[str]:
        """Safely parse list of strings from LLM response"""
        try:
            list_pattern = re.compile(r'\[\s*("[^"]*"(?:\s*,\s*"[^"]*")*)\s*\]')
            match = list_pattern.search(expression)
            if match:
                list_str = match.group(0)
                result = json.loads(list_str)
                if isinstance(result, list) and all(isinstance(item, str) for item in result):
                    return result
            raise ValueError("No valid list of strings found in the expression.")
        except Exception as e:
            raise ValueError(f"Safe eval error: {str(e)}")

    @abstractmethod
    def rewrite(
        self,
        **kwargs
    ) -> Union[str, List[str]]:
        """Execute the query rewrite strategy"""
        pass 