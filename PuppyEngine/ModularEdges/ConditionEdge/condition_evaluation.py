# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from typing import Any, Dict, Callable
from Utils.PuppyEngineExceptions import global_exception_handler


class ConditionEvaluator:
    def __init__(
        self,
        content: Any
    ):
        self.content = content
        # Mapping conditions to their corresponding methods
        self.condition_methods: Dict[str, Callable[[Dict[str, Any]], bool]] = {
            "is_empty": self._is_empty,
            "is_not_empty": self._is_not_empty,
            "contain": self._contains,
            "not_contain": self._does_not_contain,
            "greater_than_n_chars": self._is_greater_than_characters,
            "less_than_n_chars": self._is_less_than_characters,
            "is": self._is,
            "is_not": self._is_not,
            "is_list": self._is_list,
            "is_dict": self._is_dict,
            "greater_than_n": self._length_is_greater_than,
            "less_than_n": self._length_is_less_than
        }

    @global_exception_handler(4100, "Error Evaluating Condition")
    def evaluate(
        self,
        condition: str,
        parameters: Dict[str, Any]
    ) -> bool:
        """
        Evaluate a single condition based on the content and parameters.

        Args:
            condition (str): The condition to evaluate.
            parameters (Dict[str, Any]): The parameters for the condition.

        Returns:
            bool: The result of the evaluation.
        """

        if condition not in self.condition_methods:
            raise ValueError(f"Unsupported condition: {condition}")

        # Call the appropriate method for the condition
        return self.condition_methods[condition](parameters)

    def _is_empty(
        self,
        _: Dict[str, Any]
    ) -> bool:
        return not bool(self.content)

    def _is_not_empty(
        self,
        _: Dict[str, Any]
    ) -> bool:
        return bool(self.content)

    def _contains(
        self,
        parameters: Dict[str, Any]
    ) -> bool:
        value = parameters.get("value")
        if value is None:
            return False

        if isinstance(self.content, dict):
            return value in self.content.keys() or value in self.content.values()
        return value in self.content

    def _does_not_contain(
        self,
        parameters: Dict[str, Any]
    ) -> bool:
        return not self._contains(parameters)

    def _is_greater_than_characters(
        self,
        parameters: Dict[str, Any]
    ) -> bool:
        if isinstance(self.content, str):
            return len(self.content) > parameters.get("value", 0)
        return False

    def _is_less_than_characters(
        self,
        parameters: Dict[str, Any]
    ) -> bool:
        if isinstance(self.content, str):
            return len(self.content) < parameters.get("value", 0)
        return False

    def _is(
        self,
        parameters: Dict[str, Any]
    ) -> bool:
        return self.content == parameters.get("value")

    def _is_not(
        self,
        parameters: Dict[str, Any]
    ) -> bool:
        return not self._is(parameters)

    def _is_list(
        self,
        _: Dict[str, Any]
    ) -> bool:
        return isinstance(self.content, list)

    def _is_dict(
        self,
        _: Dict[str, Any]
    ) -> bool:
        return isinstance(self.content, dict)

    def _length_is_greater_than(
        self,
        parameters: Dict[str, Any]
    ) -> bool:
        if isinstance(self.content, (list, dict)):
            return len(self.content) > parameters.get("value", 0)
        return False

    def _length_is_less_than(
        self,
        parameters: Dict[str, Any]
    ) -> bool:
        if isinstance(self.content, (list, dict)):
            return len(self.content) < parameters.get("value", 0)
        return False
