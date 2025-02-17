# If you are a VS Code users:
import os
import sys
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from typing import Any, Dict, List
from ModularEdges.EdgeFactoryBase import EdgeFactoryBase
from Utils.PuppyEngineExceptions import global_exception_handler
from ModularEdges.ConditionEdge.condition_evaluation import ConditionEvaluator


class ConditionerFactory(EdgeFactoryBase):

    @global_exception_handler(4101, "Error Evaluating Cases")
    def execute(
        self,
        init_configs: Dict[str, Any] = None,
        extra_configs: Dict[str, Any] = None
    ) -> Dict[str,Any]:
        """
        Evaluate all cases and return the results.

        Returns:
            Dict[str, Any]: A dictionary of case names with results.
        """

        content_blocks = init_configs.get("content_blocks", {})
        cases = init_configs.get("cases", {})

        results = {}

        for _, case_data in cases.items():
            conditions = case_data["conditions"]
            then_clause = case_data.get("then", {})

            satisfied = self._evaluate_conditions(conditions, content_blocks)
            if satisfied:
                results[then_clause.get("from")] = then_clause.get("to")

        return results

    @global_exception_handler(4102, "Error Evaluating Case Conditions")
    def _evaluate_conditions(
        self,
        conditions: List[Dict[str, Any]],
        content_blocks: Dict[str, Any]
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
            evaluator = ConditionEvaluator(content_blocks.get(block_id))

            condition_result = evaluator.evaluate(
                condition["condition"],
                condition.get("parameters", {})
            )
            evaluations.append(condition_result)
            operations.append(condition["operation"])

        result = self.evaluate_with_operations(evaluations, operations)

        return result

    @global_exception_handler(4103, "Error Evaluating Conditions with Operations")
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

    print(ConditionerFactory.execute(init_configs={"content_blocks": content_blocks, "cases": cases}))
