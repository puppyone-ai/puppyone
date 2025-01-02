# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from typing import Any, Dict, List, Callable
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


class Conditioner:
    def __init__(
        self,
        content_blocks: Dict[str, Any],
        cases: Dict[str, Any]
    ):
        self.content_blocks = content_blocks
        self.cases = cases

    def evaluate_cases(
        self
    ) -> Dict[str,Any]:
        """
        Evaluate all cases and return the results.

        Returns:
            Dict[str, Any]: A dictionary of case names with results.
        """

        results = {}

        for case_name, case_data in self.cases.items():
            conditions = case_data["conditions"]
            then_clause = case_data.get("then", {})

            satisfied = self._evaluate_conditions(conditions)
            results[case_name] = {
                "satisfied": satisfied,
                "to": then_clause.get("to") if satisfied else None
            }

        return results

    def _evaluate_conditions(
        self,
        conditions: List[Dict[str, Any]]
    ) -> bool:
        """
        Evaluate a sequence of conditions with operations.

        Args:
            conditions (List[Dict[str, Any]]): A list of conditions with operations.

        Returns:
            bool: The result of the evaluation.
        """

        result = None
        evaluations = []
        operations = []

        for condition in conditions:
            block_id = condition["block"]
            evaluator = ConditionEvaluator(self.content_blocks.get(block_id))

            condition_result = evaluator.evaluate(
                condition["condition"],
                condition.get("parameters", {})
            )
            evaluations.append(condition_result)
            operations.append(condition["operation"])

        result = self.evaluate_with_operations(evaluations, operations)

        return result
    
    def evaluate_with_operations(
        self,
        evaluations: List[bool],
        operations: List[str]
    ) -> bool:
        """
        Evaluate a sequence of evaluations with operations.

        Args:
            evaluations (List[bool]): A list of boolean evaluations.
            operations (List[str]): A list of operations between evaluations.

        Returns:
            bool: The result of the evaluation.
        """

        if not evaluations or not operations:
            raise ValueError("Evaluations and operations must not be empty.")
        
        if len(evaluations) != len(operations):
            raise ValueError("Mismatch between evaluations and operations length.")

        # Initialize the result with the first evaluation
        result = evaluations[0]

        # Loop through operations and apply them to subsequent evaluations
        for i, operation in enumerate(operations):
            if i < len(evaluations) - 1:
                next_eval = evaluations[i + 1]

                if operation == "and":
                    result = result and next_eval
                elif operation == "or":
                    result = result or next_eval
                elif operation == "/":
                    raise ValueError("None operation not supported in between conditions")
                else:
                    raise ValueError(f"Unsupported operation: {operation}")

        return result


if __name__ == "__main__":
    content_blocks = {
        "1": "",
        "2": "world"
    }

    cases = {
        "case1": {
            "conditions": [
                {
                    "block": "1",
                    "condition": "is_empty",
                    "parameters": {},
                    "operation": "and"
                },
                {
                    "block": "2",
                    "condition": "is",
                    "parameters": {"value": "world"},
                    "operation": "/"
                }
            ],
            "then": {
                "from": "1",
                "to": "3"
            }
        },
        "case2": {
            "conditions": [
                {
                    "block": "1",
                    "condition": "is_not_empty",
                    "parameters": {},
                    "operation": "or"
                },
                {
                    "block": "2",
                    "condition": "contain",
                    "parameters": {"value": "h"},
                    "operation": "/"
                }
            ],
            "then": {
                "from": "2",
                "to": "4"
            }
        }
    }

    conditioner = Conditioner(content_blocks, cases)
    results = conditioner.evaluate_cases()
    print(results)
